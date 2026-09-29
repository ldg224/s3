import { loadSeason, teamMap, kickoff, status, shownScore, activeWeek, byKickoff, ladderWithMovement, playerTotals, sameDay } from './data.js';
import { $, esc, logo, watermark, fmtDate, fmtTime, countdown, statusPill, safeColour, matchUrl } from './ui.js';

let S, T;

function matchCard(fx, i = 0, big = false) {
  const h = T[fx.home] || { code: fx.home, name: fx.home }, a = T[fx.away] || { code: fx.away, name: fx.away };
  const st = status(fx, S), k = kickoff(fx), sc = shownScore(fx, S);
  const mid = sc ? `<span class="score-box">${sc.home} - ${sc.away}</span>` : '<span class="vs">VS</span>';
  const cd = st === 'upcoming' && k ? `<span class="countdown" data-kickoff="${k.getTime()}">${countdown(k)}</span>` : '';
  const btn = st === 'live' ? '▶ Watch live' : st === 'ft' ? '▶ Watch match' : 'Match centre';
  const size = big ? 72 : 38;
  return `<a class="match-card${big ? ' spotlight-card' : ''}" href="${matchUrl(fx)}" style="--h-color:${esc(safeColour(h.colour))};--a-color:${esc(safeColour(a.colour))};animation-delay:${(i % 10) * 40}ms">
    ${watermark(h.code, 'home')}${watermark(a.code, 'away')}
    <div class="mc-top"><span>Week ${esc(fx.week)}</span><span>${esc(fmtDate(k))} · ${esc(fmtTime(k))}</span></div>
    <div class="mc-grid">
      <div class="mc-side">${logo(h, size)}<div style="min-width:0"><div class="mc-code">${esc(h.code)}</div><div class="mc-name">${esc(h.name)}</div></div></div>
      <div class="mc-mid">${statusPill(st)}${mid}${cd}</div>
      <div class="mc-side away">${logo(a, size)}<div style="min-width:0"><div class="mc-code">${esc(a.code)}</div><div class="mc-name">${esc(a.name)}</div></div></div>
    </div>
    <div class="mc-foot"><span class="watch-btn">${btn}</span></div>
  </a>`;
}

function renderSpotlight() {
  const now = new Date();
  const fx = [...S.fixtures].sort(byKickoff);
  const live = fx.filter(f => status(f, S, now) === 'live');
  const next = fx.find(f => status(f, S, now) === 'upcoming');
  const last = fx.filter(f => status(f, S, now) === 'ft').pop();
  const pick = live[0] || next || last;
  const label = live.length ? '<span class="pulse"></span>Live now' : next ? 'Next up' : 'Latest result';
  $('#spotlight').innerHTML = pick
    ? `<p class="spot-label">${label}</p><div class="spotlight">${matchCard(pick, 0, true)}</div>`
    : '<p class="empty">No fixtures yet.</p>';
}

function renderToday() {
  const now = new Date(), tomorrow = new Date(now.getTime() + 86400000);
  const blocks = [['Today’s matches', now], ['Tomorrow’s matches', tomorrow]].map(([title, day]) => {
    const list = S.fixtures.filter(f => sameDay(kickoff(f), day)).sort(byKickoff);
    return list.length ? `<h2 class="section-title">${title}</h2><div class="week-block">${list.map(matchCard).join('')}</div>` : '';
  }).join('');
  $('#today-block').innerHTML = blocks;
  $('#today-block').hidden = !blocks;
}

function renderWeeks(selected) {
  const weeks = [...new Set(S.fixtures.map(f => f.week ?? 'TBA'))].sort((a, b) => (a === 'TBA') - (b === 'TBA') || a - b);
  const tabs = $('#week-tabs');
  tabs.innerHTML = weeks.map(w => `<button class="tab" role="tab" data-week="${esc(w)}" aria-selected="${String(w) === String(selected)}">${w === 'TBA' ? 'Unconfirmed' : `Week ${esc(w)}`}</button>`).join('');
  tabs.onclick = e => { const b = e.target.closest('.tab'); if (b) renderWeeks(b.dataset.week); };
  const sel = tabs.querySelector('[aria-selected="true"]');
  if (sel) tabs.scrollLeft = sel.offsetLeft - (tabs.clientWidth - sel.clientWidth) / 2;
  const list = S.fixtures.filter(f => String(f.week ?? 'TBA') === String(selected)).sort(byKickoff);
  $('#week-list').innerHTML = list.map(matchCard).join('') || '<p class="empty">No matches this week.</p>';
}

function renderLadder() {
  const rows = ladderWithMovement(S);
  const played = S.fixtures.filter(f => status(f, S) === 'ft').length;
  $('#games-played').textContent = played ? `${played} played` : '';
  $('#board').innerHTML = rows.map(r => {
    const mv = r.move > 0 ? `<span class="move up">▲${r.move}</span>` : r.move < 0 ? `<span class="move down">▼${-r.move}</span>` : '<span class="move same">– 0</span>';
    return `<div class="board-row" style="--tc:${esc(safeColour(r.team.colour))}">
      <img class="wm-row" src="assets/teams/${esc(r.team.code.toLowerCase())}-alt.png" alt="" onerror="this.remove()">
      <span class="board-pos">${r.rank}</span>
      <span class="logo-tile">${logo(r.team, 28)}</span>
      <span class="board-name"><b>${esc(r.team.code)}</b><span>${esc(r.team.name)}</span></span>
      ${mv}<span class="pts ${r.rank <= 4 ? 'top4' : ''}">${r.pts} PTS</span>
    </div>`;
  }).join('');
  $('#ladder-body').innerHTML = rows.map(r => `<tr style="--tc:${esc(safeColour(r.team.colour))}">
    <td><b>${r.rank}</b></td><td class="t"><div>${logo(r.team, 26)}${esc(r.team.name)}</div></td>
    <td>${r.p}</td><td class="wide">${r.w}</td><td class="wide">${r.d}</td><td class="wide">${r.l}</td>
    <td class="wide">${r.gf}</td><td class="wide">${r.ga}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td><b>${r.pts}</b></td>
    <td class="wide"><div class="form-dots">${r.form.map(o => `<i class="${o}">${o}</i>`).join('') || '<span class="muted">–</span>'}</div></td></tr>`).join('');
}

function renderScorers() {
  const list = Object.values(playerTotals(S)).filter(p => p.g > 0).sort((a, b) => b.g - a.g || b.a - a.a).slice(0, 5);
  $('#scorers').innerHTML = list.map(p => `<div class="mini-row" style="--tc:${esc(safeColour(T[p.team]?.colour))}"><span class="dot"></span>${esc(p.name)}<span class="muted" style="font-size:.72rem">${esc(p.team)}</span><span class="val">${p.g}</span></div>`).join('')
    || '<p class="empty">No goals yet.</p>';
}

function renderAll() {
  T = teamMap(S);
  $('#season-label').textContent = `Season ${['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][S.season] || S.season}`;
  const n = $('#notice');
  n.hidden = !S.notice;
  n.textContent = S.notice || '';
  renderSpotlight();
  renderToday();
  const current = document.querySelector('#week-tabs [aria-selected="true"]')?.dataset.week;
  renderWeeks(current ?? activeWeek(S));
  renderLadder();
  renderScorers();
  $('#updated').textContent = S.updated ? `Updated ${new Date(S.updated).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}` : '';
}

async function init() {
  try {
    S = await loadSeason();
    renderAll();
  } catch (e) {
    $('#spotlight').innerHTML = `<p class="empty">Couldn't load the league data. ${esc(e.message)}</p>`;
    return;
  }
  // Tick countdowns; re-render when a match changes state (kick-off, full time).
  let sig = S.fixtures.map(f => status(f, S)).join();
  setInterval(() => {
    document.querySelectorAll('.countdown[data-kickoff]').forEach(el => { el.textContent = countdown(new Date(+el.dataset.kickoff)); });
    const now = S.fixtures.map(f => status(f, S)).join();
    const live = S.fixtures.some(f => status(f, S) === 'live');
    if (now !== sig || live) { sig = now; renderAll(); }
  }, 15000);
  // Edit mode saves changes here too.
  window.addEventListener('season-changed', e => { S = e.detail; renderAll(); });
}

init();
