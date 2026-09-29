// League rules: finals, suspensions, point adjustments and rescheduling.
// Pure functions over the season object (no DOM), shared by edit mode, the public pages and the
// simulator. Functions that change the season mutate it in place and return what they changed.

import { kickoff, ladder, byKickoff } from './data.js';

const uid = prefix => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const isKnockout = f => f.stage === 'SF' || f.stage === 'GF';
export const STAGE_NAMES = { SF: 'Semi-final', GF: 'Grand Final' };

// ---------------------------------------------------------------- point adjustments

export function addAdjustment(season, team, points, reason) {
  if (!season.teams.some(t => t.code === team)) throw new Error(`Unknown team ${team}.`);
  if (!Number.isFinite(points) || points === 0) throw new Error('Enter a points change such as -3 or 2.');
  const a = { id: uid('adj'), team, points: Math.trunc(points), reason: String(reason || '').trim(), date: new Date().toISOString().slice(0, 10) };
  (season.adjustments ??= []).push(a);
  return a;
}
export function removeAdjustment(season, id) {
  const before = (season.adjustments || []).length;
  season.adjustments = (season.adjustments || []).filter(a => a.id !== id);
  return season.adjustments.length !== before;
}
export const adjustmentTotal = (season, team) => (season.adjustments || []).filter(a => a.team === team).reduce((n, a) => n + a.points, 0);

// ---------------------------------------------------------------- rescheduling

function remember(f) { if (!f.original) f.original = { date: f.date || '', time: f.time || '' }; }

export function postpone(fixture, reason = '') {
  remember(fixture);
  fixture.postponed = true;
  fixture.postponed_reason = String(reason || '').trim();
  return [fixture];
}

export function reschedule(fixture, date, time) {
  if (!date) throw new Error('Pick the new date.');
  remember(fixture);
  fixture.date = date;
  if (time) fixture.time = time;
  delete fixture.postponed;
  delete fixture.postponed_reason;
  return [fixture];
}

// Move every fixture in a week that hasn't kicked off yet by `days` (negative moves earlier),
// including ones already simulated in advance. Postponed ones stay put.
export function shiftWeek(season, week, days, now = new Date()) {
  const changed = [];
  for (const f of season.fixtures) {
    if (String(f.week) !== String(week) || f.postponed || !f.date || kickoff(f) <= now) continue;
    remember(f);
    const d = kickoff(f);
    d.setDate(d.getDate() + days);
    f.date = iso(d);
    changed.push(f);
  }
  return changed;
}

// ---------------------------------------------------------------- suspensions

// Games a player misses. Red cards (including second yellows) ban for season.ban_matches games
// (default 1); manual bans in season.bans ban for their own count, from the date they were added.
// Bans apply to the team's next fixtures in kick-off order, skipping postponed ones.
export function suspensions(season) {
  const perFixture = new Map();
  const banMatches = Number.isFinite(season.ban_matches) ? season.ban_matches : 1;
  const teamFixtures = code => season.fixtures.filter(f => (f.home === code || f.away === code) && kickoff(f) && !f.postponed).sort(byKickoff);
  const add = (fixtures, afterTime, player, name, reason, count, unplayedOnly = false) => {
    let left = count;
    for (const f of fixtures) {
      if (left <= 0) break;
      if (kickoff(f) <= afterTime || (unplayedOnly && f.result)) continue;
      if (!perFixture.has(f.id)) perFixture.set(f.id, []);
      perFixture.get(f.id).push({ player, name, reason });
      left--;
    }
  };
  const teamOf = pid => season.players?.find(p => String(p.id) === String(pid))?.team;
  for (const f of season.fixtures) {
    if (!f.result || !kickoff(f)) continue;
    for (const c of f.result.cards || []) {
      if (c.card !== 'red' && c.card !== 'second_yellow') continue;
      const team = c.team || teamOf(c.player);
      if (!team) continue;
      add(teamFixtures(team), kickoff(f), c.player, c.name, `${c.card === 'red' ? 'Red card' : 'Two yellows'} v ${f.home === team ? f.away : f.home} (week ${f.week})`, banMatches);
    }
  }
  for (const b of season.bans || []) {
    const team = teamOf(b.player);
    if (!team) continue;
    const name = season.players.find(p => String(p.id) === String(b.player))?.name;
    // Manual bans cover the team's next matches that haven't been played yet.
    add(teamFixtures(team), b.from ? new Date(`${b.from}T00:00`) : new Date(0), b.player, name, b.reason || 'Suspended', b.matches || 1, true);
  }
  return perFixture;
}
export const unavailable = (season, fixture) => (suspensions(season).get(fixture.id) || []).map(s => String(s.player));

export function addBan(season, player, matches, reason) {
  if (!season.players?.some(p => String(p.id) === String(player))) throw new Error('Pick a player.');
  const b = { id: uid('ban'), player: String(player), matches: Math.max(1, Math.trunc(matches || 1)), reason: String(reason || '').trim(), from: new Date().toISOString().slice(0, 10) };
  (season.bans ??= []).push(b);
  return b;
}
export function removeBan(season, id) {
  const before = (season.bans || []).length;
  season.bans = (season.bans || []).filter(b => b.id !== id);
  return season.bans.length !== before;
}

// ---------------------------------------------------------------- finals

// Semi-finals (1 v 4, 2 v 3, higher seed at home) and a Grand Final between the winners; or, with
// teams: 2, a Grand Final between the top two. Seeds come from the regular-season ladder.
export function buildFinals(season, { teams = 4, startDate, time = '16:00', gapDays = 7, force = false } = {}) {
  if (season.fixtures.some(isKnockout)) throw new Error('Finals already exist. Delete them first to rebuild.');
  const regular = season.fixtures.filter(f => !isKnockout(f));
  const unplayed = regular.filter(f => !f.result);
  if (unplayed.length && !force) throw new Error(`${unplayed.length} regular-season fixture${unplayed.length > 1 ? 's have' : ' has'} no result yet. Finish the season first, or build anyway to seed from the current ladder.`);
  // Seed from every regular-season result, including ones not yet revealed to the public.
  const table = ladder(season, regular.filter(f => f.result).sort(byKickoff));
  if (table.length < teams) throw new Error(`Need at least ${teams} teams.`);
  const seeds = table.slice(0, teams).map(r => r.team.code);
  const lastWeek = Math.max(0, ...regular.map(f => Number(f.week) || 0));
  const lastDate = regular.map(kickoff).filter(Boolean).sort((a, b) => b - a)[0] || new Date();
  const first = startDate ? new Date(`${startDate}T00:00`) : new Date(lastDate.getTime() + gapDays * 86400000);
  const day = n => iso(new Date(first.getTime() + n * gapDays * 86400000));
  season.finals = { teams, format: teams === 4 ? '1v4-2v3' : '1v2', ties: season.finals?.ties || 'penalties' };
  const made = [];
  if (teams === 4) {
    const sf1 = { id: `sf1-${seeds[0]}-${seeds[3]}`.toLowerCase(), stage: 'SF', week: lastWeek + 1, date: day(0), time, home: seeds[0], away: seeds[3], seeds: { home: 1, away: 4 }, result: null };
    const sf2 = { id: `sf2-${seeds[1]}-${seeds[2]}`.toLowerCase(), stage: 'SF', week: lastWeek + 1, date: day(0), time: addMinutes(time, 5), home: seeds[1], away: seeds[2], seeds: { home: 2, away: 3 }, result: null };
    const gf = { id: 'gf', stage: 'GF', week: lastWeek + 2, date: day(1), time, home: null, away: null, from: { home: { winner: sf1.id }, away: { winner: sf2.id } }, result: null };
    made.push(sf1, sf2, gf);
  } else if (teams === 2) {
    made.push({ id: 'gf', stage: 'GF', week: lastWeek + 1, date: day(0), time, home: seeds[0], away: seeds[1], seeds: { home: 1, away: 2 }, result: null });
  } else {
    throw new Error('Finals can be for the top 2 or top 4.');
  }
  season.fixtures.push(...made);
  return made;
}

function addMinutes(hhmm, n) {
  const [h, m] = hhmm.split(':').map(Number), t = h * 60 + m + n;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

// Display team for one side of a fixture. A finals team that isn't known yet shows where it comes
// from ('Winner SF1'). `teams` is teamMap(season).
export function sideTeam(season, f, side, teams) {
  if (f[side]) return teams[f[side]] || { code: f[side], name: f[side] };
  const src = f.from?.[side], id = src?.winner || src?.loser;
  const n = season.fixtures.filter(x => x.stage === 'SF').findIndex(x => x.id === id) + 1;
  return { code: 'TBC', name: id ? `${src.winner ? 'Winner' : 'Loser'} SF${n || ''}` : 'To be confirmed' };
}

// Winner (and loser) of a decided knockout match, or null if it isn't decided yet.
export function knockoutWinner(season, f) {
  if (!f?.result || !f.home || !f.away) return null;
  const { home: h, away: a, shootout } = f.result;
  if (h !== a) return h > a ? f.home : f.away;
  if (shootout) return shootout.home > shootout.away ? f.home : f.away;
  if ((season.finals?.ties || 'penalties') === 'higher-seed' && f.seeds) return f.seeds.home <= f.seeds.away ? f.home : f.away;
  return null;
}

// Fill in the Grand Final once the semi-finals are decided. Returns true if anything changed.
export function resolveFinals(season) {
  let changed = false;
  for (const f of season.fixtures.filter(x => x.from)) {
    for (const side of ['home', 'away']) {
      const src = f.from[side];
      if (!src || f[side]) continue;
      const g = season.fixtures.find(x => x.id === (src.winner || src.loser));
      const w = knockoutWinner(season, g);
      if (!w) continue;
      f[side] = src.winner ? w : (g.home === w ? g.away : g.home);
      if (g.seeds) { f.seeds ??= {}; f.seeds[side] = g.home === f[side] ? g.seeds.home : g.seeds.away; }
      changed = true;
    }
  }
  return changed;
}

// Drawn knockout match: settle it with a penalty shootout, decided deterministically from the match
// (the five best finishers take the kicks, against the opposing keeper). Returns the shootout, or null.
export function decideShootout(fixture, data) {
  if (!isKnockout(fixture) || !data?.result || data.result.home !== data.result.away) return null;
  let s = (Number(data.engine?.seed) || 1) >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const squad = side => data.players.filter(p => p.team === data.teams[side].code);
  const takers = side => squad(side).filter(p => p.slot !== 'GK').sort((a, b) => (b.attributes.finishing + b.attributes.composure) - (a.attributes.finishing + a.attributes.composure)).slice(0, 5);
  const keeper = side => squad(side).find(p => p.slot === 'GK') || squad(side)[0];
  const kick = (taker, gk) => rnd() < 0.76 + 0.004 * (taker.attributes.finishing - 70) + 0.002 * (taker.attributes.composure - 70) - 0.004 * ((gk.attributes.reflexes || 50) - 60);
  const T = { home: takers('home'), away: takers('away') }, G = { home: keeper('away'), away: keeper('home') };
  const score = { home: 0, away: 0 }, kicks = [];
  for (let round = 0; round < 30; round++) {
    for (const side of ['home', 'away']) {
      const taker = T[side][round % T[side].length];
      const scored = kick(taker, G[side]);
      if (scored) score[side]++;
      kicks.push({ side, player: taker.id, name: taker.name, scored });
      if (round < 5) {
        // Stop once one side can't catch up.
        const leftH = 5 - (round + 1), leftA = 5 - (round + (side === 'away' ? 1 : 0));
        if (score.home > score.away + leftA || score.away > score.home + leftH) return { ...score, kicks };
      }
    }
    if (round >= 4 && score.home !== score.away) return { ...score, kicks };
  }
  return { ...score, kicks };
}

// After a result is attached to a fixture: settle a drawn knockout on penalties, then fill in later rounds.
export function applyKnockoutRules(season, fixture, data) {
  if (isKnockout(fixture) && fixture.result && (season.finals?.ties || 'penalties') === 'penalties') {
    const so = decideShootout(fixture, data);
    if (so) fixture.result.shootout = so; else delete fixture.result.shootout;
  }
  return resolveFinals(season);
}
