// Highlights video generator. Everything runs in the browser:
//   picks the best moments from a match file, renders a broadcast-style 1080p video
//   (3D follow camera, scorebug, goal banners, slow-motion replays, branded transitions,
//   intro / full-time / player-of-the-match cards), synthesises crowd audio, encodes to MP4
//   with WebCodecs, and makes a matching thumbnail plus YouTube title and description.

import { Muxer, ArrayBufferTarget, FileSystemWritableFileStreamTarget } from 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/+esm';
import { safeColour, onColour, logoPath } from './ui.js';
import { kickoff } from './data.js';

export const W = 1920, H = 1080, FPS = 30;
const SR = 48000;
const GOAL_Y1 = 30.34, GOAL_Y2 = 37.66, GOAL_H = 2.44;
const LIME = '#8fff06', LIME2 = '#76d306', YEL = '#d5d915', DARK = '#0f1115';
const FONT = 'Inter, system-ui, sans-serif';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeInOut = t => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const seg01 = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

function loadImg(src) {
  return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
const shirt = id => String(id).slice(-2);
const lastName = n => String(n || '').split(' ').slice(-1)[0];

// ---------------------------------------------------------------- match state

class Frames {
  constructor(d) {
    this.d = d; this.f = d.frames.data; this.sc = d.frames.scale; this.n = d.players.length;
    this.half2 = d.periods[1]?.start_t ?? Infinity;
  }
  idx(t) {
    const f = this.f, ds = t * 10; let lo = 0, hi = f.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (f[m][0] <= ds) lo = m; else hi = m - 1; }
    return lo;
  }
  at(t) {
    const i = this.idx(t), a = this.f[i], b = this.f[Math.min(i + 1, this.f.length - 1)], sc = this.sc;
    const cross = a[0] / 10 < this.half2 && b[0] / 10 >= this.half2;
    const k = b[0] > a[0] && !cross ? clamp((t * 10 - a[0]) / (b[0] - a[0]), 0, 1) : 0;
    const L = j => (a[j] + (b[j] - a[j]) * k) / sc;
    const inPlay = !!(a[5] && b[5]);
    const players = [];
    for (let p = 0; p < this.n; p++) players.push([L(6 + 2 * p), L(7 + 2 * p)]);
    return { ball: inPlay ? [L(1), L(2), L(3)] : [a[1] / sc, a[2] / sc, 0], inPlay: !!a[5], holder: a[4], players };
  }
}

// ---------------------------------------------------------------- cameras (pinhole)

// Camera in the main stand, `dist` metres from the target at `elevDeg` above the pitch.
function makeCam(tx, ty, dist, elevDeg, fovDeg) {
  const e = elevDeg * Math.PI / 180;
  return makeCamAt([tx, ty + dist * Math.cos(e), dist * Math.sin(e)], [tx, ty, 0], fovDeg);
}

// Camera at any position C looking at target T.
function makeCamAt(C, T, fovDeg) {
  let f = [T[0] - C[0], T[1] - C[1], T[2] - C[2]]; const fl = Math.hypot(...f); f = f.map(v => v / fl);
  // r = up x f with up = (0,0,1)  ->  (-f1, f0, 0), normalised
  const rl = Math.hypot(f[1], f[0]) || 1;
  const r = [-f[1] / rl, f[0] / rl, 0];
  // u = f x r
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const focal = (W / 2) / Math.tan(fovDeg * Math.PI / 360);
  const NEAR = 0.5;
  // World point -> camera space [right, up, depth].
  const toCam = (x, y, z = 0) => {
    const v0 = x - C[0], v1 = y - C[1], v2 = z - C[2];
    return [v0 * r[0] + v1 * r[1] + v2 * r[2], v0 * u[0] + v1 * u[1] + v2 * u[2], v0 * f[0] + v1 * f[1] + v2 * f[2]];
  };
  const proj = ([xc, yc, zc]) => [W / 2 + focal * xc / zc, H / 2 - focal * yc / zc, focal / zc];
  return {
    focal,
    p(x, y, z = 0) { const q = toCam(x, y, z); return q[2] < NEAR ? null : proj(q); },
    // Polygon clipped against the near plane (so shapes partly behind the camera still draw).
    poly(pts) {
      const inp = pts.map(([x, y, z = 0]) => toCam(x, y, z)), out = [];
      for (let i = 0; i < inp.length; i++) {
        const a = inp[i], b = inp[(i + 1) % inp.length], ain = a[2] >= NEAR, bin = b[2] >= NEAR;
        if (ain) out.push(a);
        if (ain !== bin) { const t = (NEAR - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]); }
      }
      return out.map(proj);
    },
    // Line segment clipped against the near plane; null if entirely behind.
    seg(a, b) {
      let A = toCam(...a), B = toCam(...b);
      if (A[2] < NEAR && B[2] < NEAR) return null;
      if (A[2] < NEAR) { const t = (NEAR - A[2]) / (B[2] - A[2]); A = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, NEAR]; }
      if (B[2] < NEAR) { const t = (NEAR - B[2]) / (A[2] - B[2]); B = [B[0] + (A[0] - B[0]) * t, B[1] + (A[1] - B[1]) * t, NEAR]; }
      return [proj(A), proj(B)];
    },
  };
}

// ---------------------------------------------------------------- highlight selection

function attackStart(d, e) {
  const same = d.events.filter(x => x.poss === e.poss && x.t <= e.t);
  const first = same.length ? same[0].t : e.t - 8;
  return clamp(first - 1.5, e.t - 13, e.t - 5);
}

export function planHighlights(d, targetSeconds = 180) {
  const shots = d.events.filter(e => e.type === 'shot');
  const cand = [];
  for (const e of d.events) {
    if (e.type === 'goal') {
      const shot = shots.find(s => s.id === e.shot) || null;
      cand.push({ kind: 'goal', score: 100 + e.t / 1e4, t: e.t, t0: attackStart(d, shot || e), t1: e.t + 4.5, e, shot });
    } else if (e.type === 'shot' && e.outcome !== 'goal') {
      const big = e.xg >= 0.15, saved = e.outcome === 'saved' && e.xg >= 0.04, wood = e.outcome === 'woodwork';
      if (big || saved || wood || e.on_target) cand.push({ kind: wood ? 'woodwork' : saved ? 'save' : 'chance', score: 30 + e.xg * 60 + (wood ? 25 : 0) + (saved ? 8 : 0), t: e.t, t0: attackStart(d, e), t1: e.t + 2.8, e });
    } else if (e.type === 'card' && e.card !== 'yellow') {
      cand.push({ kind: 'red', score: 55, t: e.t, t0: e.t - 5, t1: e.t + 2.5, e });
    }
  }
  const fixed = 4.5 + 4.5 + 3.5 + 9 + 5.5 + 4.5;   // intro, versus, half-time, full-time, motm, outro
  let budget = targetSeconds - fixed;
  const picked = [];
  for (const c of cand.sort((a, b) => b.score - a.score)) {
    const len = c.t1 - c.t0;
    if (len > budget && picked.length) continue;
    if (picked.some(p => c.t0 < p.t1 + 1 && c.t1 > p.t0 - 1)) continue;   // overlaps another clip
    picked.push(c); budget -= len;
  }
  picked.sort((a, b) => a.t - b.t);
  // Spare time: widen clips a little so the video lands near the target length.
  const spare = Math.max(0, budget);
  const each = picked.length ? Math.min(8, spare / picked.length) : 0;
  picked.forEach(c => {
    const per = d.periods.find(p => p.start_t <= c.t && (p.end_t ?? 1e9) >= c.t) || d.periods[0];
    c.t0 = Math.max(c.t0 - each * 0.7, per.start_t + 1);
    c.t1 = Math.min(c.t1 + each * 0.3, (per.end_t ?? c.t1 + 99) - 0.5);
  });
  // Keep clips apart after widening.
  for (let i = 1; i < picked.length; i++) picked[i].t0 = Math.max(picked[i].t0, picked[i - 1].t1 + 0.5);
  return picked;
}

// ---------------------------------------------------------------- timeline

function buildTimeline(d, clips) {
  const segs = [];
  const add = s => { s.start = segs.length ? segs[segs.length - 1].end : 0; s.end = s.start + s.dur; segs.push(s); };
  add({ type: 'intro', dur: 4.5 });
  add({ type: 'versus', dur: 4.5 });
  const half2 = d.periods[1]?.start_t ?? Infinity;
  let htDone = false;
  for (const c of clips) {
    if (!htDone && c.t >= half2 && clips.some(x => x.t < half2)) { add({ type: 'halftime', dur: 3.5 }); htDone = true; }
    add({ type: 'clip', dur: c.t1 - c.t0, t0: c.t0, speed: 1, clip: c });
  }
  add({ type: 'fulltime', dur: 9 });
  add({ type: 'motm', dur: 5.5 });
  add({ type: 'outro', dur: 4.5 });
  return segs;
}

// ---------------------------------------------------------------- renderer

export class HighlightsRenderer {
  constructor(data, { season, fixture, assets }) {
    this.d = data; this.fr = new Frames(data); this.season = season; this.fx = fixture; this.A = assets;
    this.home = data.teams.home; this.away = data.teams.away;
    this.hc = safeColour(this.home.colour); this.ac = safeColour(this.away.colour);
    this.nHome = this.home.lineup.length;
    this.names = Object.fromEntries(data.players.map(p => [p.id, p.name]));
    this.clips = planHighlights(data);
    this.segs = buildTimeline(data, this.clips);
    this.duration = this.segs[this.segs.length - 1].end;
    this.goals = data.events.filter(e => e.type === 'goal');
    this.cv = document.createElement('canvas'); this.cv.width = W; this.cv.height = H;
    this.c = this.cv.getContext('2d');
    this.camState = new Map();
    this.trail = [];
    this.gkIdx = new Set(data.players.filter(p => p.slot === 'GK').map(p => p.idx));
  }

  segAt(T) { return this.segs.find(s => T >= s.start && T < s.end) || this.segs[this.segs.length - 1]; }

  scoreAt(t) {
    const sc = [0, 0];
    for (const g of this.goals) if (g.t <= t) sc[g.team === this.home.code ? 0 : 1]++;
    return sc;
  }
  clockAt(t) {
    const p = [...this.d.periods].reverse().find(p => p.start_t <= t + 1e-6) || this.d.periods[0];
    const el = Math.max(0, t - p.start_t), base = p.period === 2 ? 45 : 0;
    const m = Math.floor(el / 60) + base, s = Math.floor(el % 60);
    if (el > 2700) { const extra = Math.floor((el - 2700) / 60); return `${base + 45}+${extra + 1}'`; }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // Draw the video frame at output time T (seconds).
  draw(T) {
    const s = this.segAt(T), local = T - s.start, c = this.c;
    c.save();
    c.clearRect(0, 0, W, H);
    switch (s.type) {
      case 'intro': this.drawIntro(local, s); break;
      case 'versus': this.drawVersus(local, s); break;
      case 'clip': case 'replay': this.drawClip(s, local); break;
      case 'halftime': this.drawHalftime(local, s); break;
      case 'fulltime': this.drawFulltime(local, s); break;
      case 'motm': this.drawMotm(local, s); break;
      case 'outro': this.drawOutro(local, s); break;
    }
    c.restore();
    this.drawTransition(T);
    if (!['intro', 'outro'].includes(s.type)) this.drawBug();
  }

  // ------------------------------------------------ backgrounds and text

  bg(tint = 0.78) {
    const c = this.c, img = this.A.title;
    c.fillStyle = DARK; c.fillRect(0, 0, W, H);
    if (img) {
      const r = Math.max(W / img.width, H / img.height);
      c.drawImage(img, (W - img.width * r) / 2, (H - img.height * r) / 2, img.width * r, img.height * r);
    }
    c.fillStyle = `rgba(10,12,16,${tint})`; c.fillRect(0, 0, W, H);
    this.grid();
  }
  grid() {
    const c = this.c; c.strokeStyle = 'rgba(255,255,255,0.035)'; c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= W; x += 48) { c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += 48) { c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); }
    c.stroke();
  }
  text(str, x, y, { size = 40, weight = 800, colour = '#fff', align = 'left', italic = false, spacing = 0, shadow = 0, alpha = 1, base = 'alphabetic' } = {}) {
    const c = this.c; c.save();
    c.globalAlpha *= alpha;
    c.font = `${weight} ${size}px ${FONT}`; c.fillStyle = colour; c.textAlign = align; c.textBaseline = base;
    if ('letterSpacing' in c) c.letterSpacing = `${spacing}px`;
    if (shadow) { c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = shadow; c.shadowOffsetY = shadow / 3; }
    if (italic) { c.translate(x, y); c.transform(1, 0, -0.18, 1, 0, 0); c.fillText(str, 0, 0); } else c.fillText(str, x, y);
    c.restore();
  }
  logoAt(team, x, y, size, alpha = 1) {
    const c = this.c, img = this.A.logos[team.code];
    c.save(); c.globalAlpha *= alpha;
    if (img) c.drawImage(img, x - size / 2, y - size / 2, size, size);
    else {
      c.fillStyle = safeColour(team.colour); c.beginPath(); c.arc(x, y, size / 2, 0, Math.PI * 2); c.fill();
      this.text(team.code, x, y + size * 0.12, { size: size * 0.32, weight: 900, align: 'center', colour: onColour(team.colour) });
    }
    c.restore();
  }
  pill(x, y, w, h, fill, r = h / 2) {
    const c = this.c; c.beginPath(); c.roundRect(x, y, w, h, r); c.fillStyle = fill; c.fill();
  }
  limeGrad(x0, y0, x1, y1) { const g = this.c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, YEL); g.addColorStop(0.6, LIME2); return g; }

  // ------------------------------------------------ cards

  drawIntro(t) {
    const c = this.c;
    this.bg(0.86);
    // Light sweep
    const sx = lerp(-600, W + 600, easeInOut(t / 2.2));
    const g = c.createLinearGradient(sx - 300, 0, sx + 300, 0);
    g.addColorStop(0, 'rgba(143,255,6,0)'); g.addColorStop(0.5, 'rgba(143,255,6,0.16)'); g.addColorStop(1, 'rgba(143,255,6,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // Diagonal brand bars
    c.save(); c.translate(W / 2, H / 2); c.rotate(-0.35);
    for (let i = 0; i < 3; i++) {
      const w = lerp(0, W * 1.6, easeOut((t - 0.1 * i) / 0.9));
      c.fillStyle = i === 1 ? this.limeGrad(-w / 2, 0, w / 2, 0) : `rgba(143,255,6,${0.08 + i * 0.04})`;
      c.fillRect(-w / 2, -260 + i * 170 + (i === 1 ? 70 : 0), w, i === 1 ? 14 : 60);
    }
    c.restore();
    const k = easeOut((t - 0.4) / 0.8);
    if (this.A.league) {
      c.save(); c.shadowColor = 'rgba(143,255,6,0.6)'; c.shadowBlur = 60 * k;
      const s = 260 * (0.6 + 0.4 * k); c.globalAlpha = k;
      c.drawImage(this.A.league, W / 2 - s / 2, H / 2 - 190 - s / 2 + 60, s, s); c.restore();
    }
    const a = easeOut((t - 1.0) / 0.7);
    this.text('HEINEKEN C LEAGUE', W / 2, H / 2 + 150, { size: 84, weight: 900, align: 'center', spacing: 6 * a, alpha: a, shadow: 20 });
    const b = easeOut((t - 1.5) / 0.7);
    this.text(`SEASON ${this.season?.season ?? 3}  ·  WEEK ${this.fx?.week ?? this.d.match.week ?? ''}  ·  HIGHLIGHTS`, W / 2, H / 2 + 225, { size: 34, weight: 800, align: 'center', colour: LIME, spacing: 5, alpha: b });
    this.fadeOut(t, 4.5, 0.35);
  }

  drawVersus(t) {
    const c = this.c;
    c.fillStyle = DARK; c.fillRect(0, 0, W, H);
    const split = W / 2 + Math.sin(t * 0.6) * 10, slant = 180;
    const k = easeOut(t / 0.7);
    for (const [side, col] of [[0, this.hc], [1, this.ac]]) {
      c.save(); c.beginPath();
      if (side === 0) { c.moveTo(0, 0); c.lineTo(split + slant / 2, 0); c.lineTo(split - slant / 2, H); c.lineTo(0, H); }
      else { c.moveTo(W, 0); c.lineTo(split + slant / 2 + 6, 0); c.lineTo(split - slant / 2 + 6, H); c.lineTo(W, H); }
      c.closePath(); c.clip();
      const g = c.createLinearGradient(side ? W : 0, 0, split, H);
      g.addColorStop(0, col); g.addColorStop(1, '#0b0d11');
      c.globalAlpha = 0.85; c.fillStyle = g; c.fillRect(0, 0, W, H); c.globalAlpha = 1;
      this.stripes(t, 0.35);
      const team = side ? this.away : this.home, wm = this.A.logosAlt[team.code] || this.A.logos[team.code];
      if (wm) { c.globalAlpha = 0.08; const s = 900; c.translate(side ? W - 300 : 300, H / 2); c.rotate(side ? 0.35 : -0.35); c.drawImage(wm, -s / 2, -s / 2, s, s); }
      c.restore();
    }
    this.grid();
    const off = (1 - k) * 500;
    for (const [side, team] of [[0, this.home], [1, this.away]]) {
      const x = side ? W * 0.75 + off : W * 0.25 - off;
      c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 40; this.logoAt(team, x, H / 2 - 70, 330); c.restore();
      this.text(team.name.toUpperCase(), x, H / 2 + 175, { size: 62, weight: 900, align: 'center', shadow: 16, italic: true });
      this.text(team.code, x, H / 2 + 230, { size: 30, weight: 800, align: 'center', colour: 'rgba(255,255,255,.7)', spacing: 8 });
    }
    const v = easeOut((t - 0.5) / 0.5);
    c.save(); c.translate(W / 2, H / 2 - 60); c.scale(0.6 + 0.4 * v, 0.6 + 0.4 * v); c.globalAlpha = v;
    this.pill(-95, -95, 190, 190, this.limeGrad(-95, -95, 95, 95), 95);
    this.text('VS', 0, 38, { size: 110, weight: 900, align: 'center', colour: DARK, italic: true });
    c.restore();
    const k0 = kickoff(this.fx || {});
    const when = k0 ? k0.toLocaleString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
    this.text(`WEEK ${this.fx?.week ?? ''}${when ? '  ·  ' + when.toUpperCase() : ''}`, W / 2, H - 90, { size: 30, weight: 800, align: 'center', spacing: 4, alpha: easeOut((t - 0.8) / 0.6) });
  }

  stripes(t, alpha) {
    const c = this.c; c.save(); c.globalAlpha *= alpha; c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = 4;
    const off = (t * 40) % 80;
    c.beginPath();
    for (let x = -H; x < W + H; x += 80) { c.moveTo(x + off, H); c.lineTo(x + off + H, 0); }
    c.stroke(); c.restore();
  }

  fadeOut(t, dur, len) { const a = seg01(t, dur - len, dur); if (a > 0) { this.c.fillStyle = `rgba(0,0,0,${a})`; this.c.fillRect(0, 0, W, H); } }

  drawHalftime(t) {
    this.bg(0.84); this.stripes(t, 0.5);
    const half2 = this.d.periods[1]?.start_t ?? 0;
    const sc = this.scoreAt(half2 - 1);
    const k = easeOut(t / 0.6);
    this.text('HALF-TIME', W / 2, 330, { size: 46, weight: 900, align: 'center', colour: LIME, spacing: 10, alpha: k });
    this.scoreLine(sc, 560, k);
  }

  scoreLine(sc, y, k = 1) {
    const c = this.c;
    this.logoAt(this.home, W / 2 - 520, y - 40, 190, k);
    this.logoAt(this.away, W / 2 + 520, y - 40, 190, k);
    this.pill(W / 2 - 230, y - 150, 460, 200, 'rgba(255,255,255,0.96)', 28);
    this.text(`${sc[0]}  -  ${sc[1]}`, W / 2, y + 12, { size: 150, weight: 900, align: 'center', colour: DARK });
    this.text(this.home.name.toUpperCase(), W / 2 - 520, y + 110, { size: 34, weight: 900, align: 'center', alpha: k });
    this.text(this.away.name.toUpperCase(), W / 2 + 520, y + 110, { size: 34, weight: 900, align: 'center', alpha: k });
    c.globalAlpha = 1;
  }

  drawFulltime(t) {
    const c = this.c;
    this.bg(0.86); this.stripes(t, 0.4);
    const k = easeOut(t / 0.6);
    this.text('FULL-TIME', W / 2, 150, { size: 50, weight: 900, align: 'center', colour: LIME, spacing: 12, alpha: k });
    this.scoreLine([this.d.result.home, this.d.result.away], 380, k);
    // Scorers
    const list = side => this.goals.filter(g => g.team === (side ? this.away.code : this.home.code))
      .map(g => `${lastName(this.names[g.scorer])} ${g.minute}'${g.own_goal ? ' (OG)' : ''}`);
    const a = easeOut((t - 0.6) / 0.6);
    list(0).slice(0, 4).forEach((s, i) => this.text('⚽ ' + s, W / 2 - 520, 555 + i * 38, { size: 27, weight: 700, align: 'center', alpha: a }));
    list(1).slice(0, 4).forEach((s, i) => this.text('⚽ ' + s, W / 2 + 520, 555 + i * 38, { size: 27, weight: 700, align: 'center', alpha: a }));
    // Stat bars, centred under the score
    const st = this.d.stats.teams;
    const rows = [['POSSESSION %', 'possession'], ['xG', 'xg'], ['SHOTS', 'shots'], ['ON TARGET', 'shots_on_target'], ['PASS ACCURACY %', 'pass_accuracy']];
    rows.forEach(([label, key], i) => {
      const y = 530 + i * 102, b = easeOut((t - 1.1 - i * 0.15) / 0.7);
      const h = +st.home[key] || 0, aw = +st.away[key] || 0, tot = h + aw || 1;
      this.text(label, W / 2, y, { size: 22, weight: 800, align: 'center', colour: 'rgba(255,255,255,.65)', spacing: 3, alpha: b });
      this.text(String(st.home[key]), W / 2 - 330, y + 38, { size: 32, weight: 900, align: 'right', alpha: b });
      this.text(String(st.away[key]), W / 2 + 330, y + 38, { size: 32, weight: 900, alpha: b });
      const bw = 560 * b;
      this.pill(W / 2 - 290, y + 16, 580, 16, 'rgba(255,255,255,0.08)');
      c.fillStyle = this.hc; c.beginPath(); c.roundRect(W / 2 - bw / 2, y + 16, bw * h / tot, 16, 8); c.fill();
      c.fillStyle = this.ac; c.beginPath(); c.roundRect(W / 2 - bw / 2 + bw * h / tot, y + 16, bw * aw / tot, 16, 8); c.fill();
    });
  }

  drawMotm(t) {
    const c = this.c;
    const ps = this.d.stats.players;
    const id = Object.keys(ps).reduce((b, k) => (!b || ps[k].rating > ps[b].rating ? k : b), null);
    const p = this.d.players.find(x => x.id === id), s = ps[id];
    const team = p.team === this.home.code ? this.home : this.away;
    c.fillStyle = DARK; c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(W * 0.3, H / 2, 50, W * 0.3, H / 2, 900);
    g.addColorStop(0, safeColour(team.colour)); g.addColorStop(1, '#0b0d11');
    c.globalAlpha = 0.55; c.fillStyle = g; c.fillRect(0, 0, W, H); c.globalAlpha = 1;
    this.stripes(t, 0.4); this.grid();
    const k = easeOut(t / 0.7);
    c.save(); c.shadowColor = 'rgba(245,158,11,.55)'; c.shadowBlur = 60; this.logoAt(team, W * 0.3 - (1 - k) * 300, H / 2, 420, k); c.restore();
    const gold = c.createLinearGradient(0, 0, 600, 0); gold.addColorStop(0, '#f59e0b'); gold.addColorStop(0.5, '#fbbf24'); gold.addColorStop(1, '#fef08a');
    this.text('PLAYER OF THE MATCH', W * 0.52, 360, { size: 40, weight: 900, colour: gold, spacing: 8, alpha: k });
    this.text(p.name.toUpperCase(), W * 0.52 + (1 - k) * 200, 470, { size: 92, weight: 900, italic: true, alpha: k, shadow: 20 });
    this.text(team.name.toUpperCase(), W * 0.52, 530, { size: 30, weight: 800, colour: 'rgba(255,255,255,.7)', spacing: 4, alpha: k });
    const b = easeOut((t - 0.6) / 0.6);
    this.pill(W * 0.52, 575, 200, 110, gold, 20);
    this.text(s.rating.toFixed(1), W * 0.52 + 100, 655, { size: 72, weight: 900, align: 'center', colour: '#1a1205', alpha: b });
    const line = [s.goals && `${s.goals} goal${s.goals > 1 ? 's' : ''}`, s.assists && `${s.assists} assist${s.assists > 1 ? 's' : ''}`, `${s.passes_completed}/${s.passes} passes`, s.saves && `${s.saves} saves`, s.tackles_won && `${s.tackles_won} tackles won`].filter(Boolean).slice(0, 4).join('   ·   ');
    this.text(line, W * 0.52 + 240, 645, { size: 30, weight: 700, alpha: b });
  }

  drawOutro(t) {
    const c = this.c;
    this.bg(0.9);
    const k = easeOut(t / 0.8);
    if (this.A.league) { c.save(); c.globalAlpha = k; c.shadowColor = 'rgba(143,255,6,.5)'; c.shadowBlur = 50; c.drawImage(this.A.league, W / 2 - 110, 240, 220, 220); c.restore(); }
    this.text('HEINEKEN C LEAGUE', W / 2, 560, { size: 70, weight: 900, align: 'center', spacing: 6, alpha: k });
    this.text('FULL MATCH REPLAY, LADDER AND STATS', W / 2, 640, { size: 30, weight: 800, align: 'center', colour: 'rgba(255,255,255,.7)', spacing: 4, alpha: easeOut((t - 0.5) / 0.6) });
    this.text('ldg224.github.io/s3', W / 2, 700, { size: 40, weight: 900, align: 'center', colour: LIME, alpha: easeOut((t - 0.8) / 0.6) });
    this.fadeOut(t, 4.5, 0.8);
  }

  // ------------------------------------------------ match footage

  // Director: splits each clip into camera shots, like a TV match director cutting between angles.
  //   build-up -> main broadcast camera or high wide "tactical" camera
  //   the chance -> behind-the-goal camera or low touchline close-up
  //   after a goal -> close-up following the scorer's celebration
  shotsFor(s) {
    if (this.camState.has(s)) return this.camState.get(s);
    const clip = s.clip, ev = clip.e, dur = s.dur, evL = clip.t - s.t0;
    const ballAtEvent = this.fr.at(clip.t).ball;
    const goalX = (ev.x ?? ballAtEvent[0]) > 52.5 ? 105 : 0;
    const idx = this.clips.indexOf(clip);
    // When does the attack reach the danger zone (30 m from goal)?
    let tA = null;
    for (let l = 0; l < evL; l += 0.2) {
      const b = this.fr.at(s.t0 + l).ball;
      if (Math.hypot(b[0] - goalX, b[1] - 34) < 30) { tA = l; break; }
    }
    if (tA == null) tA = evL - 3;
    tA = clamp(tA, Math.min(2.5, evL - 1.5), Math.max(0, evL - 2.2));
    const opening = ['main', 'wide', 'main', 'high'][idx % 4];
    const climax = clip.kind === 'red' ? 'tight' : clip.kind === 'save' ? 'endcam' : ['endcam', 'tight', 'endcam', 'main'][idx % 4];
    const shots = [];
    if (tA >= 2) shots.push({ from: 0, to: tA, angle: opening });
    const after = evL + (clip.kind === 'goal' ? 1.2 : 0.9);
    shots.push({ from: shots.length ? tA : 0, to: Math.min(dur, after), angle: climax });
    if (dur - after >= 1.6) shots.push({ from: after, to: dur, angle: clip.kind === 'goal' ? 'celebrate' : 'main' });
    else shots[shots.length - 1].to = dur;
    // Scorer, followed by the celebration camera.
    const scorerIdx = clip.kind === 'goal' ? this.d.players.findIndex(p => p.id === ev.scorer) : -1;
    // Smoothed target path per shot, so cuts are clean and each shot glides.
    for (const sh of shots) {
      const n = Math.ceil((sh.to - sh.from) * FPS) + 2, raw = [];
      for (let i = 0; i < n; i++) {
        const st = this.fr.at(s.t0 + sh.from + i / FPS);
        raw.push(sh.angle === 'celebrate' && scorerIdx >= 0 ? st.players[scorerIdx] : st.ball);
      }
      const a = sh.angle === 'tight' || sh.angle === 'celebrate' ? 0.12 : 0.07;
      const path = []; let cx = raw[0][0], cy = raw[0][1];
      for (const b of raw) { cx = lerp(cx, b[0], a); cy = lerp(cy, b[1], a); path.push([cx, cy]); }
      for (let i = path.length - 2; i >= 0; i--) { path[i][0] = lerp(path[i][0], path[i + 1][0], a * 2); path[i][1] = lerp(path[i][1], path[i + 1][1], a * 2); }
      sh.path = path;
    }
    const plan = { shots, goalX };
    this.camState.set(s, plan);
    return plan;
  }

  camFor(s, local) {
    const tSim = s.t0 + local;
    const { shots, goalX } = this.shotsFor(s);
    const sh = shots.find(x => local >= x.from && local < x.to) || shots[shots.length - 1];
    const [bx, by] = sh.path[clamp(Math.round((local - sh.from) * FPS), 0, sh.path.length - 1)];
    const toGoal = Math.hypot(bx - goalX, by - 34);
    const gs = goalX === 105 ? 1 : -1;
    let cam;
    switch (sh.angle) {
      case 'wide':   // high and far: shows the team shapes
        cam = makeCam(clamp(lerp(bx, 52.5, 0.4), 30, 75), 34 + (by - 34) * 0.3, 74, 44, 38); break;
      case 'high':   // steep from the gantry, following play
        cam = makeCam(clamp(bx, 14, 91), clamp(by, 18, 50), 46, 58, 40); break;
      case 'tight':  // low on the touchline, close to the ball
        cam = makeCam(clamp(bx, 4, 101), clamp(by, 6, 62), 19, 15, 36); break;
      case 'celebrate':
        cam = makeCam(clamp(bx, 4, 101), clamp(by, 6, 62), 15, 12, 34); break;
      case 'endcam': { // behind the goal, looking out at the attack: ball and goal both in shot
        const tx = lerp(bx, goalX, 0.3), ty = lerp(by, 34, 0.3);
        cam = makeCamAt([goalX + gs * 13, clamp(lerp(34, by, 0.35), 24, 44), 7.5], [tx, ty, 0.5], 48); break;
      }
      default: {     // main broadcast camera; leans towards the goal as play gets close
        const k = clamp(1 - toGoal / 34, 0, 0.45);
        cam = makeCam(clamp(lerp(bx, goalX, k), 10, 95), clamp(lerp(by, 34, k * 0.6), 14, 54), 36, 27, 38);
      }
    }
    return { cam, tSim, cut: local - sh.from < 1 / FPS };
  }

  drawClip(s, local) {
    const c = this.c;
    const { cam, tSim, cut } = this.camFor(s, local);
    const st = this.fr.at(tSim);
    this.drawPitch(cam);
    this.drawGoal(cam, 0); this.drawGoal(cam, 105);
    // Players far to near (by distance from this camera)
    const items = st.players.map((p, i) => ({ i, x: p[0], y: p[1], d: cam.p(p[0], p[1])?.[2] ?? 0 }));
    items.sort((a, b) => a.d - b.d);
    // ball trail (reset on every camera cut)
    const bp = cam.p(st.ball[0], st.ball[1], st.ball[2]);
    if (local < 1 / FPS * 1.5 || cut) this.trail = [];
    if (bp && st.inPlay) { this.trail.push(bp); if (this.trail.length > 10) this.trail.shift(); }
    const bd = cam.p(st.ball[0], st.ball[1])?.[2] ?? 0;
    let ballDrawn = false;
    for (const it of items) {
      if (!ballDrawn && it.d > bd) { this.drawBall(cam, st); ballDrawn = true; }
      this.drawPlayer(cam, it, st.holder === it.i);
    }
    if (!ballDrawn) this.drawBall(cam, st);
    // Vignette
    const v = c.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.0);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
    c.fillStyle = v; c.fillRect(0, 0, W, H);
    this.drawClipOverlays(s, local, tSim);
  }

  quad(cam, pts, fill) {
    const P = cam.poly(pts); if (P.length < 3) return;
    const c = this.c; c.beginPath(); c.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) c.lineTo(P[i][0], P[i][1]); c.closePath(); c.fillStyle = fill; c.fill();
  }
  line(cam, pts, width = 3, colour = 'rgba(255,255,255,0.85)', close = false) {
    const c = this.c; c.beginPath();
    const list = close ? [...pts, pts[0]] : pts;
    for (let i = 0; i + 1 < list.length; i++) {
      const s = cam.seg(list[i], list[i + 1]); if (!s) continue;
      c.moveTo(s[0][0], s[0][1]); c.lineTo(s[1][0], s[1][1]);
    }
    c.lineWidth = width; c.lineCap = 'round'; c.strokeStyle = colour; c.stroke();
  }
  arc(cx, cy, r, a0, a1, n = 40) { const out = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return out; }

  drawPitch(cam) {
    const c = this.c;
    const sky = c.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#05070a'); sky.addColorStop(1, '#0b1410');
    c.fillStyle = sky; c.fillRect(0, 0, W, H);
    this.drawStands(cam);
    this.quad(cam, [[-7, -6], [112, -6], [112, 74], [-7, 74]], '#1d5a2a');
    for (let i = 0; i < 12; i++) this.quad(cam, [[i * 8.75, 0], [(i + 1) * 8.75, 0], [(i + 1) * 8.75, 68], [i * 8.75, 68]], i % 2 ? '#2d7a3b' : '#327f40');
    const lw = 3;
    this.line(cam, [[0, 0], [105, 0], [105, 68], [0, 68]], lw, undefined, true);
    this.line(cam, [[52.5, 0], [52.5, 68]], lw);
    this.line(cam, this.arc(52.5, 34, 9.15, 0, Math.PI * 2, 60), lw);
    for (const [x0, s] of [[0, 1], [105, -1]]) {
      this.line(cam, [[x0, 13.84], [x0 + s * 16.5, 13.84], [x0 + s * 16.5, 54.16], [x0, 54.16]], lw);
      this.line(cam, [[x0, 24.84], [x0 + s * 5.5, 24.84], [x0 + s * 5.5, 43.16], [x0, 43.16]], lw);
      const a = Math.acos(5.5 / 9.15);
      this.line(cam, this.arc(x0 + s * 11, 34, 9.15, s > 0 ? -a : Math.PI - a, s > 0 ? a : Math.PI + a, 24), lw);
      const spot = cam.p(x0 + s * 11, 34); if (spot) { c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.arc(spot[0], spot[1], 3, 0, Math.PI * 2); c.fill(); }
    }
    const cs = cam.p(52.5, 34); if (cs) { c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.arc(cs[0], cs[1], 3.5, 0, Math.PI * 2); c.fill(); }
    // Advertising boards along the far touchline
    const b1 = cam.p(-5, -3, 0), b2 = cam.p(110, -3, 0), b3 = cam.p(110, -3, 1.0), b4 = cam.p(-5, -3, 1.0);
    if (b1 && b2 && b3 && b4) {
      c.beginPath(); c.moveTo(b1[0], b1[1]); c.lineTo(b2[0], b2[1]); c.lineTo(b3[0], b3[1]); c.lineTo(b4[0], b4[1]); c.closePath();
      c.fillStyle = '#0b0d11'; c.fill();
      for (let x = 0; x < 105; x += 15) {
        const p = cam.p(x + 7.5, -3, 0.5); if (!p) continue;
        this.text(x % 30 === 0 ? 'HEINEKEN C LEAGUE' : 'SEASON 3', p[0], p[1] + p[2] * 0.2, { size: Math.max(8, p[2] * 0.55), weight: 900, align: 'center', colour: x % 30 === 0 ? LIME : '#fff', base: 'middle' });
      }
    }
  }

  // Four stands of crowd around the pitch (only the faces this camera can see).
  drawStands(cam) {
    const c = this.c;
    if (!this.crowd) {
      const s = document.createElement('canvas'); s.width = s.height = 64; const g = s.getContext('2d');
      g.fillStyle = '#10141b'; g.fillRect(0, 0, 64, 64);
      const cols = ['#2a3140', '#3b4252', '#1c2230', '#4b5563', '#5b2130', '#1f3b5b', this.hc, this.ac, '#cbd5e1'];
      for (let i = 0; i < 260; i++) { g.fillStyle = cols[(Math.random() * cols.length) | 0]; g.globalAlpha = 0.35 + Math.random() * 0.5; g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2); }
      this.crowd = c.createPattern(s, 'repeat');
    }
    const faces = [
      [[-12, -6, 0], [117, -6, 0], [117, -26, 14], [-12, -26, 14]],     // far side
      [[-12, 74, 0], [117, 74, 0], [117, 94, 14], [-12, 94, 14]],        // near side
      [[-7, -12, 0], [-7, 80, 0], [-27, 80, 12], [-27, -12, 12]],        // left end
      [[112, -12, 0], [112, 80, 0], [132, 80, 12], [132, -12, 12]],      // right end
    ];
    for (const f of faces) {
      const P = cam.poly(f);
      if (P.length < 3) continue;
      c.beginPath(); c.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) c.lineTo(P[i][0], P[i][1]); c.closePath();
      c.fillStyle = this.crowd; c.fill();
      const g = c.createLinearGradient(0, Math.min(...P.map(p => p[1])), 0, Math.max(...P.map(p => p[1])));
      g.addColorStop(0, 'rgba(5,7,10,0.75)'); g.addColorStop(1, 'rgba(5,7,10,0.15)');
      c.fillStyle = g; c.fill();
    }
  }

  drawGoal(cam, gx) {
    const s = gx === 0 ? -1 : 1, d = 2;
    const net = 'rgba(255,255,255,0.35)';
    for (let i = 0; i <= 6; i++) { const y = GOAL_Y1 + (GOAL_Y2 - GOAL_Y1) * i / 6; this.line(cam, [[gx, y, GOAL_H], [gx + s * d, y, GOAL_H * 0.7], [gx + s * d, y, 0]], 1, net); }
    for (let i = 0; i <= 4; i++) { const z = GOAL_H * i / 4; this.line(cam, [[gx + s * d, GOAL_Y1, z * 0.7], [gx + s * d, GOAL_Y2, z * 0.7]], 1, net); }
    this.line(cam, [[gx, GOAL_Y1, 0], [gx, GOAL_Y1, GOAL_H], [gx, GOAL_Y2, GOAL_H], [gx, GOAL_Y2, 0]], 5, '#ffffff');
  }

  drawPlayer(cam, it, holder) {
    const c = this.c, p = cam.p(it.x, it.y); if (!p) return;
    const side = it.i < this.nHome ? 0 : 1;
    let col = side ? this.ac : this.hc;
    if (this.gkIdx.has(it.i)) col = side ? '#a855f7' : '#f5b042';
    const r = Math.max(10, p[2] * 0.6);
    const head = cam.p(it.x, it.y, 1.85);
    const top = head ? head[1] : p[1] - r * 2;
    // shadow
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(p[0] + r * 0.4, p[1], r * 1.05, r * 0.42, 0, 0, Math.PI * 2); c.fill();
    // body: a short upright capsule, like a player figure seen from the stand
    const bx = p[0], bh = p[1] - top, bw = Math.max(12, bh * 0.42);
    const g = c.createLinearGradient(bx - bw, 0, bx + bw, 0); g.addColorStop(0, col); g.addColorStop(1, shade(col, 0.55));
    c.fillStyle = g; c.beginPath(); c.roundRect(bx - bw / 2, top + bh * 0.28, bw, bh * 0.72, bw / 2); c.fill();
    c.fillStyle = '#f1c9a5'; c.beginPath(); c.arc(bx, top + bh * 0.16, bw * 0.34, 0, Math.PI * 2); c.fill();
    if (holder) { c.lineWidth = 3; c.strokeStyle = '#fff'; c.beginPath(); c.ellipse(p[0], p[1], r * 1.5, r * 0.6, 0, 0, Math.PI * 2); c.stroke(); }
    // shirt number
    const pl = this.d.players[it.i];
    this.text(shirt(pl.id), bx, top + bh * 0.62, { size: Math.max(9, bw * 0.55), weight: 900, align: 'center', colour: onColour(col), base: 'middle' });
    if (holder) {
      const name = lastName(pl.name).toUpperCase(), fs = 24;
      c.font = `900 ${fs}px ${FONT}`; const w = c.measureText(name).width + 28;
      this.pill(bx - w / 2, top - 46, w, 36, 'rgba(15,17,21,0.88)', 10);
      c.fillStyle = col; c.fillRect(bx - w / 2, top - 46, 6, 36);
      this.text(name, bx + 3, top - 20, { size: fs, weight: 900, align: 'center' });
    }
  }

  drawBall(cam, st) {
    const c = this.c, [x, y, z] = st.ball;
    const g = cam.p(x, y, 0), b = cam.p(x, y, z + 0.11); if (!g || !b) return;
    c.save(); c.globalAlpha = st.inPlay ? 1 : 0.4;
    if (this.trail.length > 2 && st.inPlay) {
      c.beginPath(); c.moveTo(this.trail[0][0], this.trail[0][1]);
      for (const q of this.trail) c.lineTo(q[0], q[1]);
      const tg = c.createLinearGradient(this.trail[0][0], this.trail[0][1], b[0], b[1]); tg.addColorStop(0, 'rgba(255,255,255,0)'); tg.addColorStop(1, 'rgba(255,255,255,0.45)');
      c.strokeStyle = tg; c.lineWidth = Math.max(2, b[2] * 0.18); c.lineCap = 'round'; c.stroke();
    }
    const r = Math.max(4.5, b[2] * 0.22);
    c.fillStyle = 'rgba(0,0,0,0.4)'; c.beginPath(); c.ellipse(g[0], g[1], r * 1.1, r * 0.5, 0, 0, Math.PI * 2); c.fill();
    const bg = c.createRadialGradient(b[0] - r / 3, b[1] - r / 3, 1, b[0], b[1], r);
    bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, '#c9ced6');
    c.fillStyle = bg; c.beginPath(); c.arc(b[0], b[1] - r * 0.2, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1; c.stroke();
    c.restore();
  }

  drawClipOverlays(s, local, tSim) {
    const clip = s.clip, ev = clip.e;
    // Opening tag: minute + moment type
    const tagA = seg01(local, 0.3, 0.8) * (1 - seg01(local, 3.2, 3.7));
    if (s.type === 'clip' && tagA > 0) {
      const label = { goal: 'GOAL', chance: 'BIG CHANCE', save: 'GREAT SAVE', woodwork: 'OFF THE WOODWORK', red: 'RED CARD' }[clip.kind];
      const team = ev.team === this.home.code ? this.home : this.away;
      const x = 70 - (1 - easeOut(tagA)) * 60, y = H - 150;
      this.c.save(); this.c.globalAlpha = tagA;
      this.pill(x, y, 110, 54, this.limeGrad(x, y, x + 110, y + 54), 10);
      this.text(`${ev.minute}'`, x + 55, y + 38, { size: 30, weight: 900, align: 'center', colour: DARK });
      this.pill(x + 120, y, 360, 54, 'rgba(15,17,21,0.88)', 10);
      this.c.fillStyle = safeColour(team.colour); this.c.fillRect(x + 120, y, 6, 54);
      this.text(label, x + 142, y + 37, { size: 26, weight: 900, spacing: 3 });
      this.c.restore();
    }
    if (s.type === 'replay') {
      const a = seg01(local, 0.1, 0.5);
      this.c.save(); this.c.globalAlpha = a;
      this.pill(W - 290, 52, 220, 56, 'rgba(15,17,21,0.88)', 12);
      this.c.fillStyle = LIME; this.c.beginPath(); this.c.arc(W - 258, 80, 9, 0, Math.PI * 2); this.c.fill();
      this.text('REPLAY', W - 236, 91, { size: 30, weight: 900, spacing: 4 });
      this.c.restore();
      this.c.fillStyle = 'rgba(143,255,6,0.9)'; this.c.fillRect(0, 0, W, 5); this.c.fillRect(0, H - 5, W, 5);
    }
    // Goal banner
    if (s.type === 'clip' && clip.kind === 'goal') {
      const since = (tSim - ev.t) / s.speed;
      if (since >= 0) this.goalBanner(ev, since);
    } else if (s.type === 'clip') {
      const since = (tSim - clip.t) / s.speed;
      if (since >= 0 && since < 3.2) this.lowerThird(clip, since);
    }
  }

  goalBanner(ev, t) {
    const c = this.c, team = ev.team === this.home.code ? this.home : this.away, col = safeColour(team.colour);
    const inK = easeOut(t / 0.45), outK = seg01(t, 3.6, 4.1), a = 1 - outK;
    if (a <= 0) return;
    const y = H - 330, h = 190;
    c.save(); c.globalAlpha = a;
    c.translate(-(1 - inK) * W, 0);
    c.save(); c.beginPath(); c.moveTo(0, y); c.lineTo(W * 0.78, y); c.lineTo(W * 0.72, y + h); c.lineTo(0, y + h); c.closePath(); c.clip();
    const g = c.createLinearGradient(0, 0, W * 0.8, 0); g.addColorStop(0, col); g.addColorStop(1, shade(col, 0.45));
    c.fillStyle = g; c.fillRect(0, y, W, h);
    this.stripes(t * 3, 0.7);
    c.restore();
    c.fillStyle = this.limeGrad(0, y + h, W * 0.72, y + h + 12);
    c.beginPath(); c.moveTo(0, y + h); c.lineTo(W * 0.72, y + h); c.lineTo(W * 0.715, y + h + 12); c.lineTo(0, y + h + 12); c.fill();
    this.pill(90, y + 28, 134, 134, 'rgba(255,255,255,0.95)', 67);
    this.logoAt(team, 157, y + 95, 108);
    const tc = onColour(col);
    const pop = 1 + 0.12 * Math.max(0, 1 - t / 0.35);
    c.save(); c.translate(270, y + 128); c.scale(pop, pop);
    this.text('GOAL!', 0, 0, { size: 128, weight: 900, italic: true, colour: tc, shadow: 16 });
    c.restore();
    const sc = this.scoreAt(ev.t + 0.01);
    const name = this.names[ev.scorer] || '';
    this.text(`${name.toUpperCase()}${ev.own_goal ? '  (OG)' : ''}`, 740, y + 88, { size: 50, weight: 900, colour: tc, italic: true });
    this.text(`${ev.minute}'${ev.assist ? `   ·   ASSIST ${lastName(this.names[ev.assist]).toUpperCase()}` : ''}   ·   ${this.home.code} ${sc[0]}-${sc[1]} ${this.away.code}`,
      742, y + 140, { size: 30, weight: 800, colour: tc, alpha: 0.9 });
    c.restore();
  }

  lowerThird(clip, t) {
    const c = this.c, ev = clip.e;
    const a = easeOut(t / 0.3) * (1 - seg01(t, 2.7, 3.2));
    const text = clip.kind === 'save' ? `SAVE!  ·  ${this.keeperName(ev)}` : clip.kind === 'woodwork' ? `OFF THE ${ev.end_z > 2.2 ? 'BAR' : 'POST'}!  ·  ${lastName(this.names[ev.player])}`
      : clip.kind === 'red' ? `RED CARD  ·  ${this.names[ev.player]}` : `SO CLOSE!  ·  ${lastName(this.names[ev.player])}  ·  xG ${ev.xg?.toFixed(2)}`;
    c.save(); c.globalAlpha = a;
    c.font = `900 38px ${FONT}`; const w = c.measureText(text).width + 70;
    const x = W / 2 - w / 2, y = H - 240;
    this.pill(x, y, w, 76, 'rgba(15,17,21,0.9)', 14);
    c.fillStyle = this.limeGrad(x, y, x + w, y); c.fillRect(x, y + 70, w * easeOut(t / 0.6), 6);
    this.text(text, W / 2, y + 51, { size: 38, weight: 900, align: 'center' });
    c.restore();
  }
  keeperName(ev) {
    const save = this.d.events.find(e => e.type === 'save' && e.t >= ev.t && e.t - ev.t < 3);
    return save ? lastName(this.names[save.player]).toUpperCase() : 'KEEPER';
  }

  // ------------------------------------------------ persistent overlays

  drawBug() {
    const T = this._T, s = this.segAt(T);
    if (!['clip', 'replay'].includes(s.type)) return;
    const c = this.c, tSim = s.t0 + (T - s.start) * s.speed;
    const sc = this.scoreAt(tSim);
    const x = 60, y = 50, h = 64;
    c.save();
    c.shadowColor = 'rgba(0,0,0,.4)'; c.shadowBlur = 20;
    this.pill(x, y, 560, h, 'rgba(15,17,21,0.9)', 14);
    c.restore();
    if (this.A.league) c.drawImage(this.A.league, x + 12, y + 10, 44, 44);
    c.fillStyle = this.hc; c.fillRect(x + 70, y + 12, 6, 40);
    this.text(this.home.code, x + 88, y + 44, { size: 32, weight: 900 });
    this.pill(x + 184, y + 10, 124, 44, '#ffffff', 10);
    this.text(`${sc[0]} - ${sc[1]}`, x + 246, y + 44, { size: 32, weight: 900, align: 'center', colour: DARK });
    this.text(this.away.code, x + 322, y + 44, { size: 32, weight: 900 });
    c.fillStyle = this.ac; c.fillRect(x + 408, y + 12, 6, 40);
    this.pill(x + 428, y + 12, 120, 40, this.limeGrad(x + 428, y, x + 548, y), 10);
    this.text(this.clockAt(tSim), x + 488, y + 42, { size: 26, weight: 900, align: 'center', colour: DARK });
    // Corner watermark
    if (this.A.league) { c.globalAlpha = 0.75; c.drawImage(this.A.league, W - 110, H - 110, 60, 60); c.globalAlpha = 1; }
  }

  drawTransition(T) {
    // Branded wipe across every cut between segments.
    const c = this.c, len = 0.4;
    for (let i = 1; i < this.segs.length; i++) {
      const b = this.segs[i].start, d = T - b;
      if (d < -len || d > len) continue;
      const k = (d + len) / (2 * len);             // 0..1 across the cut
      const x = lerp(W * 1.25, -W * 0.6, easeInOut(k));
      c.save();
      c.translate(x, 0); c.transform(1, 0, -0.35, 1, 0, 0);
      c.fillStyle = DARK; c.fillRect(0, 0, W * 0.9, H);
      c.fillStyle = this.limeGrad(0, 0, 140, 0); c.fillRect(-60, 0, 60, H);
      c.fillStyle = 'rgba(143,255,6,0.35)'; c.fillRect(-110, 0, 22, H);
      c.fillStyle = this.limeGrad(W * 0.9, 0, W * 0.9 + 40, 0); c.fillRect(W * 0.9, 0, 40, H);
      c.restore();
      if (this.A.league && Math.abs(d) < len * 0.6) {
        const a = 1 - Math.abs(d) / (len * 0.6);
        c.save(); c.globalAlpha = a; c.drawImage(this.A.league, W / 2 - 80, H / 2 - 80, 160, 160); c.restore();
      }
    }
  }

  frame(T) { this._T = T; this.draw(T); return this.cv; }

  // ------------------------------------------------ audio cues (output times)

  audioCues() {
    const cues = [];
    for (let i = 1; i < this.segs.length; i++) cues.push({ type: 'whoosh', t: this.segs[i].start - 0.3 });
    cues.push({ type: 'boom', t: 0.4 }, { type: 'riser', t: 0 });
    for (const s of this.segs) {
      if (s.type === 'clip' || s.type === 'replay') cues.push({ type: 'crowd', t: s.start, dur: s.dur, level: s.type === 'replay' ? 0.6 : 1 });
      if (s.type === 'clip') {
        const et = s.start + (s.clip.t - s.t0) / s.speed;
        if (s.clip.kind === 'goal') cues.push({ type: 'roar', t: et });
        else cues.push({ type: 'ooh', t: et });
      }
      if (s.type === 'halftime') cues.push({ type: 'whistle', t: s.start + 0.2, n: 2 });
      if (s.type === 'fulltime') cues.push({ type: 'whistle', t: s.start + 0.2, n: 3 });
      if (s.type === 'outro') cues.push({ type: 'boom', t: s.start + 0.2 });
    }
    return cues;
  }
}

function shade(hex, k) {
  const c = safeColour(hex).slice(1), n = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
  return `rgb(${((n >> 16) & 255) * k | 0},${((n >> 8) & 255) * k | 0},${(n & 255) * k | 0})`;
}

// ---------------------------------------------------------------- audio synthesis

async function renderAudio(cues, duration) {
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * SR), SR);
  const noise = ctx.createBuffer(2, SR * 3, SR);
  for (let ch = 0; ch < 2; ch++) { const d = noise.getChannelData(ch); let b = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = (w * 0.35 + b * 2.2); } }
  const master = ctx.createDynamicsCompressor(); master.threshold.value = -14; master.ratio.value = 4; master.connect(ctx.destination);
  const src = (t, dur) => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.start(t, Math.random() * 2); s.stop(t + dur); return s; };
  const bp = (f, q) => { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; return b; };

  for (const c of cues) {
    const t = Math.max(0, c.t);
    if (c.type === 'crowd') {
      const s = src(t, c.dur), f = bp(700, 0.5), g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16 * c.level, t + 0.4);
      g.gain.setValueAtTime(0.16 * c.level, t + c.dur - 0.4); g.gain.linearRampToValueAtTime(0, t + c.dur);
      s.connect(f).connect(g).connect(master);
    } else if (c.type === 'roar' || c.type === 'ooh') {
      const big = c.type === 'roar', dur = big ? 6 : 2.4;
      for (const [freq, lvl] of [[450, 1], [1100, 0.7], [2400, 0.35]]) {
        const s = src(t, dur), f = bp(freq, 0.8), g = ctx.createGain();
        const peak = (big ? 0.75 : 0.32) * lvl;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + (big ? 0.35 : 0.5));
        g.gain.exponentialRampToValueAtTime(peak * 0.5, t + dur * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f).connect(g).connect(master);
      }
    } else if (c.type === 'whoosh') {
      const s = src(t, 0.7), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(4000, t + 0.55);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      s.connect(f).connect(g).connect(master);
    } else if (c.type === 'boom') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(38, t + 1.2);
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g).connect(master); o.start(t); o.stop(t + 1.7);
    } else if (c.type === 'riser') {
      const s = src(t, 1.4), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'highpass'; f.frequency.setValueAtTime(200, t); f.frequency.exponentialRampToValueAtTime(6000, t + 1.3);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 1.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      s.connect(f).connect(g).connect(master);
    } else if (c.type === 'whistle') {
      for (let i = 0; i < c.n; i++) {
        const st = t + i * 0.45, len = i === c.n - 1 ? 0.9 : 0.28;
        const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
        o.frequency.value = 2900; lfo.frequency.value = 38; lg.gain.value = 90;
        lfo.connect(lg).connect(o.frequency);
        g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.16, st + 0.03); g.gain.setValueAtTime(0.16, st + len - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, st + len);
        o.connect(g).connect(master); o.start(st); lfo.start(st); o.stop(st + len); lfo.stop(st + len);
      }
    }
  }
  return ctx.startRendering();
}

// ---------------------------------------------------------------- thumbnail and text

export async function makeThumbnail(r) {
  const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720;
  const c = cv.getContext('2d');
  // Re-use the renderer's drawing helpers on a scaled context.
  const saved = r.c; r.c = c;
  c.save(); c.scale(1280 / W, 720 / H);
  r.bg(0.55);
  for (const [side, col] of [[0, r.hc], [1, r.ac]]) {
    c.save(); c.beginPath();
    if (side === 0) { c.moveTo(0, 0); c.lineTo(W * 0.56, 0); c.lineTo(W * 0.44, H); c.lineTo(0, H); } else { c.moveTo(W, 0); c.lineTo(W * 0.56 + 8, 0); c.lineTo(W * 0.44 + 8, H); c.lineTo(W, H); }
    c.closePath(); c.clip();
    const g = c.createLinearGradient(side ? W : 0, 0, W / 2, H); g.addColorStop(0, col); g.addColorStop(1, 'rgba(11,13,17,0.2)');
    c.globalAlpha = 0.8; c.fillStyle = g; c.fillRect(0, 0, W, H); c.globalAlpha = 1;
    r.stripes(0, 0.8);
    c.restore();
  }
  for (const [side, team] of [[0, r.home], [1, r.away]]) {
    c.save(); c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 50;
    r.logoAt(team, side ? W * 0.78 : W * 0.22, H * 0.48, 480); c.restore();
  }
  r.pill(W / 2 - 280, H * 0.5 - 150, 560, 250, 'rgba(255,255,255,0.97)', 36);
  r.text(`${r.d.result.home}-${r.d.result.away}`, W / 2, H * 0.5 + 60, { size: 220, weight: 900, align: 'center', colour: DARK });
  r.pill(W / 2 - 420, 60, 840, 110, r.limeGrad(W / 2 - 420, 0, W / 2 + 420, 0), 24);
  r.text(`WEEK ${r.fx?.week ?? ''} HIGHLIGHTS`, W / 2, 140, { size: 66, weight: 900, align: 'center', colour: DARK, italic: true });
  r.text(`${r.home.code}  v  ${r.away.code}`, W / 2, H - 90, { size: 86, weight: 900, align: 'center', shadow: 24, italic: true });
  if (r.A.league) c.drawImage(r.A.league, 60, H - 210, 150, 150);
  c.restore();
  r.c = saved;
  return new Promise(res => cv.toBlob(res, 'image/png'));
}

export function youtubeText(r) {
  const d = r.d, h = r.home, a = r.away, wk = r.fx?.week ?? d.match.week ?? '';
  const k = kickoff(r.fx || {});
  const title = `${h.name} ${d.result.home}-${d.result.away} ${a.name} | Week ${wk} Highlights | Heineken C League S3`;
  const goals = r.goals.map(g => `${g.minute}' ${r.names[g.scorer]}${g.own_goal ? ' (OG)' : ''} (${g.team})${g.assist ? `, assist ${r.names[g.assist]}` : ''}`);
  const st = d.stats.teams;
  const ps = d.stats.players, motm = Object.keys(ps).reduce((b, x) => (!b || ps[x].rating > ps[b].rating ? x : b), null);
  const desc = [
    `${h.name} ${d.result.home}-${d.result.away} ${a.name}. Heineken C League Season ${r.season?.season ?? 3}, Week ${wk}${k ? `, ${k.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}.`,
    '',
    'GOALS',
    ...(goals.length ? goals : ['No goals']),
    '',
    'MATCH STATS',
    `Possession: ${st.home.possession}% - ${st.away.possession}%`,
    `xG: ${st.home.xg} - ${st.away.xg}`,
    `Shots (on target): ${st.home.shots} (${st.home.shots_on_target}) - ${st.away.shots} (${st.away.shots_on_target})`,
    '',
    `Player of the match: ${r.names[motm]} (${ps[motm].rating.toFixed(1)})`,
    '',
    'Full match replay, ladder and stats: https://ldg224.github.io/s3/',
    '',
    `#HCL #HeinekenCLeague #${h.code} #${a.code}`,
  ].join('\n');
  return { title, description: desc, text: `TITLE\n${title}\n\nDESCRIPTION\n${desc}\n` };
}

// ---------------------------------------------------------------- export

export function supported() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

export async function loadAssets(teams) {
  const logos = {}, logosAlt = {};
  await Promise.all(teams.map(async t => {
    logos[t.code] = await loadImg(logoPath(t.code));
    logosAlt[t.code] = await loadImg(logoPath(t.code, true));
  }));
  const [league, title] = await Promise.all([loadImg('assets/league/logo.png'), loadImg('assets/league/title.jpg')]);
  await Promise.all(['700', '800', '900'].map(w => document.fonts.load(`${w} 40px Inter`).catch(() => {})));
  return { logos, logosAlt, league, title };
}

// Renders and encodes the video. `fileHandle` (optional) streams straight to disk.
export async function exportVideo(renderer, { fileHandle, onProgress, onPreview, isCancelled }) {
  const total = Math.round(renderer.duration * FPS);
  let vcfg = { codec: 'avc1.640028', width: W, height: H, bitrate: 8_000_000, framerate: FPS, avc: { format: 'avc' } };
  if (!(await VideoEncoder.isConfigSupported(vcfg)).supported) vcfg = { ...vcfg, codec: 'avc1.4d0028' };
  if (!(await VideoEncoder.isConfigSupported(vcfg)).supported) throw new Error("This browser can't encode H.264 video. Use Chrome or Edge.");

  onProgress?.('Preparing audio…', 0);
  const audio = await renderAudio(renderer.audioCues(), renderer.duration);
  let acfg = null, audioCodec = null;
  if (typeof AudioEncoder !== 'undefined') {
    for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
      const cfg = { codec, sampleRate: SR, numberOfChannels: 2, bitrate: 160000 };
      if ((await AudioEncoder.isConfigSupported(cfg)).supported) { acfg = cfg; audioCodec = mux; break; }
    }
  }

  let writable = null;
  const target = fileHandle ? new FileSystemWritableFileStreamTarget(writable = await fileHandle.createWritable()) : new ArrayBufferTarget();
  const muxer = new Muxer({
    target, fastStart: fileHandle ? false : 'in-memory',
    video: { codec: 'avc', width: W, height: H, frameRate: FPS },
    ...(acfg ? { audio: { codec: audioCodec, numberOfChannels: 2, sampleRate: SR } } : {}),
  });
  let encErr = null;
  const venc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: e => { encErr = e; } });
  venc.configure(vcfg);

  for (let i = 0; i < total; i++) {
    if (isCancelled?.()) { venc.close(); if (writable) await writable.abort(); throw new Error('Cancelled'); }
    if (encErr) throw encErr;
    const cv = renderer.frame(i / FPS);
    const vf = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
    venc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
    vf.close();
    while (venc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 2));
    if (i % 15 === 0) { onProgress?.('Rendering video…', i / total); onPreview?.(cv); await new Promise(r => setTimeout(r, 0)); }
  }
  await venc.flush(); venc.close();

  if (acfg) {
    onProgress?.('Encoding audio…', 1);
    const aenc = new AudioEncoder({ output: (ch, meta) => muxer.addAudioChunk(ch, meta), error: e => { encErr = e; } });
    aenc.configure(acfg);
    const L = audio.getChannelData(0), R = audio.getChannelData(1), step = 1024;
    for (let off = 0; off < audio.length; off += step) {
      const n = Math.min(step, audio.length - off), buf = new Float32Array(n * 2);
      buf.set(L.subarray(off, off + n), 0); buf.set(R.subarray(off, off + n), n);
      aenc.encode(new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(off * 1e6 / SR), data: buf }));
      if (aenc.encodeQueueSize > 50) await new Promise(r => setTimeout(r, 1));
    }
    await aenc.flush(); aenc.close();
  }
  if (encErr) throw encErr;
  muxer.finalize();
  if (writable) { await writable.close(); return null; }
  return new Blob([target.buffer], { type: 'video/mp4' });
}
