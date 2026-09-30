// Where the press meters (docs/PRESS_EFFECT.md) appear on the public pages: the match page, the
// press room and the Manager Hub. Picks the numbers to show and hands them to js/press-view.js.
//
//   pressFor(season, files, fixture, memo)  -> { home, away } or null
//   nextFixture(season, code)               -> the team's next match (not kicked off), or null
//
// A simulated match shows the press effect frozen on its result (what the engine used). One that
// hasn't been simulated yet shows a live projection from what's been said so far. Results from
// before the press effect existed have nothing to show.

import { kickoff } from './data.js';
import { pressEffect } from './press-effect.js';

export function pressFor(season, files, fx, memo = new Map()) {
  if (!fx || !fx.home || !fx.away) return null;
  if (fx.result) return fx.result.press?.home && fx.result.press?.away ? fx.result.press : null;
  if (!files) return null;
  try { return pressEffect(season, files, fx, { now: new Date(), memo }); } catch { return null; }
}

export function nextFixture(season, code, now = new Date()) {
  return season.fixtures
    .filter(f => (f.home === code || f.away === code) && f.home && f.away && !f.postponed && kickoff(f) && kickoff(f) > now)
    .sort((a, b) => kickoff(a) - kickoff(b))[0] || null;
}

// "Heading into Sat 4 Oct v Lads United"
export function headingInto(fx, oppName) {
  const k = kickoff(fx);
  return `Heading into ${k ? k.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : 'the next match'} v ${oppName}`;
}
