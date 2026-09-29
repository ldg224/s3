import { loadSeason, teamMap, kickoff, status, shownScore, liveSimTime, liveSpeed, clockAt, ladder, finished, teamForm, resultFor, nextMatch, winChance, loadMatchFile } from './data.js';
import { $, esc, logo, fmtDate, fmtTime, countdown, statusPill, safeColour, onColour, matchUrl, logoPath } from './ui.js';
import { Replay } from './replay.js';

let S, T, FX, H, A, replay = null, matchData = null;

const POS_ORDER = ['GK', 'DEF', 'MID', 'FWD'];
const OFF_W = { FWD: 1.3, MID: 1.1, DEF: 0.8, GK: 0 };
const DEF_W = { GK: 1.3, DEF: 1.2, MID: 1.0, FWD: 0.7 };

function findFixture() {
  const q = new URLSearchParams(location.search);
  if (q.get('id')) return S.fixtures.find(f => f.id === q.get('id'));
  const w = q.get('week'), h = (q.get('home') || '').toUpperCase(), a = (q.get('away') || '').toUpperCase();
  return S.fixtures.find(f => String(f.week) === w && f.home === h && f.away === a);
}

const roster = code => (S.players || []).filter(p => p.team === code).sort((a, b) => POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position) || a.name.localeCompare(b.name));
const shirt = p => String(p.id).slice(-2);
function teamRatings(code) {
  const r = roster(code);
  const wm = (key, W) => { let s = 0, w = 0; for (const p of r) { const k = W[p.position] ?? (key === 'offense' ? 0 : 1); s += p[key] * k; w += k; } return w ? Math.round(s / w * 10) / 10 : 0; };
  return { off: wm('offense', OFF_W), def: wm('defense', DEF_W) };
}
const captain = code => roster(code).reduce((best, p) => (!best || p.offense + p.defense > best.offense + best.defense ? p : best), null);

// Events visible now (hides the future while a match is live).
function visibleTime() {
  const st = status(FX, S);
  if (st === 'live') return liveSimTime(FX, S);
  return st === 'ft' ? Infinity : -1;
}

// ---------- Sections ----------

function scoreboard() {
  const st = status(FX, S), k = kickoff(FX), sc = shownScore(FX, S);
  const lad = ladder(S, finished(S));
  const rank = c => lad.find(r => r.team.code === c && r.p > 0)?.rank ?? 'N/A';
  const side = (t, cls) => `<a class="sb-team" href="index.html#ladder"><span class="logo-wrap">${logo(t, 95)}</span>
    <span class="sb-name">${esc(t.name)}</span><span class="sb-manager">${esc(t.manager || '')}</span><span class="chip">Rank ${rank(t.code)}</span></a>`;
  const clock = st === 'live' ? `<span class="sb-clock" id="sb-clock">${clockAt(FX.result.periods, liveSimTime(FX, S))}</span>` : '';
  const cd = st === 'upcoming' && k ? `<span class="countdown" data-kickoff="${k.getTime()}">${countdown(k)}</span>` : '';
  return `<section class="card scoreboard" style="--h:${esc(safeColour(H.colour))};--a:${esc(safeColour(A.colour))}">
    <img class="sb-wm home" src="${logoPath(H.code, true)}" alt="" onerror="this.remove()"><img class="sb-wm away" src="${logoPath(A.code, true)}" alt="" onerror="this.remove()">
    ${side(H, 'home')}
    <div class="sb-mid">${statusPill(st)}
      <div class="sb-score" id="sb-score">${sc ? `${sc.home}<span class="sep">:</span>${sc.away}` : '-<span class="sep">:</span>-'}</div>
      ${clock}${cd}
      <div class="sb-meta">Week ${esc(FX.week)} · ${esc(fmtDate(k))} · ${esc(fmtTime(k))}</div>
    </div>
    ${side(A, 'away')}
  </section>`;
}

function winChanceCard() {
  const w = winChance(S, FX.home, FX.away, FX.id);
  return `<section class="card"><h2 class="card-title">Win chance</h2>
    <div class="wc-labels"><span style="color:${esc(safeColour(H.colour))}">${esc(H.code)} ${w.home}%</span><span class="muted">Draw ${w.draw}%</span><span style="color:${esc(safeColour(A.colour))}">${esc(A.code)} ${w.away}%</span></div>
    <div class="wc-bar"><span style="width:${w.home}%;background:linear-gradient(90deg,${esc(safeColour(H.colour))},rgba(255,255,255,.2))"></span><span style="width:${w.draw}%;background:rgba(255,255,255,.12)"></span><span style="width:${w.away}%;background:linear-gradient(90deg,rgba(255,255,255,.2),${esc(safeColour(A.colour))})"></span></div>
  </section>`;
}

function replayCard() {
  const st = status(FX, S), k = kickoff(FX);
  let inner;
  if (st === 'live' || st === 'ft') {
    inner = `<div class="replay-wrap"><canvas id="pitch" width="1110" height="740" aria-label="Match replay"></canvas><div class="replay-caption" id="caption"></div></div>
      <div class="replay-controls">
        <button class="ctl" id="play">Play</button>
        ${st === 'live' ? '<button class="ctl live" id="golive">● Live</button>' : '<select class="ctl" id="speed" aria-label="Speed"><option value="1">1x</option><option value="2">2x</option><option value="4" selected>4x</option><option value="8">8x</option><option value="16">16x</option><option value="40">40x</option></select>'}
        <span class="replay-clock" id="rclock">00:00</span>
        <input type="range" id="seek" min="0" max="1" step="0.1" value="0" aria-label="Match time">
        <a class="ctl" href="${esc(FX.file)}" download>JSON</a>
      </div>`;
  } else if (st === 'upcoming') {
    inner = `<div class="replay-empty"><div><strong>The match will be shown here at kick-off</strong>${k ? `<span class="countdown" data-kickoff="${k.getTime()}">${countdown(k)}</span>` : ''}</div></div>`;
  } else if (st === 'awaiting') {
    inner = '<div class="replay-empty"><div><strong>Result coming soon</strong>The match file hasn’t been uploaded yet.</div></div>';
  } else {
    inner = '<div class="replay-empty"><div><strong>Kick-off not confirmed</strong>Check back once the fixture is scheduled.</div></div>';
  }
  return `<section class="card replay-card"><h2 class="card-title">${st === 'live' ? 'Live match' : 'Match replay'}${st === 'live' ? statusPill('live') : ''}</h2>${inner}</section>`;
}

function timelineCard() {
  const vt = visibleTime();
  const st = status(FX, S);
  if (vt < 0) return `<section class="card"><h2 class="card-title">Match timeline</h2><p class="empty">${st === 'upcoming' ? 'The timeline fills in live from kick-off.' : 'No events yet.'}</p></section>`;
  const ev = [...FX.result.goals.map(g => ({ ...g, kind: 'goal' })), ...(FX.result.cards || []).map(c => ({ ...c, kind: 'card' }))]
    .filter(e => e.t <= vt).sort((a, b) => a.t - b.t);
  const rows = ev.map(e => {
    const home = e.team === FX.home, t = home ? H : A, col = safeColour(t.colour);
    const chip = `<span class="tl-min" style="background:linear-gradient(135deg,${esc(col)},rgba(0,0,0,.4));color:${onColour(col)}">${esc(e.minute)}'</span>`;
    const text = e.kind === 'goal'
      ? `<span>${esc(e.scorer_name || 'Unknown')}${e.own_goal ? ' (OG)' : ''}${e.assist_name ? `<span class="tl-sub">Assist: ${esc(e.assist_name)}</span>` : ''}</span>`
      : `<span>${esc(e.name)}<span class="tl-sub">${e.card === 'yellow' ? 'Yellow card' : e.card === 'second_yellow' ? 'Second yellow' : 'Red card'}</span></span>`;
    const icon = e.kind === 'goal' ? '⚽' : e.card === 'yellow' ? '🟨' : '🟥';
    return `<div class="tl-row" data-t="${e.t}">
      <div class="side home">${home ? text + chip : ''}</div><div class="tl-icon">${icon}</div><div class="side">${home ? '' : chip + text}</div></div>`;
  }).join('');
  return `<section class="card"><h2 class="card-title">Match timeline</h2><div class="timeline" id="timeline">${rows || '<p class="empty">No goals or cards.</p>'}</div></section>`;
}

function statsCard() {
  const s = FX.result.stats;
  const rows = [['Possession %', 'possession'], ['xG', 'xg'], ['Shots', 'shots'], ['On target', 'shots_on_target'], ['Big chances', 'big_chances'], ['Passes', 'passes'], ['Pass accuracy %', 'pass_accuracy'], ['Tackles won', 'tackles_won'], ['Interceptions', 'interceptions'], ['Saves', 'saves'], ['Fouls', 'fouls'], ['Corners', 'corners'], ['Offsides', 'offsides'], ['Yellow cards', 'yellow_cards'], ['Red cards', 'red_cards']];
  const hc = safeColour(H.colour), ac = safeColour(A.colour);
  return `<section class="card"><h2 class="card-title">Match stats</h2>${rows.map(([l, k]) => {
    const h = +s.home[k] || 0, a = +s.away[k] || 0, tot = h + a || 1;
    return `<div class="stat-label">${l}</div><div class="stat-row"><b>${s.home[k]}</b><div class="stat-bars"><span style="flex:${h / tot};background:${esc(hc)}"></span><span style="flex:${a / tot};background:${esc(ac)}"></span></div><b>${s.away[k]}</b></div>`;
  }).join('')}</section>`;
}

function motmCard() {
  const id = FX.result.motm, p = FX.result.players[id];
  if (!p) return '';
  const t = T[p.team] || { code: p.team };
  return `<section class="card"><h2 class="card-title">Player of the match</h2>
    <div class="motm">${logo(t, 44)}<div><div style="font-weight:900;font-size:1.05rem">${esc(p.name)}</div>
    <div class="muted" style="font-size:.78rem">${esc(t.name || p.team)} · ${p.g ? `${p.g} goal${p.g > 1 ? 's' : ''} · ` : ''}${p.a ? `${p.a} assist${p.a > 1 ? 's' : ''} · ` : ''}${p.pc}/${p.pas} passes</div></div>
    <span class="rating">${p.r.toFixed(1)}</span></div></section>`;
}

function pitchCard() {
  const vt = visibleTime();
  const goalsBy = {};
  if (vt >= 0) for (const g of FX.result.goals) if (g.t <= vt && !g.own_goal) goalsBy[g.scorer] = (goalsBy[g.scorer] || 0) + 1;
  const half = (code, cls) => {
    const t = T[code] || {}, col = safeColour(t.colour), cap = captain(code);
    const cols = POS_ORDER.map(pos => roster(code).filter(p => p.position === pos)).filter(c => c.length);
    return `<div class="half ${cls}">${cols.map(c => `<div class="pcol">${c.map(p => `
      <div class="pnode"><span class="pbadge" style="--tc:${esc(col)};background:radial-gradient(circle at 35% 35%,${esc(col)},#0b0d11);color:${onColour(col)}">${esc(shirt(p))}</span>
      ${cap && cap.id === p.id ? '<span class="pcap">C</span>' : ''}${goalsBy[p.id] ? `<span class="pgoals">${'⚽'.repeat(goalsBy[p.id])}</span>` : ''}
      <span class="pname">${esc(p.name.split(' ').slice(-1)[0])}</span></div>`).join('')}</div>`).join('')}</div>`;
  };
  const rh = teamRatings(FX.home), ra = teamRatings(FX.away);
  const hud = (label, v, cls, away) => `<div class="hud-item ${away ? 'away' : ''}">${label} <b>${v}</b><div class="hud-bar ${cls}"><span style="width:${v * 10}%"></span></div></div>`;
  const lines = `<div class="line" style="left:50%;top:0;bottom:0;border-width:0 0 0 2px"></div><div class="line" style="left:calc(50% - 65px);top:calc(50% - 65px);width:130px;height:130px;border-radius:50%"></div>
    <div class="line" style="left:0;top:calc(50% - 120px);width:90px;height:240px;border-left:0"></div><div class="line" style="right:0;top:calc(50% - 120px);width:90px;height:240px;border-right:0"></div>
    <div class="line" style="left:0;top:calc(50% - 55px);width:35px;height:110px;border-left:0"></div><div class="line" style="right:0;top:calc(50% - 55px);width:35px;height:110px;border-right:0"></div>`;
  return `<section class="card"><h2 class="card-title">Squads</h2>
    <div class="pitch-scroll"><div class="pitch">${lines}${half(FX.home, 'home')}${half(FX.away, 'away')}</div></div>
    <div class="hud">${hud(`${esc(H.code)} offence`, rh.off, 'off')}${hud(`${esc(A.code)} offence`, ra.off, 'off', true)}${hud(`${esc(H.code)} defence`, rh.def, 'def')}${hud(`${esc(A.code)} defence`, ra.def, 'def', true)}</div>
  </section>`;
}

function rosterCard() {
  const played = status(FX, S) === 'ft';
  const table = code => {
    const t = T[code] || {}, col = safeColour(t.colour);
    const rows = roster(code).map(p => {
      const r = played ? FX.result.players[p.id]?.r : null;
      const rc = r == null ? '' : r >= 7.5 ? '#34d399' : r >= 6.5 ? '#fbbf24' : '#f87171';
      return `<tr><td class="num">${esc(shirt(p))}</td><td>${esc(p.name)}</td><td>${esc(p.position)}</td><td class="o">${p.offense}</td><td class="d">${p.defense}</td>${played ? `<td class="r">${r != null ? `<span class="rating-chip" style="background:${rc}">${r.toFixed(1)}</span>` : ''}</td>` : ''}</tr>`;
    }).join('');
    return `<div><div class="team-head" style="--tc:${esc(col)}"><i></i>${esc(code)} lineup</div>
      <table class="roster"><thead><tr><th>#</th><th>Name</th><th>Pos</th><th>Off</th><th>Def</th>${played ? '<th style="text-align:right">Rating</th>' : ''}</tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">No players listed.</td></tr>'}</tbody></table></div>`;
  };
  return `<section class="card"><h2 class="card-title">Lineups</h2><div class="two">${table(FX.home)}${table(FX.away)}</div></section>`;
}

function formCard() {
  const k = kickoff(FX) || new Date(8.64e15);
  const col = code => {
    const t = T[code] || {};
    const list = teamForm(S, code, k).reverse().map(f => `<a class="form-item" href="${matchUrl(f)}">${esc(f.home)} <b>${f.result.home} - ${f.result.away}</b> ${esc(f.away)}<span class="res ${resultFor(f, code)}">${resultFor(f, code)}</span></a>`).join('');
    return `<div><div class="team-head" style="--tc:${esc(safeColour(t.colour))}"><i></i>${esc(t.name || code)}</div><div class="form-list">${list || '<p class="empty">No recent matches</p>'}</div></div>`;
  };
  const next = code => {
    const n = nextMatch(S, code, k);
    if (!n) return '<p class="empty">No upcoming matches scheduled</p>';
    const oppCode = n.home === code ? n.away : n.home, o = T[oppCode] || { code: oppCode, name: oppCode };
    return `<a class="next-card" href="${matchUrl(n)}" style="--tc:${esc(safeColour(o.colour))}"><img class="wm away" src="${logoPath(o.code, true)}" alt="" style="height:160%;top:-30%;right:-15%;opacity:.04" onerror="this.remove()">
      ${logo(o, 64)}<div><div class="wk">WK ${esc(n.week)}</div><div class="opp">${n.home === code ? 'vs' : '@'} ${esc(o.name)}</div><div class="when">${esc(fmtDate(kickoff(n)))} · ${esc(fmtTime(kickoff(n)))}</div></div></a>`;
  };
  return `<section class="card"><h2 class="card-title">Team form (last 5)</h2><div class="two">${col(FX.home)}${col(FX.away)}</div></section>
    <section class="card"><h2 class="card-title">Next match</h2><div class="two">${next(FX.home)}${next(FX.away)}</div></section>`;
}

// ---------- Page ----------

function render() {
  const st = status(FX, S);
  const side = [st === 'ft' ? motmCard() : '', st === 'ft' ? statsCard() : winChanceCard()].join('');
  $('#mount').innerHTML = `<div class="stack">
    ${scoreboard()}
    <div class="match-layout">
      <div class="stack">${replayCard()}<div id="timeline-slot">${timelineCard()}</div></div>
      <aside class="stack">${side}</aside>
    </div>
    <div id="pitch-slot">${pitchCard()}</div>
    ${rosterCard()}
    ${formCard()}
  </div>`;
  document.title = `${H.code} v ${A.code} | HCL S3`;
  if (st === 'live' || st === 'ft') startReplay(st);
}

async function startReplay(st) {
  const cv = $('#pitch');
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0d2817'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#9ca3af'; ctx.font = '700 22px Inter, system-ui'; ctx.textAlign = 'center'; ctx.fillText('Loading match…', cv.width / 2, cv.height / 2);
  try {
    matchData = matchData || await loadMatchFile(FX.file);
  } catch (e) {
    ctx.fillStyle = '#0d2817'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#f87171'; ctx.fillText(e.message, cv.width / 2, cv.height / 2);
    return;
  }
  if (replay) replay.destroy();
  const periods = matchData.periods;
  const shown = matchData.events.filter(e => ['goal', 'shot', 'save', 'card', 'penalty', 'woodwork', 'offside'].includes(e.type));
  const names = Object.fromEntries(matchData.players.map(p => [p.id, p.name]));
  const caption = $('#caption');
  const label = e => e.type === 'goal' ? `⚽ GOAL! ${names[e.scorer] || ''}${e.own_goal ? ' (OG)' : ''} · ${e.score.join('-')}`
    : e.type === 'shot' ? `Shot · ${names[e.player]} · ${e.outcome}` : e.type === 'save' ? `Save · ${names[e.player]}`
    : e.type === 'card' ? `${e.card === 'yellow' ? '🟨' : '🟥'} ${names[e.player]}` : e.type === 'woodwork' ? 'Off the woodwork!' : e.type === 'penalty' ? 'Penalty!' : `Offside · ${names[e.player]}`;
  replay = new Replay(cv, matchData, {
    onFrame: t => {
      $('#rclock').textContent = clockAt(periods, t);
      const seek = $('#seek'); seek.value = t;
      const recent = shown.filter(e => e.t <= t && t - e.t < 4).pop();
      caption.classList.toggle('show', !!recent);
      if (recent) caption.textContent = `${recent.minute}' ${label(recent)}`;
    },
  });
  const seek = $('#seek');
  seek.min = replay.t0; seek.max = replay.t1;
  seek.oninput = e => replay.seek(+e.target.value);
  const playBtn = $('#play');
  const setBtn = () => { playBtn.textContent = replay.playing ? 'Pause' : 'Play'; };
  playBtn.onclick = () => { replay.playing ? replay.pause() : replay.play(); setBtn(); };
  $('#timeline-slot').addEventListener('click', e => { const r = e.target.closest('.tl-row'); if (r) { replay.seek(+r.dataset.t - 6); replay.play(); setBtn(); } });
  if (st === 'live') {
    replay.maxT = () => liveSimTime(FX, S);
    replay.speed = liveSpeed(FX, S);
    replay.seek(liveSimTime(FX, S));
    replay.play();
    $('#golive').onclick = () => { replay.speed = liveSpeed(FX, S); replay.seek(liveSimTime(FX, S)); replay.play(); setBtn(); };
  } else {
    replay.speed = +$('#speed').value;
    $('#speed').onchange = e => { replay.speed = +e.target.value; };
  }
  setBtn();
}

function tick() {
  document.querySelectorAll('.countdown[data-kickoff]').forEach(el => { el.textContent = countdown(new Date(+el.dataset.kickoff)); });
  const st = status(FX, S);
  if (st !== tick.last) { tick.last = st; render(); return; }
  if (st === 'live') {
    const sc = shownScore(FX, S);
    $('#sb-score').innerHTML = `${sc.home}<span class="sep">:</span>${sc.away}`;
    const c = $('#sb-clock'); if (c) c.textContent = clockAt(FX.result.periods, liveSimTime(FX, S));
    const n = [...FX.result.goals, ...(FX.result.cards || [])].filter(e => e.t <= liveSimTime(FX, S)).length;
    if (n !== tick.events) { tick.events = n; $('#timeline-slot').innerHTML = timelineCard(); $('#pitch-slot').innerHTML = pitchCard(); }
  }
}

async function init() {
  try { S = await loadSeason(); } catch (e) { $('#mount').innerHTML = `<div class="card empty">Match information unavailable. ${esc(e.message)}</div>`; return; }
  T = teamMap(S);
  FX = findFixture();
  if (!FX) { $('#mount').innerHTML = '<div class="card empty">Match not found. Please pick a match from the schedule.</div>'; return; }
  H = T[FX.home] || { code: FX.home, name: FX.home };
  A = T[FX.away] || { code: FX.away, name: FX.away };
  tick.last = status(FX, S);
  render();
  setInterval(tick, 1000);
  window.addEventListener('season-changed', e => { S = e.detail; T = teamMap(S); FX = findFixture() || FX; matchData = null; render(); });
}

init();
