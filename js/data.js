// Loads the season's sheet tabs and turns them into teams, fixtures and a ladder.
// Columns are matched by header name, so sheet columns can be reordered or added freely.

import { SEASON, SOURCES, POINTS, LADDER, LIVE_WINDOW_MINUTES } from './config.js';

const CACHE_PREFIX = `hcl-s${SEASON.number}:`;
const FALLBACK_COLOUR = '#9ca3af';

// Full CSV parser: handles quoted commas, doubled quotes and line breaks inside quotes.
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row);
      row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// "Home Score" -> "home_score"
const headerKey = h => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function toRecords(rows) {
  const [header = [], ...body] = rows;
  const keys = header.map(headerKey);
  return body
    .filter(r => r.some(v => v.trim() !== ''))
    .map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

// Fetches one tab. If the network or Google is down, falls back to the last copy this
// browser saw, so the site keeps working with slightly stale data instead of breaking.
export async function loadSource(name) {
  const url = SOURCES[name];
  const cacheKey = CACHE_PREFIX + name;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const text = await res.text();
    try { localStorage.setItem(cacheKey, text); } catch { /* storage unavailable */ }
    return toRecords(parseCSV(text));
  } catch (err) {
    let cached = null;
    try { cached = localStorage.getItem(cacheKey); } catch { /* storage unavailable */ }
    if (cached) {
      console.warn(`Using saved copy of "${name}":`, err);
      return toRecords(parseCSV(cached));
    }
    throw new Error(`Couldn't load ${name} data (${err.message}).`);
  }
}

// Accepts "7/11/2026", "7/11" (uses SEASON.year) or "2026-11-07", and times like
// "19:30", "7:30 PM" or "14:00 PM". Returns null for blank, "TBA" and anything unreadable.
export function parseKickoff(dateStr, timeStr) {
  let d, m, y, match;
  if ((match = (dateStr || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    [, y, m, d] = match;
  } else if ((match = (dateStr || '').match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/))) {
    [, d, m, y] = match;
    y = y ? (y.length === 2 ? `20${y}` : y) : SEASON.year;
  } else {
    return null;
  }

  let hours = 0;
  let minutes = 0;
  const t = (timeStr || '').match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (t) {
    hours = Number(t[1]);
    minutes = Number(t[2] || 0);
    const suffix = (t[3] || '').toLowerCase();
    if (suffix === 'pm' && hours < 12) hours += 12;
    if (suffix === 'am' && hours === 12) hours = 0;
  }
  return new Date(Number(y), Number(m) - 1, Number(d), hours, minutes);
}

const toScore = v => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
export const safeColour = c => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c || '') ? c : FALLBACK_COLOUR);

// First non-empty value among several possible column names, so the site accepts
// the league sheet's headers ("TEAM CODE") as well as short ones ("Code").
const pick = (r, ...keys) => keys.map(k => r[k]).find(v => v) || '';

// "[TUR] FC Turtle" -> "TUR", "[FWD] Forward" -> "FWD"; plain values are returned as-is.
export const bracketCode = v => (String(v || '').match(/^\s*\[([^\]]+)\]/) || [])[1]?.trim() || String(v || '').trim();

// "(9) Nine" -> 9, "$7,800.00" -> 7800, "8" -> 8
export const toNumber = v => {
  const s = String(v || '');
  const n = Number((s.match(/^\s*\((-?[\d.]+)\)/) || [])[1] ?? s.replace(/[^0-9.-]/g, ''));
  return s.trim() === '' || Number.isNaN(n) ? null : n;
};

// Reads the "GOAL 1 MIN / GOAL 1 ID" column pairs. Any number of pairs works,
// so a high-scoring match just needs more columns added to the sheet.
function goalsFrom(r) {
  const goals = [];
  for (let n = 1; `goal_${n}_min` in r || `goal_${n}_id` in r; n++) {
    const playerId = r[`goal_${n}_id`];
    if (!playerId) continue;
    goals.push({ minute: toNumber(r[`goal_${n}_min`]), playerId });
  }
  return goals.sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));
}

// Works out a fixture's state. The STATUS column is only needed for exceptions
// (postponed, cancelled, or forcing "live"); normally entering the score is enough.
function fixtureState(f, now) {
  const status = f.status.toLowerCase();
  if (status === 'postponed' || status === 'cancelled' || status === 'live') return status;
  if (f.homeScore !== null && f.awayScore !== null) return 'result';
  if (!f.kickoff) return 'tba';
  if (now < f.kickoff) return 'upcoming';
  if (now - f.kickoff < LIVE_WINDOW_MINUTES * 60000) return 'live';
  return 'awaiting';
}

export function buildTeams(rows) {
  const teams = new Map();
  for (const r of rows) {
    const code = pick(r, 'team_code', 'code').toUpperCase();
    if (!code) continue;
    teams.set(code, {
      code,
      name: pick(r, 'team_name', 'name') || code,
      colour: safeColour(pick(r, 'primary_hex_code', 'colour', 'color')),
      manager: pick(r, 'manager_name', 'manager'),
      logo: r.logo || `assets/teams/${code.toLowerCase()}.png`,
      logoAlt: r.logo_alt || `assets/teams/${code.toLowerCase()}-alt.png`,
    });
  }
  return teams;
}

export function buildFixtures(rows, teams, now = new Date()) {
  const lookup = new Map();
  for (const t of teams.values()) {
    lookup.set(t.code, t);
    lookup.set(t.name.toUpperCase(), t);
  }
  const team = v => lookup.get(bracketCode(v).toUpperCase()) || lookup.get((v || '').trim().toUpperCase())
    || { code: v || '', name: v || 'TBA', colour: FALLBACK_COLOUR, logo: '', unknown: true };

  return rows.filter(r => r.home || r.away).map((r, i) => {
    const f = {
      id: r.id || r.match_id || String(i + 1),
      week: Number(r.week) || null,
      date: r.date,
      time: r.time,
      kickoff: parseKickoff(r.date, r.time),
      home: team(r.home),
      away: team(r.away),
      homeScore: toScore(r.home_score),
      awayScore: toScore(r.away_score),
      status: r.status || '',
      venue: r.venue || '',
      video: pick(r, 'youtube_link', 'video'),
      goals: goalsFrom(r),
    };
    f.state = fixtureState(f, now);
    return f;
  });
}

// The ladder is calculated from results, so there's no separate standings tab to keep in sync.
// Tiebreakers: points, goal difference, goals for, then name.
export function buildStandings(teams, fixtures) {
  const table = new Map([...teams.values()].map(t => [t.code, {
    team: t, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, form: [],
  }]));

  const results = fixtures
    .filter(f => f.state === 'result')
    .sort((a, b) => (a.kickoff ?? 0) - (b.kickoff ?? 0));

  for (const f of results) {
    const home = table.get(f.home.code);
    const away = table.get(f.away.code);
    if (!home || !away) continue;
    addResult(home, f.homeScore, f.awayScore);
    addResult(away, f.awayScore, f.homeScore);
  }

  const rows = [...table.values()].map(r => ({ ...r, gd: r.gf - r.ga, form: r.form.slice(-5) }));
  rows.sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf
    || a.team.name.localeCompare(b.team.name));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

function addResult(row, scored, conceded) {
  const outcome = scored > conceded ? 'W' : scored < conceded ? 'L' : 'D';
  row.played++;
  row.gf += scored;
  row.ga += conceded;
  if (outcome === 'W') { row.won++; row.points += POINTS.win; }
  if (outcome === 'D') { row.drawn++; row.points += POINTS.draw; }
  if (outcome === 'L') { row.lost++; row.points += POINTS.loss; }
  row.form.push(outcome);
}

// The week to show first: today's or the next upcoming week, otherwise the latest one played.
export function currentWeek(fixtures) {
  const dated = fixtures.filter(f => f.week && f.kickoff);
  const next = dated
    .filter(f => ['upcoming', 'live', 'awaiting'].includes(f.state))
    .sort((a, b) => a.kickoff - b.kickoff)[0];
  if (next) return next.week;
  const last = dated.sort((a, b) => b.kickoff - a.kickoff)[0];
  return last ? last.week : (fixtures.find(f => f.week)?.week ?? 1);
}

export function buildPlayers(rows) {
  const players = new Map();
  for (const r of rows) {
    const id = pick(r, 'player_id', 'id');
    if (!id) continue;
    players.set(id, {
      id,
      name: pick(r, 'player_name', 'name'),
      team: bracketCode(pick(r, 'assigned_team', 'team')).toUpperCase(),
      position: bracketCode(r.position).toUpperCase(),
      offense: toNumber(pick(r, 'offense_rating', 'offense')),
      defense: toNumber(pick(r, 'defense_rating', 'defense')),
      weeklyCost: toNumber(r.weekly_cost),
    });
  }
  return players;
}

// Ladder straight from the sheet's Standings tab (only its first table; rows without a
// position and team are ignored). Form still comes from results, since the tab has none.
export function sheetStandings(rows, teams, calculated) {
  const formByCode = new Map(calculated.map(r => [r.team.code, r.form]));
  const lookup = new Map([...teams.values()].flatMap(t => [[t.code, t], [t.name.toUpperCase(), t]]));
  return rows
    .filter(r => toNumber(r.position) !== null && r.team)
    .map(r => {
      const team = lookup.get(bracketCode(r.team).toUpperCase()) || lookup.get(r.team.toUpperCase())
        || { code: r.team, name: r.team, colour: FALLBACK_COLOUR, logo: '', unknown: true };
      return {
        team,
        rank: toNumber(r.position),
        played: toNumber(r.played) ?? 0,
        won: toNumber(r.won) ?? 0,
        drawn: toNumber(pick(r, 'draw', 'drawn')) ?? 0,
        lost: toNumber(pick(r, 'loss', 'lost')) ?? 0,
        gf: toNumber(r.gf) ?? 0,
        ga: toNumber(r.ga) ?? 0,
        gd: toNumber(r.gd) ?? 0,
        points: toNumber(r.points) ?? 0,
        form: formByCode.get(team.code) || [],
      };
    })
    .sort((a, b) => a.rank - b.rank);
}

export async function loadSeason() {
  const useSheetLadder = LADDER === 'sheet' && SOURCES.standings;
  const [teamRows, fixtureRows, standingRows] = await Promise.all([
    loadSource('teams'),
    loadSource('fixtures'),
    useSheetLadder ? loadSource('standings') : null,
  ]);
  const teams = buildTeams(teamRows);
  const fixtures = buildFixtures(fixtureRows, teams);
  const calculated = buildStandings(teams, fixtures);
  const standings = useSheetLadder ? sheetStandings(standingRows, teams, calculated) : calculated;
  return { teams, fixtures, standings };
}
