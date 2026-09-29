// Simulate a fixture in the browser with the HCL match engine.
//
//   import { simulateFixture } from './simulate.js';
//   const data = await simulateFixture(season, fixture, { onProgress: frac => {}, seed });
//
// `season` supplies the teams and players (offense/defense 1-10); `fixture` is { id, home, away, week, ... }.
// Returns a match-data object in the same format as an uploaded match file (what parseMatchBlob returns),
// so summariseMatch(data) works on it. The same fixture id always gives the same match unless a `seed`
// is passed. The engine (Pyodide, about 10 MB, cached by the browser) loads on the first call only.

import { suspensions } from './league.js';

const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'];
let worker = null, readyPromise = null, jobSeq = 0;
const pending = new Map();

function start() {
  if (worker) return readyPromise;
  worker = new Worker(new URL('./sim-worker.js', import.meta.url));
  readyPromise = new Promise((resolve, reject) => {
    worker.onmessage = e => {
      const m = e.data;
      if (m.type === 'ready') return resolve();
      if (m.type === 'failed') { reject(new Error(`The match simulator couldn't start: ${m.message}`)); worker = null; return; }
      const job = pending.get(m.job);
      if (!job) return;
      if (m.type === 'progress') { job.onProgress?.(m.p); return; }
      pending.delete(m.job);
      if (m.type === 'result') job.resolve(JSON.parse(m.payload));
      else job.reject(new Error(`The simulation failed: ${m.message}`));
    };
    worker.onerror = e => reject(new Error(`The match simulator couldn't start: ${e.message || 'worker error'}`));
  });
  return readyPromise;
}

// Resolves once the engine has loaded (starts loading it if it hasn't yet).
export function simulatorReady() { return start(); }

// Checks a team has a full squad the engine can play; throws a readable error if not.
function checkSquad(season, code) {
  const team = season.teams.find(t => t.code === code);
  if (!team) throw new Error(`Team ${code} isn't in the season's team list.`);
  const squad = (season.players || []).filter(p => p.team === code);
  if (squad.length < 11) throw new Error(`${team.name} has only ${squad.length} player${squad.length === 1 ? '' : 's'}; a team needs at least 11 to simulate a match.`);
  const missing = POSITIONS.filter(pos => !squad.some(p => (p.position || '').toUpperCase() === pos));
  if (missing.length) throw new Error(`${team.name} has no ${missing.join(', ')} in its squad. Each team needs at least one GK, DEF, MID and FWD.`);
  return { team, squad };
}

// A team's manager file (data/teams/<code>.json in lower case, written by the manager portal): formation, tactics,
// chosen XI and set-piece takers. Missing or unreadable means engine defaults.
async function managerFile(code) {
  try {
    const res = await fetch(new URL(`../data/teams/${code.toLowerCase()}.json?t=${Date.now()}`, import.meta.url), { cache: 'no-store' });
    return res.ok ? await res.json() : {};
  } catch { return {}; }
}

const FORMATIONS = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2'];
const TACTICS = ['tempo', 'pressing', 'width', 'line_height', 'directness'];

// The engine's tactics input for one team, using only players who are available for this match.
// Chosen players who are suspended or no longer in the squad are dropped; the engine fills their slots.
function managerTactics(file, available) {
  const ok = id => id != null && available.has(String(id));
  const t = {};
  if (FORMATIONS.includes(file.formation)) t.formation = file.formation;
  for (const k of TACTICS) {
    const v = Number(file.tactics?.[k]);
    if (file.tactics?.[k] != null && Number.isFinite(v)) t[k] = Math.min(1, Math.max(0, v));
  }
  if (t.formation && file.lineup && typeof file.lineup === 'object') {
    t.lineup = Object.fromEntries(Object.entries(file.lineup).filter(([, id]) => ok(id)).map(([slot, id]) => [slot, String(id)]));
  }
  for (const k of ['captain', 'penalties', 'freekicks', 'corners']) if (ok(file[k])) t[k] = String(file[k]);
  return t;
}

// The engine's league format, built only from the season's own teams and players.
// Suspended players (`out`) are left out, so a team can play short-handed.
function toLeague(season, codes, out = new Set(), managers = {}) {
  const teams = {}, players = {}, tactics = {};
  for (const code of codes) {
    const { team, squad } = checkSquad(season, code);
    const available = squad.filter(p => !out.has(String(p.id)));
    if (available.length < 7) throw new Error(`${team.name} has only ${available.length} players available after suspensions; at least 7 are needed.`);
    teams[code] = { code, name: team.name, manager: team.manager || '', colour: team.colour || '#888888' };
    tactics[code] = managerTactics(managers[code] || {}, new Set(available.map(p => String(p.id))));
    for (const p of available) {
      players[p.id] = {
        id: String(p.id), name: p.name, team: code, position: (p.position || 'MID').toUpperCase(),
        offense: Number(p.offense) || 5, defense: Number(p.defense) || 5,
      };
    }
  }
  return { teams, players, attributes: {}, tactics, schedule: [] };
}

export async function simulateFixture(season, fixture, { onProgress, seed } = {}) {
  if (!fixture?.home || !fixture?.away) throw new Error('The fixture needs a home and an away team.');
  if (fixture.home === fixture.away) throw new Error('A team can\'t play itself.');
  // Suspended players miss the match (red cards, second yellows and manual bans).
  const suspended = (suspensions(season).get(fixture.id) || []).map(s => ({ player: String(s.player), reason: s.reason }));
  const out = new Set(suspended.map(s => s.player));
  toLeague(season, [fixture.home, fixture.away], out);   // validates squads before loading anything
  const [home, away] = await Promise.all([managerFile(fixture.home), managerFile(fixture.away)]);
  const league = toLeague(season, [fixture.home, fixture.away], out, { [fixture.home]: home, [fixture.away]: away });
  await start();
  const job = ++jobSeq;
  return new Promise((resolve, reject) => {
    pending.set(job, { resolve, reject, onProgress });
    worker.postMessage({
      job, league: JSON.stringify(league), home: fixture.home, away: fixture.away,
      seed: seed ?? null,
      info: {
        fixture_id: fixture.id || null, week: fixture.week ?? null, date: fixture.date || null, time: fixture.time || null,
        stage: fixture.stage || null, suspended,
      },
    });
  });
}
