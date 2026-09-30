// Shows a team's press meters (docs/PRESS_EFFECT.md): fans, team happiness, team performance and
// the effect on the opposition. One renderer for every page, styled by the "Press meters" section
// of css/styles.css (classes pm-*). No data loading here: pass it one side of a press effect,
// i.e. fixture.result.press.home / .away, or pressEffect(...).home / .away.
//
//   pressMeters(side, { opp: 'Lads United', why: true })  -> four tiles (+ the reasons)
//   pressChips(side)                                       -> one compact line for lists

import { esc } from './ui.js';
import { moodLabel, LIMITS } from './press-effect.js';

const CAP = LIMITS.final, OPP = LIMITS.oppPerf;
const capTxt = v => `±${+(v * 100).toFixed(1)}%`;

// Direction for colour: 'up' (good for this team), 'down' (bad), 'flat'.
const dir = (v, scale) => (v / scale >= 0.05 ? 'up' : v / scale <= -0.05 ? 'down' : 'flat');
const arrow = d => (d === 'up' ? '▲' : d === 'down' ? '▼' : '●');
const sign = v => (v > 0 ? '+' : v < 0 ? '−' : '±');
const meterTxt = v => `${sign(v)}${Math.abs(Math.round(v))}`;
const pctTxt = v => `${sign(v)}${Math.abs(v * 100).toFixed(1)}%`;

// A bar that grows left (negative) or right (positive) from the centre line.
function bar(v, scale, d) {
  const w = Math.min(50, (Math.abs(v) / scale) * 50);
  return `<span class="pm-bar" aria-hidden="true"><i class="pm-fill ${d}" style="${v >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></i></span>`;
}

function tile(label, value, text, d, mood, title, scale, raw) {
  return `<div class="pm-tile" title="${esc(title)}">
    <span class="pm-label">${esc(label)}</span>
    <span class="pm-value ${d}"><span class="pm-arrow" aria-hidden="true">${arrow(d)}</span>${esc(text)}</span>
    ${bar(raw, scale, d)}
    <span class="pm-mood">${esc(mood)}</span>
  </div>`;
}

export function pressMeters(side, { opp = 'the opposition', why = false, title = '' } = {}) {
  if (!side) return '';
  const perfD = dir(side.final, CAP);
  // What this manager's jabs did to the opponent: negative is good for us, so the colour flips.
  const oppD = dir(-side.oppPerf, OPP);
  const tiles = [
    tile('Fans', side.fans, meterTxt(side.fans), dir(side.fans, 100), moodLabel('fans', side.fans), 'How the supporters feel (−100 to +100). Moves with results and with how the manager talks about the club and the fans.', 100, side.fans),
    tile('Team happiness', side.happiness, meterTxt(side.happiness), dir(side.happiness, 100), moodLabel('happiness', side.happiness), 'The dressing room (−100 to +100). Praise and unity lift it; blaming players in public drags it down.', 100, side.happiness),
    tile('Team performance', side.final, pctTxt(side.final), perfD, moodLabel('perf', side.final),
      `How much sharper or flatter the team plays this match (up to ${capTxt(CAP)}).${side.received ? ` Includes ${pctTxt(side.received)} from the other manager’s mind games.` : ''}`, CAP, side.final),
    tile(`Effect on ${opp}`, side.oppPerf, pctTxt(side.oppPerf), oppD, side.oppPerf < -0.001 ? 'Rattled them' : side.oppPerf > 0.001 ? 'Fired them up' : 'No effect',
      `What this manager’s comments about ${opp} did to them (up to ${capTxt(OPP)}). A sharp, true jab rattles them; empty trash talk fires them up.`, OPP, -side.oppPerf),
  ];
  const reasons = why ? whyList(side) : '';
  return `<section class="pm" aria-label="${esc(title || 'Press effect')}">
    ${title ? `<h3 class="pm-title">${esc(title)}</h3>` : ''}
    <div class="pm-grid">${tiles.join('')}</div>${reasons}</section>`;
}

// The reasons, as plain text (also the accessible, table-like view of the numbers).
export function whyList(side) {
  const rows = [
    ...(side.reasons || []).map(r => [r.meter === 'fans' ? 'Fans' : 'Team happiness', meterTxt(r.v), dir(r.v, 100), r.reason]),
    ...(side.jabs || []).map(j => ['Effect on the opposition', pctTxt(j.v), dir(-j.v, OPP), `“${j.quote}”: ${j.why}`]),
    ...(side.jabsReceived || []).map(j => ['Team performance', pctTxt(j.v), dir(j.v, OPP), `their manager said “${j.quote}”: ${j.why}`]),
  ];
  const extra = [
    side.repeats?.length ? `${side.repeats.length} repeated statement${side.repeats.length === 1 ? '' : 's'} counted once` : '',
    side.ignored?.length ? `${side.ignored.length} ignored (too short, gibberish or over the limit)` : '',
    side.carried && (side.carried.fans || side.carried.happiness) ? `carried over from last match: fans ${meterTxt(side.carried.fans)}, happiness ${meterTxt(side.carried.happiness)}` : '',
  ].filter(Boolean);
  if (!rows.length && !extra.length) return '<p class="pm-note">Nothing said this week has moved the meters yet.</p>';
  return `<details class="pm-why"><summary>Why</summary>
    <table class="pm-table"><thead><tr><th>Meter</th><th>Change</th><th>Because</th></tr></thead><tbody>
    ${rows.map(([m, v, d, why]) => `<tr><td>${esc(m)}</td><td class="pm-value ${d}">${esc(v)}</td><td>${esc(why)}</td></tr>`).join('')}
    </tbody></table>${extra.length ? `<p class="pm-note">${esc(extra.join(' · '))}</p>` : ''}</details>`;
}

// One line: "Fans +21 · Happiness +22 · Performance +1.1% · On opponent −0.9%".
export function pressChips(side) {
  if (!side) return '';
  const chip = (label, text, d) => `<span class="pm-chip ${d}"><span aria-hidden="true">${arrow(d)}</span> ${esc(label)} ${esc(text)}</span>`;
  return `<span class="pm-chips">${chip('Fans', meterTxt(side.fans), dir(side.fans, 100))}${chip('Happiness', meterTxt(side.happiness), dir(side.happiness, 100))}${chip('Performance', pctTxt(side.final), dir(side.final, CAP))}${chip('On opponent', pctTxt(side.oppPerf), dir(-side.oppPerf, OPP))}</span>`;
}
