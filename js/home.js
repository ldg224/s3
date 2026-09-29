import { SEASON } from './config.js';
import { loadSeason, currentWeek } from './data.js';
import { esc, teamBadge, formatDate, formatTime, countdownText, STATE_LABELS } from './ui.js';

const $ = sel => document.querySelector(sel);

function scoreOrTime(f) {
  if (f.state === 'result' || (f.state === 'live' && f.homeScore !== null)) {
    return `<span class="score">${f.homeScore}<span class="score-sep">–</span>${f.awayScore}</span>`;
  }
  return `<span class="kickoff">${esc(formatTime(f.kickoff) || 'TBA')}</span>`;
}

function fixtureRow(f) {
  const winner = f.state === 'result' && f.homeScore !== f.awayScore
    ? (f.homeScore > f.awayScore ? 'home' : 'away') : '';
  return `
    <li class="fixture state-${f.state}">
      <div class="fixture-team home ${winner === 'away' ? 'lost' : ''}">
        <span class="team-name">${esc(f.home.name)}</span>${teamBadge(f.home, 32)}
      </div>
      <div class="fixture-mid">
        ${scoreOrTime(f)}
        <span class="state-pill">${STATE_LABELS[f.state]}</span>
      </div>
      <div class="fixture-team away ${winner === 'home' ? 'lost' : ''}">
        ${teamBadge(f.away, 32)}<span class="team-name">${esc(f.away.name)}</span>
      </div>
    </li>`;
}

function renderNextMatch(fixtures) {
  const mount = $('#next-match');
  const live = fixtures.filter(f => f.state === 'live');
  const next = fixtures
    .filter(f => f.state === 'upcoming')
    .sort((a, b) => a.kickoff - b.kickoff)[0];
  // Between rounds or after the season, feature the most recent result instead.
  const latest = fixtures
    .filter(x => x.state === 'result' && x.kickoff)
    .sort((a, b) => b.kickoff - a.kickoff)[0];
  const f = live[0] || next || latest;

  if (!f) {
    mount.innerHTML = '<p class="muted">No matches scheduled yet.</p>';
    return;
  }

  const label = { live: '<span class="live-dot"></span>Live now', upcoming: 'Next match', result: 'Latest result' }[f.state];
  const showScore = f.homeScore !== null && (f.state === 'live' || f.state === 'result');

  mount.innerHTML = `
    <p class="eyebrow">${label} · Week ${esc(f.week ?? '?')}</p>
    <div class="feature">
      <div class="feature-team">${teamBadge(f.home, 72)}<span>${esc(f.home.name)}</span></div>
      <div class="feature-mid">
        <span class="feature-vs">${showScore ? `${f.homeScore} – ${f.awayScore}` : 'vs'}</span>
        <span class="muted">${esc(formatDate(f.kickoff))} · ${esc(formatTime(f.kickoff))}</span>
        ${f.state === 'upcoming' ? `<span class="countdown" data-kickoff="${f.kickoff.getTime()}">${countdownText(f.kickoff)}</span>` : ''}
      </div>
      <div class="feature-team">${teamBadge(f.away, 72)}<span>${esc(f.away.name)}</span></div>
    </div>`;
}

function renderLadder(standings) {
  $('#ladder-body').innerHTML = standings.map(r => `
    <tr style="--team:${esc(r.team.colour)}">
      <td class="rank">${r.rank}</td>
      <th scope="row" class="ladder-team"><div class="team-cell">${teamBadge(r.team, 28)}<span>${esc(r.team.name)}</span></div></th>
      <td>${r.played}</td>
      <td class="wide">${r.won}</td>
      <td class="wide">${r.drawn}</td>
      <td class="wide">${r.lost}</td>
      <td class="wide">${r.gf}</td>
      <td class="wide">${r.ga}</td>
      <td>${r.gd > 0 ? '+' : ''}${r.gd}</td>
      <td class="pts">${r.points}</td>
      <td class="form wide">${r.form.map(o => `<span class="form-${o}">${o}</span>`).join('') || '<span class="muted">–</span>'}</td>
    </tr>`).join('');
}

function renderWeek(fixtures, week) {
  const list = fixtures
    .filter(f => (f.week ?? 'TBA') === week)
    .sort((a, b) => (a.kickoff ?? Infinity) - (b.kickoff ?? Infinity));

  // Group a week's matches by day, since a round can span more than one day.
  const days = new Map();
  for (const f of list) {
    const key = formatDate(f.kickoff);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(f);
  }

  $('#fixtures-list').innerHTML = [...days].map(([day, items]) => `
    <h3 class="day-heading">${esc(day)}</h3>
    <ul class="fixture-list">${items.map(fixtureRow).join('')}</ul>`).join('')
    || '<p class="muted">No matches this week.</p>';

  document.querySelectorAll('.week-tab').forEach(btn => {
    const selected = btn.dataset.week === String(week);
    btn.setAttribute('aria-selected', String(selected));
    if (selected) {
      // Centre the tab within the scrollable bar without scrolling the page itself.
      const bar = btn.parentElement;
      bar.scrollLeft = btn.offsetLeft - (bar.clientWidth - btn.clientWidth) / 2;
    }
  });
}

function renderWeekTabs(fixtures, active) {
  const weeks = [...new Set(fixtures.map(f => f.week ?? 'TBA'))]
    .sort((a, b) => (a === 'TBA') - (b === 'TBA') || a - b);

  const tabs = $('#week-tabs');
  tabs.innerHTML = weeks.map(w => `
    <button type="button" class="week-tab" role="tab" data-week="${esc(w)}">
      ${w === 'TBA' ? 'TBA' : `Wk ${esc(w)}`}
    </button>`).join('');

  tabs.addEventListener('click', e => {
    const btn = e.target.closest('.week-tab');
    if (!btn) return;
    const w = btn.dataset.week === 'TBA' ? 'TBA' : Number(btn.dataset.week);
    renderWeek(fixtures, w);
  });

  renderWeek(fixtures, weeks.includes(active) ? active : weeks[0]);
}

function tickCountdowns() {
  document.querySelectorAll('.countdown[data-kickoff]').forEach(el => {
    el.textContent = countdownText(new Date(Number(el.dataset.kickoff)));
  });
}

async function init() {
  $('#season-label').textContent = `Season ${SEASON.number}`;
  if (SEASON.notice) {
    $('#preview-banner').textContent = SEASON.notice;
    $('#preview-banner').hidden = false;
  }

  try {
    const { fixtures, standings } = await loadSeason();
    renderNextMatch(fixtures);
    renderLadder(standings);
    renderWeekTabs(fixtures, currentWeek(fixtures));
    setInterval(tickCountdowns, 30000);
    $('#updated').textContent = `Updated ${new Date().toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`;
  } catch (err) {
    console.error(err);
    $('#load-error').hidden = false;
    $('#load-error-detail').textContent = err.message;
  }
}

init();
