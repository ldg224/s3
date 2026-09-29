import { loadSeason, teamMap, kickoff, status, shownScore, liveSimTime, liveSpeed, clockAt, ladder, finished, teamForm, resultFor, winChance, loadMatchFile } from './data.js';
import { $, esc, logo, fmtTime, dayLabel, countdown, statusPill, safeColour, onColour, matchUrl } from './ui.js';
import { Replay } from './replay.js';
import { STAGE_NAMES, sideTeam, suspensions } from './league.js';

let S, T, FX, H, A, replay = null, matchData = null;

const POS_ORDER = ['GK', 'DEF', 'MID', 'FWD'];

function findFixture() {
  const q = new URLSearchParams(location.search);
  if (q.get('id')) return S.fixtures.find(f => f.id === q.get('id'));
  const w = q.get('week'), h = (q.get('home') || '').toUpperCase(), a = (q.get('away') || '').toUpperCase();
  return S.fixtures.find(f => String(f.week) === w && f.home === h && f.away === a);
}

const roster = code => (S.players || []).filter(p => p.team === code).sort((a, b) => POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position) || a.name.localeCompare(b.name));
const shirt = p => String(p.id).slice(-2);
const BALL = '<svg class="ball-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#fff"/><path d="M12 7.5l3.8 2.8-1.5 4.4H9.7L8.2 10.3z" fill="#111"/><path d="M12 2v5.5M22 10l-6.2.3M2 10l6.2.3M17.5 20l-3.2-5.3M6.5 20l3.2-5.3" stroke="#111" stroke-width="1.3" fill="none"/></svg>';

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
  const rank = c => lad.find(r => r.team.code === c && r.p > 0)?.rank;
  const ord = n => n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10 * (Math.floor(n / 10) % 10 !== 1)] || 'th');
  const side = t => `<a class="sb-team" href="table.html">${logo(t, 88)}
    <span class="sb-name">${esc(t.name)}</span>${t.manager ? `<span class="sb-manager">${esc(t.manager)}</span>` : ''}${rank(t.code) ? `<span class="chip">${ord(rank(t.code))} on ladder</span>` : ''}</a>`;
  const clock = st === 'live' ? `<span class="sb-clock" id="sb-clock">${clockAt(FX.result.periods, liveSimTime(FX, S))}</span>` : '';
  const cd = st === 'upcoming' && k ? `<span class="countdown" data-kickoff="${k.getTime()}">${countdown(k)}</span>` : '';
  return `<section class="card scoreboard" style="--h:${esc(safeColour(H.colour))};--a:${esc(safeColour(A.colour))}">
    ${side(H)}
    <div class="sb-mid">${statusPill(st)}
      <div class="sb-score" id="sb-score">${sc ? `${sc.home}<span class="sep">:</span>${sc.away}` : '-<span class="sep">:</span>-'}</div>
      ${clock}${cd}
      ${sc && st === 'ft' && FX.result.shootout ? `<div class="sb-pens">${FX.result.shootout.home}–${FX.result.shootout.away} on penalties</div>` : ''}
      ${st === 'postponed' && FX.postponed_reason ? `<div class="sb-meta">${esc(FX.postponed_reason)}</div>` : ''}
      <div class="sb-meta">${FX.stage ? `<b class="stage-tag">${esc(STAGE_NAMES[FX.stage] || FX.stage)}</b>` : `Week ${esc(FX.week)}`} ·${esc(dayLabel(k))} · ${esc(fmtTime(k))}</div>
    </div>
    ${side(A)}
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
      </div>`;
  } else if (st === 'upcoming') {
    inner = `<div class="replay-empty"><div><strong>Watch it live here from kick-off</strong>${k ? `<span class="countdown" data-kickoff="${k.getTime()}">${countdown(k)}</span>` : ''}</div></div>`;
  } else if (st === 'postponed') {
    inner = `<div class="replay-empty"><div><strong>Match postponed</strong>${esc(FX.postponed_reason || 'A new date will be set soon.')}</div></div>`;
  } else if (st === 'awaiting') {
    inner = '<div class="replay-empty"><div><strong>Result coming soon</strong>The match file hasn’t been uploaded yet.</div></div>';
  } else {
    inner = '<div class="replay-empty"><div><strong>Kick-off not confirmed</strong>Check back once the fixture is scheduled.</div></div>';
  }
  return `<section class="card replay-card"><h2 class="card-title">${st === 'live' ? 'Live match' : st === 'ft' ? 'Match replay' : 'Live broadcast'}${st === 'live' ? statusPill('live') : ''}</h2>${inner}</section>`;
}

function timelineCard() {
  const vt = visibleTime();
  if (vt < 0) return '';
  const ev = [...FX.result.goals.map(g => ({ ...g, kind: 'goal' })), ...(FX.result.cards || []).map(c => ({ ...c, kind: 'card' }))]
    .filter(e => e.t <= vt).sort((a, b) => a.t - b.t);
  const rows = ev.map(e => {
    const home = e.team === FX.home, t = home ? H : A, col = safeColour(t.colour);
    const chip = `<span class="tl-min" style="background:linear-gradient(135deg,${esc(col)},rgba(0,0,0,.4));color:${onColour(col)}">${esc(e.minute)}'</span>`;
    const text = e.kind === 'goal'
      ? `<span>${esc(e.scorer_name || 'Unknown')}${e.own_goal ? ' (OG)' : ''}${e.assist_name ? `<span class="tl-sub">Assist: ${esc(e.assist_name)}</span>` : ''}</span>`
      : `<span>${esc(e.name)}<span class="tl-sub">${e.card === 'yellow' ? 'Yellow card' : e.card === 'second_yellow' ? 'Second yellow' : 'Red card'}</span></span>`;
    const icon = e.kind === 'goal' ? BALL : `<i class="card-ico ${e.card === 'yellow' ? 'yellow' : 'red'}"></i>`;
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

function shootoutCard() {
  const so = FX.result?.shootout;
  if (!so) return '';
  const kicks = side => so.kicks.filter(k => k.side === side).map(k => `<i class="pen ${k.scored ? 'in' : 'out'}" title="${esc(k.name)}: ${k.scored ? 'scored' : 'missed'}">${k.scored ? '●' : '✕'}</i>`).join('');
  return `<section class="card"><h2 class="card-title">Penalty shootout</h2>
    <div class="pens-row"><b>${esc(H.code)}</b><span class="pens">${kicks('home')}</span><b>${so.home}</b></div>
    <div class="pens-row"><b>${esc(A.code)}</b><span class="pens">${kicks('away')}</span><b>${so.away}</b></div></section>`;
}

function rosterCard() {
  const played = status(FX, S) === 'ft', vt = visibleTime();
  // Suspended players: from the match file once simulated, otherwise worked out from earlier cards and bans.
  const susp = new Map((matchData?.match?.suspended || suspensions(S).get(FX.id) || []).map(s => [String(s.player), s.reason]));
  const goalsBy = {};
  if (vt >= 0) for (const g of FX.result.goals) if (g.t <= vt && !g.own_goal) goalsBy[g.scorer] = (goalsBy[g.scorer] || 0) + 1;
  const table = code => {
    const t = T[code] || {}, col = safeColour(t.colour);
    const rows = roster(code).map(p => {
      const r = played ? FX.result.players[p.id]?.r : null;
      const rc = r == null ? '' : r >= 7.5 ? '#34d399' : r >= 6.5 ? '#fbbf24' : '#f87171';
      return `<tr><td class="num">${esc(shirt(p))}</td><td>${esc(p.name)}${goalsBy[p.id] ? ` <span class="goal-dots" title="Goals">${BALL.repeat(goalsBy[p.id])}</span>` : ''}${susp.has(String(p.id)) ? ` <span class="susp" title="${esc(susp.get(String(p.id)))}">Suspended</span>` : ''}</td><td>${esc(p.position)}</td><td class="o">${p.offense}</td><td class="d">${p.defense}</td>${played ? `<td class="r">${r != null ? `<span class="rating-chip" style="background:${rc}">${r.toFixed(1)}</span>` : ''}</td>` : ''}</tr>`;
    }).join('');
    return `<div><div class="team-head" style="--tc:${esc(col)}"><i></i>${esc(code)} lineup</div>
      <table class="roster"><thead><tr><th>#</th><th>Name</th><th>Pos</th><th>Off</th><th>Def</th>${played ? '<th style="text-align:right">Rating</th>' : ''}</tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">No players listed.</td></tr>'}</tbody></table></div>`;
  };
  return `<section class="card"><h2 class="card-title">Lineups <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:600">Off / Def ratings out of 10</span></h2><div class="two">${table(FX.home)}${table(FX.away)}</div></section>`;
}

function formCard() {
  const k = kickoff(FX) || new Date(8.64e15);
  const col = code => {
    const t = T[code] || {};
    const list = teamForm(S, code, k).reverse().map(f => `<a class="form-item" href="${matchUrl(f)}">${esc(f.home)} <b>${f.result.home} - ${f.result.away}</b> ${esc(f.away)}<span class="res ${resultFor(f, code)}">${resultFor(f, code)}</span></a>`).join('');
    return `<div><div class="team-head" style="--tc:${esc(safeColour(t.colour))}"><i></i>${esc(t.name || code)}</div><div class="form-list">${list || '<p class="empty">No recent matches</p>'}</div></div>`;
  };
  return `<section class="card"><h2 class="card-title">Recent form</h2><div class="two">${col(FX.home)}${col(FX.away)}</div></section>`;
}

// ---------- Page ----------

function render() {
  const st = status(FX, S), known = FX.home && FX.away;
  const side = [st === 'ft' ? shootoutCard() : '', st === 'ft' ? motmCard() : '', st === 'ft' ? statsCard() : known ? winChanceCard() : ''].join('');
  $('#mount').innerHTML = `<div class="stack">
    ${scoreboard()}
    <div class="match-layout">
      <div class="stack">${replayCard()}<div id="timeline-slot">${timelineCard()}</div></div>
      <aside class="stack">${side}</aside>
    </div>
    ${known ? `<div id="roster-slot">${rosterCard()}</div>${formCard()}` : ''}
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
  const label = e => e.type === 'goal' ? `GOAL! ${names[e.scorer] || ''}${e.own_goal ? ' (OG)' : ''} · ${e.score.join('-')}`
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
    if (n !== tick.events) { tick.events = n; $('#timeline-slot').innerHTML = timelineCard(); const rs = $('#roster-slot'); if (rs) rs.innerHTML = rosterCard(); }
  }
}

async function init() {
  try { S = await loadSeason(); } catch (e) { $('#mount').innerHTML = `<div class="card empty">Match information unavailable. ${esc(e.message)}</div>`; return; }
  T = teamMap(S);
  FX = findFixture();
  if (!FX) { $('#mount').innerHTML = '<div class="card empty">Match not found. Please pick a match from the schedule.</div>'; return; }
  H = sideTeam(S, FX, 'home', T);
  A = sideTeam(S, FX, 'away', T);
  tick.last = status(FX, S);
  render();
  setInterval(tick, 1000);
  window.addEventListener('season-changed', e => { S = e.detail; T = teamMap(S); FX = findFixture() || FX; H = sideTeam(S, FX, 'home', T); A = sideTeam(S, FX, 'away', T); matchData = null; render(); });
}

init();
