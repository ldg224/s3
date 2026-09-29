// League table page: standings (with movement, form and points adjustments) and top scorers.

import { loadSeason, teamMap, status, ladderWithMovement, playerTotals } from './data.js';
import { $, esc, logo, safeColour } from './ui.js';

let S, T;

function renderLadder() {
  const rows = ladderWithMovement(S);
  const played = S.fixtures.filter(f => status(f, S) === 'ft' && !f.stage).length;
  $('#games-played').textContent = played ? `${played} played` : '';
  const cut = S.finals?.teams || 4;
  $('#ladder-body').innerHTML = rows.map(r => {
    const mv = r.move > 0 ? `<small class="up">▲${r.move}</small>` : r.move < 0 ? `<small class="down">▼${-r.move}</small>` : '';
    const adj = r.adj ? `<sup class="adj" title="${r.adj > 0 ? '+' : ''}${r.adj} pts adjustment">*</sup>` : '';
    return `<tr class="${r.rank === cut && rows.length > cut ? 'cut' : ''}" style="--tc:${esc(safeColour(r.team.colour))}">
      <td class="pos">${r.rank}${mv}</td>
      <td class="t"><div>${logo(r.team, 28)}<span style="min-width:0"><b>${esc(r.team.code)}</b><small>${esc(r.team.name)}</small></span></div></td>
      <td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td class="gfga">${r.gf}</td><td class="gfga">${r.ga}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.pts}${adj}</td>
      <td class="form"><div class="form-dots">${r.form.map(o => `<i class="${o}">${o}</i>`).join('') || '<span class="muted">–</span>'}</div></td></tr>`;
  }).join('');
  $('#legend').textContent = `Top ${cut} (above the dashed line) qualify for the finals. ▲▼ shows movement since last week.`;
  // Footnote listing each points adjustment, under the table.
  const table = $('#ladder-body').closest('table');
  let notes = $('#ladder-notes');
  if (!notes) { notes = document.createElement('div'); notes.id = 'ladder-notes'; notes.className = 'ladder-notes'; table.after(notes); }
  notes.innerHTML = (S.adjustments || []).map(a => `<p>* ${esc(T[a.team]?.name || a.team)}: ${a.points > 0 ? '+' : ''}${a.points} pt${Math.abs(a.points) === 1 ? '' : 's'}${a.reason ? ` (${esc(a.reason)})` : ''}</p>`).join('');
  notes.hidden = !notes.innerHTML;
}

function renderScorers() {
  const list = Object.values(playerTotals(S)).filter(p => p.g > 0).sort((a, b) => b.g - a.g || b.a - a.a).slice(0, 10);
  $('#scorers').innerHTML = list.map(p => `<div class="mini-row" style="--tc:${esc(safeColour(T[p.team]?.colour))}"><span class="dot"></span>${esc(p.name)}<span class="muted" style="font-size:.72rem">${esc(p.team)}</span><span class="val">${p.g}</span></div>`).join('')
    || '<p class="empty">No goals yet. The race starts at the first kick-off.</p>';
}

function renderAll() {
  T = teamMap(S);
  $('#season-label').textContent = `Season ${S.season}`;
  renderLadder();
  renderScorers();
  $('#updated').textContent = S.updated ? `· Updated ${new Date(S.updated).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}` : '';
}

async function init() {
  try {
    S = await loadSeason();
    renderAll();
  } catch (e) {
    $('#ladder-body').innerHTML = `<tr><td colspan="11" class="empty">Couldn't load the league data. ${esc(e.message)}</td></tr>`;
    return;
  }
  // The table changes when a match reaches full time.
  let sig = S.fixtures.map(f => status(f, S)).join();
  setInterval(() => {
    const now = S.fixtures.map(f => status(f, S)).join();
    if (now !== sig) { sig = now; renderAll(); }
  }, 15000);
}

init();
