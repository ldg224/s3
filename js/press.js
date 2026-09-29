// Press room: every manager's press-conference answers, statements and team news.

import { loadSeason, teamMap } from './data.js';
import { $, esc, logo } from './ui.js';
import { loadTeamFile } from './managers.js';

let S, T, files = {}, filter = 'all';

function render() {
  const items = [];
  for (const t of S.teams) {
    const f = files[t.code];
    if (!f) continue;
    for (const p of f.press || []) if (p.a) items.push({ team: t, ...p });
  }
  items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const shown = items.filter(i => filter === 'all' || i.team.code === filter);
  const news = S.teams.filter(t => files[t.code]?.message && (filter === 'all' || filter === t.code));
  const when = d => (d ? new Date(d).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
  $('#mount').innerHTML = `<div class="stack">
    <header class="page-head"><p class="eyebrow">Season 3</p><h1>Press room</h1><p>What the managers are saying.</p></header>
    <div class="chips"><button class="chip-btn" data-f="all" aria-pressed="${filter === 'all'}">All teams</button>${S.teams.map(t => `<button class="chip-btn" data-f="${esc(t.code)}" aria-pressed="${filter === t.code}">${esc(t.code)}</button>`).join('')}</div>
    ${news.length ? `<section class="card stack" style="gap:10px"><h2 class="card-title" style="margin:0">Team news</h2>${news.map(t => `<div class="qcard"><div class="chips" style="align-items:center">${logo(t, 26)}<b>${esc(t.name)}</b><span class="muted" style="font-size:.8rem">${esc(t.manager || '')}</span></div><div class="a">${esc(files[t.code].message)}</div></div>`).join('')}</section>` : ''}
    <section class="card stack" style="gap:12px"><h2 class="card-title" style="margin:0">Press conferences</h2>
      ${shown.map(i => `<article class="qcard"><div class="chips" style="align-items:center">${logo(i.team, 26)}<b>${esc(i.team.manager || i.team.name)}</b><span class="muted" style="font-size:.8rem">${esc(i.team.name)}</span></div>
        ${i.q && i.q !== 'Statement' ? `<div class="q">“${esc(i.q)}”</div>` : '<span class="from">Statement</span>'}<div class="a">${esc(i.a)}</div><span class="when">${esc(when(i.date))}</span></article>`).join('')
        || '<p class="empty">No press conferences yet. Managers answer the media’s questions after each match.</p>'}
    </section></div>`;
  document.querySelector('.chips').onclick = e => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; render(); } };
}

async function init() {
  try { S = await loadSeason(); } catch (e) { $('#mount').innerHTML = `<div class="card empty">Couldn't load the league. ${esc(e.message)}</div>`; return; }
  T = teamMap(S);
  const loaded = await Promise.all(S.teams.map(t => loadTeamFile(t.code)));
  S.teams.forEach((t, i) => { files[t.code] = loaded[i]; });
  render();
}

init();
