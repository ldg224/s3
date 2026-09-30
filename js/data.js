// Season data: loading, match status, ladder, form, win chance and awards.
// Everything is derived from data/season.json; full match files are only loaded on the match page.

import { SEASON_FILE } from './config.js';

let season = null;

export async function loadSeason(force = false) {
  if (season && !force) return season;
  const res = await fetch(`${SEASON_FILE}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Couldn't load the season data (${res.status})`);
  season = await res.json();
  return season;
}
export function setSeason(s) { season = s; }

export const teamMap = s => Object.fromEntries(s.teams.map(t => [t.code, t]));

// ---------- Time and status ----------

export function kickoff(fx) {
  if (!fx.date) return null;
  const [y, m, d] = fx.date.split('-').map(Number);
  const [hh, mm] = (fx.time || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}

const liveMs = s => (s.live_minutes || 10) * 60000;

// upcoming | live | ft | awaiting (kicked off, no result uploaded) | tba | postponed
export function status(fx, s, now = new Date()) {
  if (fx.postponed) return 'postponed';
  const k = kickoff(fx);
  if (!k) return 'tba';
  if (now < k) return 'upcoming';
  if (!fx.result) return 'awaiting';
  if (now - k < liveMs(s)) return 'live';
  return 'ft';
}

// While live, the match plays out over live_minutes: how far into the match file are we?
export function liveSimTime(fx, s, now = new Date()) {
  const frac = Math.min(1, Math.max(0, (now - kickoff(fx)) / liveMs(s)));
  const periods = fx.result.periods || [];
  const t0 = periods.length ? periods[0].start_t : 0;
  return t0 + frac * (fx.result.duration_t - t0);
}
export const liveSpeed = (fx, s) => fx.result.duration_t / ((s.live_minutes || 10) * 60);

// Score as the public should see it right now.
export function shownScore(fx, s, now = new Date()) {
  const st = status(fx, s, now);
  if (st === 'ft') return { home: fx.result.home, away: fx.result.away };
  if (st !== 'live') return null;
  const t = liveSimTime(fx, s, now);
  const sc = { home: 0, away: 0 };
  for (const g of fx.result.goals) if (g.t <= t) sc[g.team === fx.home ? 'home' : 'away']++;
  return sc;
}

// Match clock for a match-file time t (seconds), e.g. "67:12".
export function clockAt(periods, t) {
  const p = [...periods].reverse().find(p => p.start_t <= t + 1e-6) || periods[0];
  const el = Math.max(0, t - p.start_t) + (p.period === 2 ? 2700 : 0);
  return `${String(Math.floor(el / 60)).padStart(2, '0')}:${String(Math.floor(el % 60)).padStart(2, '0')}`;
}

// Added time announced for the period at match-file time t, once its 45 minutes are up (else 0).
// The clock keeps running (e.g. 93:12) and this is shown beside it as "+4", like the fourth official's board.
export function addedAt(periods, t) {
  const p = [...periods].reverse().find(p => p.start_t <= t + 1e-6) || periods[0];
  return p && t - p.start_t >= 2700 && p.added_minutes ? p.added_minutes : 0;
}

export const byKickoff = (a, b) => (kickoff(a) ?? Infinity) - (kickoff(b) ?? Infinity);
export const finished = (s, now = new Date()) => s.fixtures.filter(f => status(f, s, now) === 'ft').sort(byKickoff);

// The week to show first: a week with a match today, else the next upcoming, else the latest.
export function activeWeek(s, now = new Date()) {
  const dated = s.fixtures.filter(f => kickoff(f)).sort(byKickoff);
  const today = dated.find(f => sameDay(kickoff(f), now));
  if (today) return today.week;
  const next = dated.find(f => ['upcoming', 'live', 'awaiting'].includes(status(f, s, now)));
  if (next) return next.week;
  return dated.length ? dated[dated.length - 1].week : (s.fixtures[0]?.week ?? 1);
}
export const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// ---------- Ladder ----------

export function ladder(s, fixtures = finished(s)) {
  const pts = s.points || { win: 3, draw: 1, loss: 0 };
  const rows = Object.fromEntries(s.teams.map(t => [t.code, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, adj: 0, form: [] }]));
  // Point adjustments (deductions or awards) count from the start; finals don't count at all.
  for (const a of s.adjustments || []) if (rows[a.team]) { rows[a.team].adj += a.points; rows[a.team].pts += a.points; }
  for (const f of fixtures) {
    if (f.stage) continue;
    const h = rows[f.home], a = rows[f.away];
    if (!h || !a) continue;
    const hs = f.result.home, as = f.result.away;
    for (const [r, gf, ga] of [[h, hs, as], [a, as, hs]]) {
      r.p++; r.gf += gf; r.ga += ga;
      const o = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
      r[o.toLowerCase()]++;
      r.pts += o === 'W' ? pts.win : o === 'D' ? pts.draw : pts.loss;
      r.form.push(o);
    }
  }
  const list = Object.values(rows).map(r => ({ ...r, gd: r.gf - r.ga, form: r.form.slice(-5) }));
  list.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.name.localeCompare(b.team.name));
  list.forEach((r, i) => { r.rank = i + 1; });
  return list;
}

// Position change compared with the ladder before the latest week that has results.
export function ladderWithMovement(s, now = new Date()) {
  const done = finished(s, now);
  const current = ladder(s, done);
  const lastWeek = done.length ? done[done.length - 1].week : null;
  const before = lastWeek == null ? current : ladder(s, done.filter(f => f.week !== lastWeek));
  const prev = Object.fromEntries(before.map(r => [r.team.code, r.rank]));
  current.forEach(r => { r.move = (before === current || !before.some(b => b.p > 0)) ? 0 : prev[r.team.code] - r.rank; });
  return current;
}

// ---------- Form, next match, win chance ----------

export function teamForm(s, code, before = new Date(8.64e15), n = 5) {
  return finished(s).filter(f => (f.home === code || f.away === code) && kickoff(f) < before).slice(-n);
}
export function resultFor(f, code) {
  const mine = f.home === code ? f.result.home : f.result.away;
  const theirs = f.home === code ? f.result.away : f.result.home;
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
}

// Poisson model from goals scored/conceded so far (same approach as Season 2).
export function winChance(s, home, away, excludeId) {
  const hist = finished(s).filter(f => f.id !== excludeId);
  const games = hist.length;
  const baseline = games ? hist.reduce((n, f) => n + f.result.home + f.result.away, 0) / (2 * games) : 1.5;
  const lad = ladder(s, hist);
  const metrics = code => {
    const mine = hist.filter(f => f.home === code || f.away === code);
    if (mine.length) {
      const sc = mine.reduce((n, f) => n + (f.home === code ? f.result.home : f.result.away), 0) / mine.length;
      const co = mine.reduce((n, f) => n + (f.home === code ? f.result.away : f.result.home), 0) / mine.length;
      return [sc, co];
    }
    const N = lad.length || 6, rank = lad.find(r => r.team.code === code)?.rank ?? Math.ceil(N / 2);
    const mult = 1 + (((N + 1) / 2 - rank) / N) * 0.3;
    return [baseline * mult, baseline * (2 - mult)];
  };
  const [hs, hc] = metrics(home), [as, ac] = metrics(away);
  const b = baseline || 1.5;
  const lh = Math.max(0.1, b * (hs / b) * (ac / b)), la = Math.max(0.1, b * (as / b) * (hc / b));
  const pois = (l, k) => Math.exp(-l) * l ** k / fact(k);
  let pw = 0, pd = 0, pl = 0;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const p = pois(lh, i) * pois(la, j);
    if (i > j) pw += p; else if (i === j) pd += p; else pl += p;
  }
  const tot = pw + pd + pl;
  if (!isFinite(tot) || tot <= 0) return { home: 33, draw: 34, away: 33 };
  const h = Math.round(pw / tot * 100), a = Math.round(pl / tot * 100);
  return { home: h, draw: 100 - h - a, away: a };
}
const fact = k => (k <= 1 ? 1 : k * fact(k - 1));

// ---------- Awards ----------

export function playerTotals(s, now = new Date()) {
  const tot = {};
  const cs = {};
  for (const f of finished(s, now)) {
    for (const [id, p] of Object.entries(f.result.players || {})) {
      const t = tot[id] ??= { id, name: p.name, team: p.team, apps: 0, min: 0, g: 0, a: 0, sh: 0, sot: 0, xg: 0, kp: 0, tk: 0, int: 0, sv: 0, yc: 0, rc: 0, rsum: 0, motm: 0, cs: 0, gc: 0, gk: 0 };
      t.name = p.name; t.team = p.team;
      t.apps++; t.min += p.min || 0;
      for (const k of ['g', 'a', 'sh', 'sot', 'xg', 'kp', 'tk', 'int', 'sv', 'yc', 'rc']) t[k] += p[k] || 0;
      t.rsum += p.r || 0;
      if (f.result.motm === id) t.motm++;
      if (p.slot === 'GK') {
        t.gk++;
        const conceded = p.team === f.home ? f.result.away : f.result.home;
        t.gc += conceded;
        if (conceded === 0) t.cs++;
      }
    }
    for (const [code, other] of [[f.home, f.result.away], [f.away, f.result.home]]) {
      const c = cs[code] ??= { cs: 0 };
      if (other === 0) c.cs++;
    }
  }
  Object.values(tot).forEach(t => { t.avg = t.apps ? t.rsum / t.apps : 0; t.xg = Math.round(t.xg * 100) / 100; });
  return tot;
}

export function awards(s, now = new Date()) {
  const P = Object.values(playerTotals(s, now));
  const lad = ladder(s, finished(s, now)).filter(r => r.p > 0);
  const top = (list, n = 4) => list.slice(0, n);
  return [
    { icon: '⚽', title: 'Golden Boot', sub: 'Top goalscorer', label: 'Goals',
      list: top(P.filter(p => p.g > 0).sort((a, b) => b.g - a.g || b.a - a.a || a.min - b.min)).map(p => ({ ...p, v: p.g })) },
    { icon: '🎯', title: 'Playmaker', sub: 'Most assists', label: 'Assists',
      list: top(P.filter(p => p.a > 0).sort((a, b) => b.a - a.a || b.kp - a.kp || b.g - a.g)).map(p => ({ ...p, v: p.a })) },
    { icon: '🧤', title: 'Golden Glove', sub: 'Most clean sheets', label: 'CS',
      list: top(P.filter(p => p.gk > 0).sort((a, b) => b.cs - a.cs || a.gc - b.gc || b.sv - a.sv)).map(p => ({ ...p, v: p.cs })) },
    { icon: '⭐', title: 'Player of the Season', sub: 'Best average match rating (2+ games)', label: 'Avg',
      list: top(P.filter(p => p.apps >= 2).sort((a, b) => b.avg - a.avg || b.motm - a.motm)).map(p => ({ ...p, v: p.avg.toFixed(2) })) },
    { icon: '⚔️', title: 'Best Offense', sub: 'Most goals per game', label: 'Per game', team: true,
      list: top([...lad].sort((a, b) => b.gf / b.p - a.gf / a.p || b.gf - a.gf)).map(r => ({ name: r.team.name, team: r.team.code, v: (r.gf / r.p).toFixed(2) })) },
    { icon: '🛡️', title: 'Best Defense', sub: 'Fewest goals conceded per game', label: 'Per game', team: true,
      list: top([...lad].sort((a, b) => a.ga / a.p - b.ga / b.p || a.ga - b.ga)).map(r => ({ name: r.team.name, team: r.team.code, v: (r.ga / r.p).toFixed(2) })) },
  ];
}

// ---------- Match files ----------

// Match files uploaded in edit mode this session, so they play before the site has rebuilt.
export const localFiles = new Map();

export async function loadMatchFile(path) {
  if (localFiles.has(path)) return parseMatchBlob(localFiles.get(path), true);
  const res = await fetch(path, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Couldn't load the match file (${res.status})`);
  const blob = await res.blob();
  return parseMatchBlob(blob, path.endsWith('.gz'));
}

export async function parseMatchBlob(blob, gz) {
  const bytes = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const isGz = gz || (bytes[0] === 0x1f && bytes[1] === 0x8b);
  const text = isGz ? await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text() : await blob.text();
  const data = JSON.parse(text);
  if (data.format !== 'hcl-match') throw new Error('This is not an HCL match file');
  return data;
}

// Compact result stored in season.json (mirrors the Python seeding script).
export function summariseMatch(d) {
  const names = Object.fromEntries(d.players.map(p => [p.id, p.name]));
  const slot = Object.fromEntries(d.players.map(p => [p.id, p.slot]));
  const team = Object.fromEntries(d.players.map(p => [p.id, p.team]));
  const goals = d.events.filter(e => e.type === 'goal').map(e => ({
    t: e.t, minute: e.minute, team: e.team, scorer: e.scorer, scorer_name: names[e.scorer] ?? null,
    assist: e.assist ?? null, assist_name: e.assist ? names[e.assist] ?? null : null, own_goal: !!e.own_goal,
  }));
  const cards = d.events.filter(e => e.type === 'card').map(e => ({ t: e.t, minute: e.minute, team: e.team, player: e.player, name: names[e.player] ?? null, card: e.card }));
  const players = {};
  for (const [id, s] of Object.entries(d.stats.players)) {
    players[id] = {
      name: names[id], team: team[id], slot: slot[id], min: s.minutes, g: s.goals, a: s.assists, og: s.own_goals,
      sh: s.shots, sot: s.shots_on_target, xg: s.xg, kp: s.key_passes, pas: s.passes, pc: s.passes_completed,
      tk: s.tackles_won, int: s.interceptions, clr: s.clearances, blk: s.blocks, sv: s.saves, gc: s.goals_conceded,
      yc: s.yellow, rc: s.red, km: s.distance_km, r: s.rating,
    };
  }
  const motm = Object.keys(players).reduce((best, id) => (!best || players[id].r > players[best].r ? id : best), null);
  const fr = d.frames.data;
  return {
    home: d.result.home, away: d.result.away, duration_t: fr[fr.length - 1][0] / 10, periods: d.periods,
    goals, cards, stats: d.stats.teams, players, motm, engine: d.engine.version, seed: d.engine.seed,
  };
}
