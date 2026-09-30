import { loadSeason, teamMap, kickoff, status, shownScore, activeWeek, byKickoff, liveSimTime, clockAt, addedAt } from './data.js';
import { $, esc, logo, parseStamp, fmtDate, fmtTime, dayLabel, countdown, matchUrl } from './ui.js';
import { STAGE_NAMES, sideTeam } from './league.js';
import { publicPosts, renderPost, publicTalliesShown } from './news.js';
import { loadTeamFiles } from './managers.js';
import { viewerBadge } from './viewers.js';

let S, T, teamFiles = {};
const LATEST = 3;

const NOTE = { awaiting: 'Result pending', tba: 'TBC', postponed: 'Postponed' };

// One row per fixture. Every match appears exactly once on the page, in its week.
function matchRow(fx) {
  const h = sideTeam(S, fx, 'home', T), a = sideTeam(S, fx, 'away', T);
  const st = status(fx, S), k = kickoff(fx), sc = shownScore(fx, S);
  let main, note = NOTE[st] || '';
  if (sc) {
    main = `<span class="score">${sc.home}<i>–</i>${sc.away}</span>`;
    note = st === 'live' ? `<span class="live-note"><span class="pulse"></span>${esc(clockAt(fx.result.periods, liveSimTime(fx, S)))}${addedAt(fx.result.periods, liveSimTime(fx, S)) ? ` <b class="added">+${addedAt(fx.result.periods, liveSimTime(fx, S))}</b>` : ''}</span>${viewerBadge(window.hclViewers?.matches?.[fx.id])}` : 'Full time';
  } else {
    main = st === 'postponed' ? '<span class="kick pp">P–P</span>' : `<span class="kick">${esc(fmtTime(k))}</span>`;
    if (st === 'postponed' && fx.postponed_reason) note = `Postponed: ${esc(fx.postponed_reason)}`;
    if (st === 'upcoming' && k && k - new Date() < 86400000) note = `<span class="countdown" data-kickoff="${k.getTime()}">${countdown(k)}</span>`;
  }
  const so = st === 'ft' ? fx.result.shootout : null;
  if (so) note = `${note} · Pens ${so.home}–${so.away}`;
  if (fx.stage) note = `<b class="stage-tag">${esc(STAGE_NAMES[fx.stage] || fx.stage)}</b>${note ? ' · ' + note : ''}`;
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
  const name = f => `${sideTeam(S, f, 'home', T).name} v ${sideTeam(S, f, 'away', T).name}`;
  let text;
  if (live.length) text = `<span class="pulse" style="color:var(--live)"></span> ${live.length === 1 ? `Live now: ${esc(name(live[0]))}` : `${live.length} matches live now`}`;
  else if (next) text = `Next match: ${esc(name(next))}, ${esc(dayLabel(kickoff(next)))} at ${esc(fmtTime(kickoff(next)))}`;
  else text = fx.length ? 'All matches played.' : 'The fixtures for the new season are coming soon.';
  $('#hero-status').innerHTML = text;
  const weeks = new Set(S.fixtures.map(f => f.week).filter(w => w != null));
  const played = S.fixtures.filter(f => status(f, S) === 'ft').length;
  const fact = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
  $('#hero-facts').innerHTML = fact(S.teams.length, 'Teams') + fact((S.players || []).filter(p => T[p.team]).length, 'Players')
    + (S.fixtures.length ? fact(`${activeWeek(S)}<small>/${weeks.size}</small>`, 'Week') + fact(`${played}<small>/${S.fixtures.length}</small>`, 'Played') : '')
    + (window.hclViewers?.site ? `<div class="fact-online"><b><span class="pulse" aria-hidden="true"></span>${window.hclViewers.site}</b><span>Online now</span></div>` : '');
}

function renderWeeks(selected) {
  const weeks = [...new Set(S.fixtures.map(f => f.week ?? 'TBA'))].sort((a, b) => (a === 'TBA') - (b === 'TBA') || a - b);
  const tabs = $('#week-tabs');
  tabs.innerHTML = weeks.map(w => `<button class="tab" role="tab" data-week="${esc(w)}" aria-selected="${String(w) === String(selected)}">${w === 'TBA' ? 'Unconfirmed' : `Week ${esc(w)}`}</button>`).join('');
  tabs.onclick = e => { const b = e.target.closest('.tab'); if (b) renderWeeks(b.dataset.week); };
  const sel = tabs.querySelector('[aria-selected="true"]');
  if (sel) tabs.scrollLeft = sel.offsetLeft - (tabs.clientWidth - sel.clientWidth) / 2;
  const list = S.fixtures.filter(f => String(f.week ?? 'TBA') === String(selected)).sort(byKickoff);
  $('#week-list').innerHTML = dayGroups(list) || `<p class="empty">${S.fixtures.length ? 'No matches this week.' : 'No fixtures yet. They’ll appear here as soon as they’re scheduled.'}</p>`;
}

// The latest league news, near the top of the page. Long posts are clipped with a link to news.html.
function renderNews() {
  const posts = publicPosts(S).slice(0, LATEST), box = $('#news-latest');
  box.hidden = !posts.length;
  if (!posts.length) return;
  $('#news-latest-list').innerHTML = posts.map(p => `<div class="nw-clip">${renderPost(p, S, { mode: 'public', teamFiles })}
    <a class="nw-readmore" href="news.html#news-${encodeURIComponent(p.id)}">Read more ›</a></div>`).join('');
  // Only show "Read more" on posts that were actually cut short.
  requestAnimationFrame(() => document.querySelectorAll('#news-latest-list .nw-clip').forEach(c => c.classList.toggle('clipped', c.scrollHeight > c.clientHeight + 4)));
}

function renderAll() {
  T = teamMap(S);
  $('#season-label').textContent = `Season ${S.season}`;
  $('#hero-eyebrow').textContent = `Season ${S.season}`;
  const n = $('#notice');
  n.hidden = !S.notice;
  n.textContent = S.notice || '';
  renderHero();
  renderNews();
  const current = document.querySelector('#week-tabs [aria-selected="true"]')?.dataset.week;
  renderWeeks(current ?? activeWeek(S));
  $('#updated').textContent = S.updated ? `· Updated ${parseStamp(S.updated).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}` : '';
}

async function init() {
  try {
    S = await loadSeason();
    renderAll();
    if (publicTalliesShown(publicPosts(S).slice(0, LATEST))) loadTeamFiles(S).then(f => { teamFiles = f; renderNews(); });
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
  // Live viewer counts (js/viewers.js): the site-wide counter and each live match.
  window.addEventListener('viewers', () => renderAll());
}

init();
