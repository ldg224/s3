import { loadSeason, teamMap, awards, playerTotals } from './data.js';
import { $, esc, logo } from './ui.js';

let S;

// Line icons (stroke = currentColor), keyed by award title.
const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  'Golden Boot': svg('<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 4.5h-5L8 10z"/><path d="M12 3v4M21 10l-5 0M3 10h5M15 21l-.5-6.5M9 21l.5-6.5"/>'),
  Playmaker: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  'Golden Glove': svg('<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  'Player of the Season': svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
  'Best Offense': svg('<path d="M4 20l7-7M14 4h6v6M20 4l-9 9"/>'),
  'Best Defense': svg('<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>'),
};

function render() {
  const T = teamMap(S);
  const team = code => T[code] || { code, name: code };
  const unit = (a, v) => (String(v) === '1' && /s$/.test(a.label) ? a.label.slice(0, -1) : a.label);
  const cards = awards(S).filter(a => a.list.length);
  $('#awards').innerHTML = cards.map((a, i) => {
    const [w, ...rest] = a.list;
    return `<section class="card award" style="animation-delay:${i * 50}ms">
      <div class="award-head"><span class="award-icon">${ICONS[a.title] || ICONS['Player of the Season']}</span><div><h2>${esc(a.title)}</h2><div class="sub">${esc(a.sub)}</div></div></div>
      <div class="winner">${logo(team(w.team), 44)}<div style="min-width:0"><div class="who">${esc(w.name)}</div>${a.team ? '' : `<div class="team">${esc(team(w.team).name)}</div>`}</div>
        <div class="val"><b>${esc(w.v)}</b><span>${esc(unit(a, w.v))}</span></div></div>
      <div class="runners">${rest.map((r, j) => `<div class="runner"><span class="rk">${j + 2}</span>${logo(team(r.team), 22)}<span>${esc(r.name)}${a.team ? '' : `<small>${esc(r.team)}</small>`}</span><b>${esc(r.v)}</b></div>`).join('')}</div>
    </section>`;
  }).join('') || '<div class="card empty" style="grid-column:1/-1"><strong>No data yet</strong><br>Awards appear once matches reach full time.</div>';

  const P = Object.values(playerTotals(S)).filter(p => p.apps).sort((a, b) => b.g - a.g || b.a - a.a || b.avg - a.avg).slice(0, 20);
  $('#leaders').innerHTML = P.map((p, i) => `<tr><td>${i + 1}</td><td><div>${logo(team(p.team), 22)}${esc(p.name)} <span class="muted" style="font-size:.72rem;font-weight:600">${esc(p.team)}</span></div></td>
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
