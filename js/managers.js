// Shared by the manager portal, the press room and edit mode: formations, tactics,
// manager logins and each team's manager file (data/teams/<CODE>.json).
//
// Logins: the admin sets an email and PIN per team in edit mode. Only a salted, slow hash
// is published (season.managers[CODE] = { salt, hash }), never the email or PIN. Saving
// goes through the manager relay (tools/manager-relay.gs), which checks the same hash and
// can only write that team's file.

import { kickoff, status, ladder, finished, playerTotals } from './data.js';

// The simulator's formations (js/sim/hcl_sim/tactics.py). x/y are % across a vertical pitch,
// attacking upwards: y 0 = own goal line, 100 = opponent's. `want` = preferred position.
const L = { GK: 9, DEF: 26, MID: 48, AM: 65, FWD: 80 };
const slot = (line, across, adj, want) => ({ x: across / 68 * 100, y: L[line] + adj * 1.4, want });
// Player ratings use the real-world scale (like FotMob / Sofascore), not the league's blues:
// green is good, amber average, red poor. Works as a chip background (dark text) or as the
// colour of the number itself. The Man of the Match gets a mid blue chip with white text.
export const MOTM_BLUE = '#1e88e5';
export function ratingColour(r) {
  if (!r) return 'rgba(255,255,255,.12)';
  return r >= 8 ? '#22c55e' : r >= 7 ? '#a3e635' : r >= 6 ? '#fbbf24' : '#f87171';
}

export const FORMATIONS = {
  '4-3-3': {
    GK: slot('GK', 34, 0, 'GK'), LB: slot('DEF', 7, 0, 'DEF'), LCB: slot('DEF', 25, -1, 'DEF'), RCB: slot('DEF', 43, -1, 'DEF'), RB: slot('DEF', 61, 0, 'DEF'),
    LCM: slot('MID', 21, 3, 'MID'), CDM: slot('MID', 34, -5, 'MID'), RCM: slot('MID', 47, 3, 'MID'),
    LW: slot('FWD', 8, -3, 'FWD'), ST: slot('FWD', 34, 1, 'FWD'), RW: slot('FWD', 60, -3, 'FWD'),
  },
  '4-4-2': {
    GK: slot('GK', 34, 0, 'GK'), LB: slot('DEF', 7, 0, 'DEF'), LCB: slot('DEF', 25, -1, 'DEF'), RCB: slot('DEF', 43, -1, 'DEF'), RB: slot('DEF', 61, 0, 'DEF'),
    LM: slot('MID', 8, 1, 'MID'), LCM: slot('MID', 26, -1, 'MID'), RCM: slot('MID', 42, -1, 'MID'), RM: slot('MID', 60, 1, 'MID'),
    LST: slot('FWD', 28, 0, 'FWD'), RST: slot('FWD', 40, 0, 'FWD'),
  },
  '4-2-3-1': {
    GK: slot('GK', 34, 0, 'GK'), LB: slot('DEF', 7, 0, 'DEF'), LCB: slot('DEF', 25, -1, 'DEF'), RCB: slot('DEF', 43, -1, 'DEF'), RB: slot('DEF', 61, 0, 'DEF'),
    LDM: slot('MID', 27, -3, 'MID'), RDM: slot('MID', 41, -3, 'MID'),
    LW: slot('AM', 9, 0, 'FWD'), CAM: slot('AM', 34, 0, 'MID'), RW: slot('AM', 59, 0, 'FWD'), ST: slot('FWD', 34, 2, 'FWD'),
  },
  '3-5-2': {
    GK: slot('GK', 34, 0, 'GK'), LCB: slot('DEF', 20, 0, 'DEF'), CB: slot('DEF', 34, -2, 'DEF'), RCB: slot('DEF', 48, 0, 'DEF'),
    LWB: slot('MID', 6, -2, 'DEF'), LCM: slot('MID', 24, 1, 'MID'), CDM: slot('MID', 34, -4, 'MID'), RCM: slot('MID', 44, 1, 'MID'), RWB: slot('MID', 62, -2, 'DEF'),
    LST: slot('FWD', 28, 0, 'FWD'), RST: slot('FWD', 40, 0, 'FWD'),
  },
};
export const DEFAULT_FORMATION = '4-3-3';

// The simulator reads these as team.tactic(name), 0..1 (0.5 = balanced).
export const TACTICS = [
  { key: 'tempo', label: 'Tempo', lo: 'Patient build-up', hi: 'Fast and urgent' },
  { key: 'pressing', label: 'Pressing', lo: 'Sit off', hi: 'Press high' },
  { key: 'width', label: 'Width', lo: 'Narrow', hi: 'Wide' },
  { key: 'line_height', label: 'Defensive line', lo: 'Deep', hi: 'High' },
  { key: 'directness', label: 'Passing', lo: 'Short and patient', hi: 'Direct and long' },
];
export const STEPS = [0, 0.25, 0.5, 0.75, 1];

// Named presets that set every slider at once.
export const PRESETS = {
  Balanced: { tempo: 0.5, pressing: 0.5, width: 0.5, line_height: 0.5, directness: 0.5 },
  'Possession': { tempo: 0.25, pressing: 0.5, width: 0.75, line_height: 0.75, directness: 0 },
  'High press': { tempo: 0.75, pressing: 1, width: 0.5, line_height: 1, directness: 0.5 },
  'Counter attack': { tempo: 1, pressing: 0.25, width: 0.5, line_height: 0.25, directness: 1 },
  'Park the bus': { tempo: 0.25, pressing: 0, width: 0.25, line_height: 0, directness: 0.75 },
};

export const POS_ORDER = ['GK', 'DEF', 'MID', 'FWD'];
export const squadOf = (season, code) => (season.players || []).filter(p => p.team === code)
  .sort((a, b) => POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position) || a.name.localeCompare(b.name));

// Best XI for a formation: fill each slot with the best unused player, preferring the slot's position.
export function autoLineup(formation, squad) {
  const slots = FORMATIONS[formation] || FORMATIONS[DEFAULT_FORMATION], used = new Set(), out = {};
  const score = (p, want) => (p.position === want ? 100 : 0) + (want === 'GK' ? p.defense * 3 : want === 'DEF' ? p.defense * 2 + p.offense : want === 'FWD' ? p.offense * 2 + p.defense * 0.5 : p.offense + p.defense);
  const order = Object.entries(slots).sort(([, a], [, b]) => (a.want === 'GK' ? -1 : 0) - (b.want === 'GK' ? -1 : 0));
  for (const [name, s] of order) {
    const best = squad.filter(p => !used.has(p.id)).sort((a, b) => score(b, s.want) - score(a, s.want))[0];
    if (best) { out[name] = best.id; used.add(best.id); }
  }
  return out;
}

// A manager file with every field filled in (missing file or fields = defaults).
export function normaliseTeamFile(season, code, file = {}) {
  const squad = squadOf(season, code), ids = new Set(squad.map(p => p.id));
  const formation = FORMATIONS[file.formation] ? file.formation : DEFAULT_FORMATION;
  const tactics = {};
  for (const t of TACTICS) tactics[t.key] = STEPS.includes(file.tactics?.[t.key]) ? file.tactics[t.key] : 0.5;
  let lineup = {};
  for (const [s, id] of Object.entries(file.lineup || {})) if (FORMATIONS[formation][s] && ids.has(id)) lineup[s] = id;
  if (!Object.keys(lineup).length) lineup = autoLineup(formation, squad);
  const inXI = new Set(Object.values(lineup));
  const bench = (file.bench || []).filter(id => ids.has(id) && !inXI.has(id));
  const pick = id => (ids.has(id) ? id : null);
  return {
    team: code, updated: file.updated || null, formation, tactics, lineup, bench,
    captain: pick(file.captain), penalties: pick(file.penalties), freekicks: pick(file.freekicks), corners: pick(file.corners),
    message: typeof file.message === 'string' ? file.message : '',
    press: Array.isArray(file.press) ? file.press : [],
    // League news: read receipts, poll votes and form answers (docs/NEWS.md). Only the relay's
    // 'news' action changes it; a 'save' keeps whatever is stored, so pass it through untouched.
    news: file.news && typeof file.news === 'object' && !Array.isArray(file.news) ? file.news : {},
  };
}

export async function loadTeamFile(code) {
  try {
    const r = await fetch(`data/teams/${code.toLowerCase()}.json?t=${Date.now()}`, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// Every team's file that exists, by code (e.g. for league news poll totals).
export async function loadTeamFiles(season) {
  const list = await Promise.all(season.teams.map(async t => [t.code, await loadTeamFile(t.code)]));
  return Object.fromEntries(list.filter(([, f]) => f));
}

// ---------- Logins ----------

export const HASH_ROUNDS = 3000;
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha = async str => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)));
export const cleanEmail = e => String(e || '').trim().toLowerCase();

// Must match hashLogin() in tools/manager-relay.gs exactly.
export async function loginHash(salt, email, pin) {
  let h = await sha(`${salt}|${cleanEmail(email)}|${String(pin).trim()}`);
  for (let i = 0; i < HASH_ROUNDS; i++) h = await sha(h + salt);
  return h;
}
export const newSalt = () => hex(crypto.getRandomValues(new Uint8Array(16)));

// Which team (if any) this email + PIN belongs to.
export async function findManagerTeam(season, email, pin) {
  for (const [code, m] of Object.entries(season.managers || {})) {
    if (m?.salt && m.hash && (await loginHash(m.salt, email, pin)) === m.hash && season.teams.some(t => t.code === code)) return code;
  }
  return null;
}

// Send a request to the relay ('save', 'news' or 'upload'). Resolves with the relay's JSON reply.
// Google now and then answers with its own "Page not found" page instead of the script's reply, so
// saves and news actions (which are safe to repeat) try again up to twice. Uploads aren't repeated.
export async function relaySave(season, payload) {
  if (!season.manager_relay) throw new Error('Saving isn’t switched on yet. Ask the league admin to finish the manager setup.');
  const tries = payload.action === 'upload' ? 1 : 3;
  let status = 0;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise(r => setTimeout(r, 1500 * i));
    let out = null;
    try {
      const res = await fetch(season.manager_relay, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
      status = res.status;
      out = await res.json();
    } catch { continue; }   // Google's error page, or offline: try again
    if (out.ok) return out;
    // A retried vote or form that says "already" means the first try went through; only its reply got lost.
    if (i && /already/i.test(out.error || '')) throw new Error('That went through. Refresh the page to see it.');
    throw new Error(out.error || 'Saving failed.');
  }
  throw new Error(`The save service didn’t reply properly${status ? ` (${status})` : ''}. Please try again.`);
}

// ---------- Press ----------

// Questions from the media: the admin's own questions plus a few generated from the team's
// recent form. Ids are stable, so an answered question stays answered.
export function pressQuestions(season, code, now = new Date()) {
  const T = Object.fromEntries(season.teams.map(t => [t.code, t])), team = T[code];
  if (!team) return [];
  const qs = (season.press_questions || []).filter(q => q.team === code || q.team === 'all').map(q => ({ id: `admin-${q.id}`, q: q.q, from: 'League office' }));
  const name = c => T[c]?.name || c;
  const mine = season.fixtures.filter(f => (f.home === code || f.away === code));
  const played = mine.filter(f => status(f, season, now) === 'ft').sort((a, b) => kickoff(b) - kickoff(a));
  const next = mine.filter(f => status(f, season, now) === 'upcoming').sort((a, b) => kickoff(a) - kickoff(b))[0];
  const last = played[0];
  if (last) {
    const home = last.home === code, gf = home ? last.result.home : last.result.away, ga = home ? last.result.away : last.result.home, opp = name(home ? last.away : last.home);
    const q = gf > ga ? `A ${gf}-${ga} win over ${opp}. What made the difference?`
      : gf < ga ? `A ${gf}-${ga} defeat to ${opp}. What went wrong, and how do you respond?`
      : `${gf}-${ga} against ${opp}. A point gained or two dropped?`;
    qs.push({ id: `res-${last.id}`, q, from: 'Match report' });
    const cards = (last.result.cards || []).filter(c => c.team === code && c.card !== 'yellow');
    if (cards.length) qs.push({ id: `red-${last.id}`, q: `${cards[0].name} was sent off against ${opp}. Was it the right call?`, from: 'Match report' });
  }
  if (next) qs.push({ id: `pre-${next.id}`, q: `Next up is ${name(next.home === code ? next.away : next.home)}. What are you expecting?`, from: 'Preview' });
  const lad = ladder(season, finished(season, now)), row = lad.find(r => r.team.code === code);
  if (row && row.p >= 2) {
    const q = row.rank === 1 ? 'You’re top of the table. Can anyone catch you?'
      : row.rank <= 4 ? `You’re ${row.rank}${['st', 'nd', 'rd'][row.rank - 1] || 'th'} and in the finals spots. Is that where you expected to be?`
      : `You’re outside the top four. What has to change to reach the finals?`;
    qs.push({ id: `table-w${Math.max(0, ...played.map(f => f.week || 0))}`, q, from: 'The table' });
  }
  const top = Object.values(playerTotals(season, now)).filter(p => p.team === code && p.g > 0).sort((a, b) => b.g - a.g)[0];
  if (top && top.g >= 2) qs.push({ id: `scorer-${top.id}-${top.g}`, q: `${top.name} has ${top.g} goals already. How important are they to this side?`, from: 'Stats desk' });
  return qs;
}
