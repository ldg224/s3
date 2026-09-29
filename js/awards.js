import { loadSeason, teamMap, awards, playerTotals } from './data.js';
import { $, esc, safeColour } from './ui.js';

let S;

function render() {
  const T = teamMap(S);
  const col = code => esc(safeColour(T[code]?.colour));
  const cards = awards(S).filter(a => a.list.length);
  const unit = (a, v) => (String(v) === '1' && /s$/.test(a.label) ? a.label.slice(0, -1) : a.label);
  $('#awards').innerHTML = cards.map((a, i) => {
    const [w, ...rest] = a.list;
    const teamName = code => esc(T[code]?.name || code);
    return `<section class="card award" style="animation-delay:${i * 60}ms">
      <div class="award-icon">${a.icon}</div>
      <h2>${esc(a.title)}</h2><div class="sub">${esc(a.sub)}</div>
      <div class="winner"><span class="stat-badge">${esc(w.v)} ${esc(unit(a, w.v))}</span>
        <div class="who">${esc(w.name)}</div>
        ${a.team ? '' : `<span class="team-line" style="--tc:${col(w.team)}"><i></i>${teamName(w.team)}</span>`}</div>
      <div class="runners">${rest.map(r => `<div class="runner" style="--tc:${col(r.team)}"><i></i><span>${esc(r.name)}${a.team ? '' : `<br><small>${teamName(r.team)}</small>`}</span><b>${esc(r.v)} ${esc(unit(a, r.v))}</b></div>`).join('')}</div>
    </section>`;
  }).join('') || '<div class="card empty" style="grid-column:1/-1"><strong>No data yet</strong><br>Awards appear once matches reach full time.</div>';

  const P = Object.values(playerTotals(S)).filter(p => p.apps).sort((a, b) => b.g - a.g || b.a - a.a || b.avg - a.avg).slice(0, 20);
  $('#leaders').innerHTML = P.map((p, i) => `<tr><td>${i + 1}</td><td style="--tc:${col(p.team)}"><i></i>${esc(p.name)} <span class="muted" style="font-size:.72rem">${esc(p.team)}</span></td>
    <td>${p.apps}</td><td><b>${p.g}</b></td><td>${p.a}</td><td class="wide">${p.sh}</td><td class="wide">${p.xg.toFixed(2)}</td><td class="wide">${p.motm}</td><td>${p.avg.toFixed(2)}</td></tr>`).join('')
    || '<tr><td colspan="9" class="empty">No matches played yet.</td></tr>';
}

async function init() {
  try { S = await loadSeason(); render(); }
  catch (e) { $('#awards').innerHTML = `<div class="card empty">Award information unavailable. ${esc(e.message)}</div>`; }
  window.addEventListener('season-changed', e => { S = e.detail; render(); });
  setInterval(render, 60000);
}
init();
