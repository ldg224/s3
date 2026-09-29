import { loadSeason, teamMap, kickoff, status, shownScore, activeWeek, byKickoff, ladderWithMovement, playerTotals, liveSimTime, clockAt } from './data.js';
import { $, esc, logo, fmtDate, fmtTime, dayLabel, countdown, safeColour, matchUrl } from './ui.js';

let S, T;

const NOTE = { awaiting: 'Result pending', tba: 'TBC', postponed: 'Postponed' };

// One row per fixture. Every match appears exactly once on the page, in its week.
function matchRow(fx) {
  const h = T[fx.home] || { code: fx.home, name: fx.home }, a = T[fx.away] || { code: fx.away, name: fx.away };
  const st = status(fx, S), k = kickoff(fx), sc = shownScore(fx, S);
  let main, note = NOTE[st] || '';
  if (sc) {
    main = `<span class="score">${sc.home}<i>–</i>${sc.away}</span>`;
    note = st === 'live' ? `<span class="live-note"><span class="pulse"></span>${esc(clockAt(fx.result.periods, liveSimTime(fx, S)))}</span>` : 'Full time';
  } else {
    main = `<span class="kick">${esc(fmtTime(k))}</span>`;
    if (st === 'upcoming' && k && k - new Date() < 86400000) note = `<span class="countdown" data-kickoff="${k.getTime()}">${countdown(k)}</span>`;
  }
  const team = (t, side) => {
    const name = `<span class="m-name"><b class="code">${esc(t.code)}</b><b class="full">${esc(t.name)}</b></span>`;
    return `<span class="m-team ${side}">${side === 'home' ? name + logo(t, 32) : logo(t, 32) + name}</span>`;
  };
  return `<a class="match${st === 'live' ? ' is-live' : ''}" href="${matchUrl(fx)}" aria-label="${esc(h.name)} v ${esc(a.name)}">
    ${team(h, 'home')}<span class="m-mid">${main}${note ? `<small>${note}</small>` : ''}</span>${team(a, 'away')}
  </a>`;
}

// Group a week's rows under day headings.
function dayGroups(list) {
  const groups = [];
  for (const fx of list) {
    const k = kickoff(fx), key = k ? k.toDateString() : 'tba';
    if (groups.at(-1)?.key !== key) groups.push({ key, k, rows: [] });
    groups.at(-1).rows.push(matchRow(fx));
  }
  return groups.map(g => {
    const label = dayLabel(g.k), full = g.k ? fmtDate(g.k) : '';
    return `<div class="day"><h3 class="day-head">${esc(label)}${label !== full && full ? ` <span>${esc(full)}</span>` : ''}</h3><div class="rows">${g.rows.join('')}</div></div>`;
  }).join('');
}

// One line of text under the title: what's happening right now.
function renderHero() {
  const fx = [...S.fixtures].sort(byKickoff);
  const live = fx.filter(f => status(f, S) === 'live');
  const next = fx.find(f => status(f, S) === 'upcoming');
  const name = f => `${T[f.home]?.name || f.home} v ${T[f.away]?.name || f.away}`;
  let text;
  if (live.length) text = `<span class="pulse" style="color:var(--live)"></span> ${live.length === 1 ? `Live now: ${esc(name(live[0]))}` : `${live.length} matches live now`}`;
  else if (next) text = `Next match: ${esc(name(next))}, ${esc(dayLabel(kickoff(next)))} at ${esc(fmtTime(kickoff(next)))}`;
  else text = fx.length ? 'All matches played.' : 'Fixtures coming soon.';
  $('#hero-status').innerHTML = text;
  const weeks = new Set(S.fixtures.map(f => f.week).filter(w => w != null));
  const played = S.fixtures.filter(f => status(f, S) === 'ft').length;
  const fact = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
  $('#hero-facts').innerHTML = fact(S.teams.length, 'Teams') + fact(`${activeWeek(S)}<small>/${weeks.size}</small>`, 'Week') + fact(`${played}<small>/${S.fixtures.length}</small>`, 'Played');
}

function renderWeeks(selected) {
  const weeks = [...new Set(S.fixtures.map(f => f.week ?? 'TBA'))].sort((a, b) => (a === 'TBA') - (b === 'TBA') || a - b);
  const tabs = $('#week-tabs');
  tabs.innerHTML = weeks.map(w => `<button class="tab" role="tab" data-week="${esc(w)}" aria-selected="${String(w) === String(selected)}">${w === 'TBA' ? 'Unconfirmed' : `Week ${esc(w)}`}</button>`).join('');
  tabs.onclick = e => { const b = e.target.closest('.tab'); if (b) renderWeeks(b.dataset.week); };
  const sel = tabs.querySelector('[aria-selected="true"]');
  if (sel) tabs.scrollLeft = sel.offsetLeft - (tabs.clientWidth - sel.clientWidth) / 2;
  const list = S.fixtures.filter(f => String(f.week ?? 'TBA') === String(selected)).sort(byKickoff);
  $('#week-list').innerHTML = dayGroups(list) || '<p class="empty">No matches this week.</p>';
}

function renderLadder() {
  const rows = ladderWithMovement(S);
  const played = S.fixtures.filter(f => status(f, S) === 'ft').length;
  $('#games-played').textContent = played ? `${played} played` : '';
  $('#ladder-body').innerHTML = rows.map(r => {
    const mv = r.move > 0 ? `<small class="up">▲${r.move}</small>` : r.move < 0 ? `<small class="down">▼${-r.move}</small>` : '';
    return `<tr class="${r.rank === 4 && rows.length > 4 ? 'cut' : ''}" style="--tc:${esc(safeColour(r.team.colour))}">
      <td class="pos">${r.rank}${mv}</td>
      <td class="t"><div>${logo(r.team, 28)}<span style="min-width:0"><b>${esc(r.team.code)}</b><small>${esc(r.team.name)}</small></span></div></td>
      <td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.pts}</td>
      <td class="form"><div class="form-dots">${r.form.map(o => `<i class="${o}">${o}</i>`).join('') || '<span class="muted">–</span>'}</div></td></tr>`;
  }).join('');
}

function renderScorers() {
  const list = Object.values(playerTotals(S)).filter(p => p.g > 0).sort((a, b) => b.g - a.g || b.a - a.a).slice(0, 5);
  $('#scorers').innerHTML = list.map(p => `<div class="mini-row" style="--tc:${esc(safeColour(T[p.team]?.colour))}"><span class="dot"></span>${esc(p.name)}<span class="muted" style="font-size:.72rem">${esc(p.team)}</span><span class="val">${p.g}</span></div>`).join('')
    || '<p class="empty">No goals yet.</p>';
}

function renderAll() {
  T = teamMap(S);
  $('#season-label').textContent = `Season ${S.season}`;
  $('#hero-eyebrow').textContent = `Season ${S.season}`;
  const n = $('#notice');
  n.hidden = !S.notice;
  n.textContent = S.notice || '';
  renderHero();
  const current = document.querySelector('#week-tabs [aria-selected="true"]')?.dataset.week;
  renderWeeks(current ?? activeWeek(S));
  renderLadder();
  renderScorers();
  $('#updated').textContent = S.updated ? `· Updated ${new Date(S.updated).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}` : '';
}

async function init() {
  try {
    S = await loadSeason();
    renderAll();
  } catch (e) {
    $('#week-list').innerHTML = `<p class="empty">Couldn't load the league data. ${esc(e.message)}</p>`;
    $('#hero-status').textContent = '';
    return;
  }
  // Tick countdowns; re-render when a match changes state (kick-off, full time) or while one is live.
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
