// Manager Hub panes: "Scouting" (any opponent, defaulting to the next one) and "Match reports"
// (this team's played matches). manager.js calls scoutPane(pane, ctx) / reportsPane(pane, ctx) with
// ctx = { season, team, teamFile, teams }. Read-only: nothing here saves anything.

import { kickoff, status, finished, ladder, resultFor, winChance, playerTotals, byKickoff } from './data.js';
import { esc, logo, safeColour, onColour, fmtDate, fmtTime, matchUrl, parseStamp } from './ui.js';
import { FORMATIONS, TACTICS, PRESETS, squadOf, normaliseTeamFile, loadTeamFile } from './managers.js';
import { suspensions, isKnockout, STAGE_NAMES } from './league.js';

// This module's own styles, added once to whichever page loads it (same ?v= as this file).
if (!document.querySelector('link[data-scout-css]')) {
  const css = new URL('../css/manager-scout.css', import.meta.url);
  css.search = new URL(import.meta.url).search;
  document.head.insertAdjacentHTML('beforeend', `<link rel="stylesheet" data-scout-css href="${css}">`);
}

const fileCache = new Map();   // code -> Promise of raw team file (or null)
let scouted = null;            // team code being scouted (null = next opponent)

const surname = p => (p.name || '').trim().split(/\s+/).slice(-1)[0];
const shirt = p => String(p.id).slice(-2);
const ratingColour = r => (!r ? 'var(--muted)' : r >= 7.5 ? '#34d399' : r >= 6.5 ? '#fbbf24' : '#f87171');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const perGame = (n, g) => (g ? (n / g).toFixed(2) : '–');
const minuteOf = m => parseInt(String(m), 10) || 0;

function teamFile(code) {
  if (!fileCache.has(code)) fileCache.set(code, loadTeamFile(code));
  return fileCache.get(code);
}

// One line of a team's season numbers, from the regular-season ladder and finished matches.
function teamSeason(S, code) {
  const done = finished(S).filter(f => f.home === code || f.away === code);
  const row = ladder(S).find(r => r.team.code === code);
  const conceded = done.flatMap(f => f.result.goals.filter(g => g.team !== code));
  const scored = done.flatMap(f => f.result.goals.filter(g => g.team === code));
  const stat = (k, mine = true) => done.reduce((n, f) => n + (+f.result.stats?.[(f.home === code) === mine ? 'home' : 'away']?.[k] || 0), 0);
  // Goal totals from the scores; `scored` / `conceded` (goal events) are only used for timings.
  const gf = done.reduce((n, f) => n + (f.home === code ? f.result.home : f.result.away), 0);
  const ga = done.reduce((n, f) => n + (f.home === code ? f.result.away : f.result.home), 0);
  return { done, row, conceded, scored, gf, ga, stat, games: done.length };
}

// ---------------------------------------------------------------- Scouting

export async function scoutPane(pane, ctx) {
  const S = ctx.season, me = ctx.team, T = ctx.teams;
  // Next match still to kick off (not postponed, both teams known). Matches are often simulated
  // in advance, so "upcoming" is about the kick-off time, not whether a result exists.
  const upcoming = f => status(f, S) === 'upcoming' && f.home && f.away;
  const next = S.fixtures.filter(f => upcoming(f) && [f.home, f.away].includes(me)).sort(byKickoff)[0] || null;
  const nextOpp = next ? (next.home === me ? next.away : next.home) : null;
  const others = S.teams.map(t => t.code).filter(c => c !== me);
  const code = others.includes(scouted) ? scouted : nextOpp || others[0];
  if (!code) { pane.innerHTML = '<section class="card"><p class="muted">No other teams to scout yet.</p></section>'; return; }

  pane.innerHTML = `<section class="card"><p class="muted">Loading the scouting report…</p></section>`;
  const raw = await teamFile(code);
  const t = T[code] || { code, name: code };
  const file = normaliseTeamFile(S, code, raw || {});
  const announced = !!(raw && raw.lineup && Object.keys(raw.lineup).length);
  const squad = squadOf(S, code), P = Object.fromEntries(squad.map(p => [p.id, p]));
  const totals = playerTotals(S);
  const st = id => totals[id] || { apps: 0, g: 0, a: 0, avg: 0, yc: 0, rc: 0 };
  const ts = teamSeason(S, code);
  const fx = next && nextOpp === code ? next : S.fixtures.filter(f => upcoming(f) && [f.home, f.away].includes(me) && [f.home, f.away].includes(code)).sort(byKickoff)[0];
  const out = fx ? (suspensions(S).get(fx.id) || []).filter(s => P[s.player]) : [];
  const outIds = new Set(out.map(s => String(s.player)));

  // Header: season line and form.
  const r = ts.row;
  const form = ts.done.slice(-5).map(f => resultFor(f, code));
  const head = `<section class="card stack" style="gap:12px">
    <div class="chips" role="tablist" aria-label="Team to scout">${others.map(c => `<button class="chip-btn" data-scout="${esc(c)}" aria-pressed="${c === code}">${esc(c)}${c === nextOpp ? ' · next' : ''}</button>`).join('')}</div>
    <div class="mg-head">${logo(t, 56)}<div class="grow"><h2 style="margin:0;font-size:1.3rem;font-weight:800">${esc(t.name)}</h2>
      <p class="muted" style="margin:2px 0 0;font-size:.85rem">${t.manager ? `Manager ${esc(t.manager)} · ` : ''}${r && r.p ? `${ordinal(r.rank)} on the ladder` : 'No matches yet'}</p></div>
      <div class="sc-form">${form.map(o => `<i class="${o}">${o}</i>`).join('') || ''}</div></div>
    ${fx ? nextLine(S, fx, me, code, T) : ''}
    <div class="big-stat">
      <div><b>${r ? `${r.w}-${r.d}-${r.l}` : '0-0-0'}</b><span>W-D-L</span></div>
      <div><b>${perGame(ts.gf, ts.games)}</b><span>Scored / game</span></div>
      <div><b>${perGame(ts.ga, ts.games)}</b><span>Conceded / game</span></div>
      <div><b>${ts.games ? Math.round(ts.stat('possession') / ts.games) + '%' : '–'}</b><span>Possession</span></div>
    </div></section>`;

  // Likely XI on a mini pitch.
  const col = safeColour(t.colour), on = onColour(col);
  const slots = FORMATIONS[file.formation];
  const pitch = Object.entries(slots).map(([name, s]) => {
    const p = P[file.lineup[name]], rt = p ? st(p.id).avg : 0, sus = p && outIds.has(String(p.id));
    return `<div class="pslot${p ? '' : ' empty'}" style="left:${s.x}%;bottom:${s.y}%;--tc:${esc(col)};--on:${on};cursor:default${sus ? ';opacity:.45' : ''}" title="${p ? esc(p.name) : ''}${sus ? ' (suspended)' : ''}">
      <span class="shirt">${p ? esc(shirt(p)) : '?'}${p && file.captain === p.id ? '<span class="cap">C</span>' : ''}${rt ? `<span class="rt">${rt.toFixed(1)}</span>` : ''}</span>
      <span class="nm">${p ? esc(surname(p)) : '–'}</span><span class="sl">${name}</span></div>`;
  }).join('');
  const lines = `<div class="ln" style="left:0;right:0;top:50%;border-width:2px 0 0"></div>
    <div class="ln" style="left:50%;top:50%;width:26%;aspect-ratio:1;border-radius:50%;transform:translate(-50%,-50%)"></div>
    <div class="ln" style="left:22%;right:22%;bottom:0;height:16%;border-bottom:0"></div><div class="ln" style="left:36%;right:36%;bottom:0;height:6%;border-bottom:0"></div>
    <div class="ln" style="left:22%;right:22%;top:0;height:16%;border-top:0"></div><div class="ln" style="left:36%;right:36%;top:0;height:6%;border-top:0"></div>`;
  const xi = `<section class="card stack" style="gap:12px"><h2 class="card-title">${announced ? 'Announced line-up' : 'Predicted line-up'} · ${esc(file.formation)}</h2>
    <p class="muted" style="margin:0;font-size:.8rem">${announced ? `Set by their manager${raw.updated ? ` on ${esc(fmtDate(parseStamp(raw.updated)))}` : ''}. It can still change before kick-off.` : 'Their manager hasn’t picked a team yet, so this is their strongest XI on paper.'}</p>
    <div class="pitch2d" style="max-width:380px">${lines}${pitch}</div>
    ${out.length ? `<p style="margin:0;font-size:.85rem"><b style="color:var(--loss)">Suspended for your match:</b> ${out.map(s => `${esc(s.name || P[s.player]?.name)} <span class="muted">(${esc(s.reason)})</span>`).join(', ')}</p>` : ''}</section>`;

  // Tactics.
  const preset = Object.entries(PRESETS).find(([, v]) => TACTICS.every(x => v[x.key] === file.tactics[x.key]))?.[0];
  const tactics = `<section class="card stack" style="gap:10px"><h2 class="card-title">How they play${preset ? ` · ${esc(preset)}` : ''}</h2>
    ${raw?.tactics ? '' : '<p class="muted" style="margin:0;font-size:.8rem">No tactics set, so they play a balanced game.</p>'}
    ${TACTICS.map(x => { const v = file.tactics[x.key]; return `<div class="sc-slider"><span>${esc(x.label)}</span><div class="sc-track"><i style="left:${v * 100}%"></i></div><b>${esc(v < 0.5 ? x.lo : v > 0.5 ? x.hi : 'Balanced')}</b></div>`; }).join('')}</section>`;

  // Key players.
  const played = squad.filter(p => st(p.id).apps);
  const top = (key, n = 3) => [...played].filter(p => st(p.id)[key] > 0).sort((a, b) => st(b.id)[key] - st(a.id)[key]).slice(0, n);
  const prow = (p, val, label) => `<div class="prow" style="cursor:default"><span class="pos">${esc(p.position)}</span><span class="nm">${esc(p.name)}${outIds.has(String(p.id)) ? ' <span class="tag" style="color:var(--loss)">Suspended</span>' : ''}</span><span class="tag">${label}</span><span class="rt">${val}</span></div>`;
  const best = [...played].filter(p => st(p.id).apps >= 1).sort((a, b) => st(b.id).avg - st(a.id).avg).slice(0, 3);
  const key = played.length ? `<section class="card stack" style="gap:10px"><h2 class="card-title">Players to watch</h2><div class="plist">
      ${top('g').map(p => prow(p, st(p.id).g, 'Goals')).join('')}
      ${top('a', 2).map(p => prow(p, st(p.id).a, 'Assists')).join('')}
      ${best.map(p => `<div class="prow" style="cursor:default"><span class="pos">${esc(p.position)}</span><span class="nm">${esc(p.name)}</span><span class="tag">Avg rating</span><span class="rt" style="color:${ratingColour(st(p.id).avg)}">${st(p.id).avg.toFixed(1)}</span></div>`).join('')}
    </div></section>`
    : `<section class="card stack" style="gap:10px"><h2 class="card-title">Players to watch</h2><div class="plist">
      ${[...squad].sort((a, b) => b.offense - a.offense).slice(0, 3).map(p => prow(p, p.offense, 'Attack')).join('')}
      ${[...squad].sort((a, b) => b.defense - a.defense).slice(0, 2).map(p => prow(p, p.defense, 'Defence')).join('')}
    </div><p class="muted" style="margin:0;font-size:.78rem">Ratings out of 10. Match stats appear after their first game.</p></section>`;

  // Head to head.
  const h2h = finished(S).filter(f => [f.home, f.away].includes(me) && [f.home, f.away].includes(code)).reverse();
  const h2hHtml = `<section class="card stack" style="gap:10px"><h2 class="card-title">Head to head</h2>
    ${h2h.length ? `<p style="margin:0;font-size:.85rem">${['W', 'D', 'L'].map(o => `${h2h.filter(f => resultFor(f, me) === o).length} ${({ W: 'won', D: 'drawn', L: 'lost' })[o]}`).join(' · ')}</p>
      <div class="plist">${h2h.map(f => `<a class="prow" href="${matchUrl(f)}"><span class="pos">${esc(fmtDate(kickoff(f)).replace(/^\w+, /, ''))}</span><span class="nm">${esc(f.home)} ${f.result.home}–${f.result.away} ${esc(f.away)}${f.result.shootout ? ` <span class="muted">(pens ${f.result.shootout.home}–${f.result.shootout.away})</span>` : ''}</span><span class="sc-res ${resultFor(f, me)}">${resultFor(f, me)}</span></a>`).join('')}</div>`
      : '<p class="muted" style="margin:0;font-size:.85rem">You haven’t played them yet this season.</p>'}</section>`;

  // Weak spots.
  const tips = weakSpots(S, code, file, ts, squad, P, st);
  const weak = `<section class="card stack" style="gap:10px"><h2 class="card-title">Where they're weak</h2>
    ${tips.length ? `<ul class="sc-tips">${tips.map(x => `<li><b>${esc(x.head)}</b> ${esc(x.body)}</li>`).join('')}</ul>` : '<p class="muted" style="margin:0;font-size:.85rem">Nothing stands out yet. Check back after they’ve played a few games.</p>'}</section>`;

  pane.innerHTML = `<div class="stack" style="gap:16px">${head}<div class="sc-grid"><div class="stack" style="gap:16px">${xi}${tactics}</div><div class="stack" style="gap:16px">${weak}${key}${h2hHtml}</div></div></div>`;
  pane.onclick = e => {
    const b = e.target.closest('[data-scout]');
    if (b) { scouted = b.dataset.scout; scoutPane(pane, ctx); }
  };
}

function nextLine(S, fx, me, code, T) {
  const k = kickoff(fx), home = fx.home === me;
  const w = winChance(S, fx.home, fx.away, fx.id);
  const mine = home ? w.home : w.away, theirs = home ? w.away : w.home;
  return `<div class="sc-next"><span><b>${fx.stage ? esc(STAGE_NAMES[fx.stage]) : `Week ${esc(fx.week)}`}</b> · ${esc(fmtDate(k))} ${esc(fmtTime(k))} · ${home ? 'You’re at home' : 'You’re away'}</span>
    <span class="muted">Win chance: you ${mine}% · draw ${w.draw}% · ${esc(T[code]?.code || code)} ${theirs}%</span></div>`;
}

const ordinal = n => n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10 * (Math.floor(n / 10) % 10 !== 1)] || 'th');

// Plain-English weaknesses from their results, squad and tactics. Most useful first.
function weakSpots(S, code, file, ts, squad, P, st) {
  const tips = [];
  const all = finished(S), league = all.length ? all.reduce((n, f) => n + f.result.home + f.result.away, 0) / (2 * all.length) : null;
  const g = ts.games;
  if (g >= 2 && league != null) {
    const ga = ts.ga / g;
    if (ga > league * 1.15) tips.push({ head: 'Leaky defence.', body: `They concede ${ga.toFixed(1)} a game against a league average of ${league.toFixed(1)}. Be positive and get shots away.` });
    const late = ts.conceded.filter(x => minuteOf(x.minute) >= 70).length;
    if (ts.conceded.length >= 3 && late / ts.conceded.length >= 0.4) tips.push({ head: 'They fade late.', body: `${late} of the ${ts.conceded.length} goals they've conceded came after the 70th minute.` });
    const early = ts.conceded.filter(x => minuteOf(x.minute) <= 20).length;
    if (ts.conceded.length >= 3 && early / ts.conceded.length >= 0.35) tips.push({ head: 'Slow starters.', body: `${early} of their ${ts.conceded.length} goals conceded came in the first 20 minutes.` });
    const shotsAgainst = ts.stat('shots', false) / g, sotAgainst = ts.stat('shots_on_target', false);
    if (shotsAgainst >= 12) tips.push({ head: 'They let teams shoot.', body: `Opponents average ${shotsAgainst.toFixed(1)} shots a game against them (${pct(sotAgainst, ts.stat('shots', false))}% on target).` });
    const fouls = ts.stat('fouls') / g, cards = ts.stat('yellow_cards') + 2 * ts.stat('red_cards');
    if (fouls >= 12 || cards / g >= 2.5) tips.push({ head: 'Ill-disciplined.', body: `${fouls.toFixed(1)} fouls and ${(ts.stat('yellow_cards') / g).toFixed(1)} yellows a game. Run at them and win free kicks near the box.` });
    const scoredPer = ts.gf / g;
    if (scoredPer < league * 0.8) tips.push({ head: 'Struggle to score.', body: `Only ${scoredPer.toFixed(1)} goals a game, so a clean sheet is realistic.` });
  }
  // Line-up: the weakest unit of their likely XI, by the players' own ratings.
  const xi = Object.entries(file.lineup).map(([slot, id]) => ({ slot, p: P[id], want: FORMATIONS[file.formation][slot]?.want })).filter(x => x.p);
  const unit = want => xi.filter(x => x.want === want).map(x => x.p);
  const avg = (ps, k) => (ps.length ? ps.reduce((n, p) => n + (+p[k] || 0), 0) / ps.length : null);
  const def = avg(unit('DEF'), 'defense'), mid = avg(unit('MID'), 'defense');
  const leagueDef = avg((S.players || []).filter(p => p.position === 'DEF'), 'defense');
  if (def != null && leagueDef != null && def < leagueDef - 0.5) tips.push({ head: 'Soft back line.', body: `Their defenders average ${def.toFixed(1)}/10 for defence (league ${leagueDef.toFixed(1)}). Get your best attackers on the ball.` });
  const oop = xi.filter(x => x.p.position !== x.want && x.want !== 'GK');
  if (oop.length >= 2) tips.push({ head: 'Players out of position.', body: `${oop.map(x => `${surname(x.p)} (${x.p.position} at ${x.slot})`).join(', ')}.` });
  const gk = xi.find(x => x.slot === 'GK')?.p;
  if (gk && (gk.position !== 'GK' || gk.defense <= 4)) tips.push({ head: 'Weak in goal.', body: `${gk.name} is ${gk.position !== 'GK' ? 'not a natural keeper' : `rated ${gk.defense}/10`}. Shoot early and from distance.` });
  if (mid != null && mid < 4.5) tips.push({ head: 'Midfield doesn’t defend.', body: `Their midfield averages ${mid.toFixed(1)}/10 for defence, so runs from deep should find space.` });
  // Tactics.
  const tc = file.tactics;
  if (tc.line_height >= 0.75) tips.push({ head: 'High defensive line.', body: 'Space in behind: play direct and use quick forwards on the shoulder.' });
  if (tc.line_height <= 0.25) tips.push({ head: 'Deep defensive line.', body: 'They sit in, so shots from outside the box and crosses are your best bet.' });
  if (tc.pressing >= 0.75) tips.push({ head: 'Press high.', body: 'Go long early to bypass the press, and they’ll tire late.' });
  if (tc.width <= 0.25) tips.push({ head: 'Narrow shape.', body: 'The flanks are open: play wide and cross.' });
  if (tc.tempo >= 0.75 && tc.directness >= 0.75) tips.push({ head: 'Hit and hope.', body: 'Fast, direct football gives the ball away a lot. Keep possession and be patient.' });
  // Suspensions leave gaps.
  return tips.slice(0, 6);
}

// ---------------------------------------------------------------- Match reports

export function reportsPane(pane, ctx) {
  const S = ctx.season, me = ctx.team, T = ctx.teams;
  const games = finished(S).filter(f => f.home === me || f.away === me).reverse();
  if (!games.length) { pane.innerHTML = '<section class="card"><h2 class="card-title">Match reports</h2><p class="muted">Your match reports appear here after your first game.</p></section>'; return; }
  const counts = { W: 0, D: 0, L: 0 };
  games.forEach(f => counts[resultFor(f, me)]++);
  const rows = games.map((f, i) => report(S, f, me, T, i === 0)).join('');
  pane.innerHTML = `<div class="stack" style="gap:16px">
    <section class="card"><div class="big-stat"><div><b>${games.length}</b><span>Played</span></div><div><b>${counts.W}</b><span>Won</span></div><div><b>${counts.D}</b><span>Drawn</span></div><div><b>${counts.L}</b><span>Lost</span></div></div></section>
    ${rows}</div>`;
}

function report(S, f, me, T, open) {
  const home = f.home === me, opp = home ? f.away : f.home, o = T[opp] || { code: opp, name: opp };
  const res = f.result, mine = home ? 'home' : 'away', theirs = home ? 'away' : 'home';
  const out = resultFor(f, me);
  const ss = res.stats || {};
  const stat = (label, k, fmt = v => v) => {
    const a = +ss[mine]?.[k] || 0, b = +ss[theirs]?.[k] || 0, tot = a + b || 1;
    return `<div class="sc-stat"><b>${fmt(ss[mine]?.[k] ?? '–')}</b><div><span>${label}</span><div class="sc-bar"><i style="width:${(a / tot) * 100}%"></i></div></div><b>${fmt(ss[theirs]?.[k] ?? '–')}</b></div>`;
  };
  const ev = [...(res.goals || []).map(g => ({ ...g, kind: 'goal' })), ...(res.cards || []).map(c => ({ ...c, kind: 'card' }))].sort((a, b) => a.t - b.t);
  const timeline = ev.map(e => {
    const ours = e.team === me;
    const text = e.kind === 'goal' ? `⚽ ${esc(e.scorer_name || 'Unknown')}${e.own_goal ? ' (OG)' : ''}${e.assist_name ? ` <span class="muted">· ${esc(e.assist_name)}</span>` : ''}`
      : `<i class="sc-card ${e.card === 'yellow' ? 'y' : 'r'}"></i> ${esc(e.name)}${e.card === 'second_yellow' ? ' <span class="muted">(2nd yellow)</span>' : ''}`;
    return `<div class="sc-ev ${ours ? 'us' : 'them'}"><span class="sc-min">${esc(e.minute)}'</span><span>${text}</span></div>`;
  }).join('');
  const ps = Object.entries(res.players || {}).map(([id, p]) => ({ id, ...p })).filter(p => p.team === me).sort((a, b) => (b.r || 0) - (a.r || 0));
  const motm = res.players?.[res.motm];
  const table = ps.length ? `<div style="overflow-x:auto"><table class="sq"><thead><tr><th>Player</th><th>Pos</th><th>Min</th><th>G</th><th>A</th><th>Sh</th><th>Pass</th><th>Tkl</th><th>Rating</th></tr></thead><tbody>
    ${ps.map(p => `<tr><td>${esc(p.name)}${res.motm === p.id ? ' ⭐' : ''}${p.rc ? ' <i class="sc-card r"></i>' : p.yc ? ' <i class="sc-card y"></i>' : ''}</td><td>${esc(p.slot || '')}</td><td>${p.min ?? ''}</td><td>${p.g || ''}</td><td>${p.a || ''}</td><td>${p.sh || ''}</td><td>${p.pas ? `${p.pc}/${p.pas}` : ''}</td><td>${p.tk || ''}</td><td style="color:${ratingColour(p.r)};font-weight:900">${p.r != null ? p.r.toFixed(1) : '–'}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">No player stats in this match file.</p>';
  const k = kickoff(f);
  return `<details class="card sc-report"${open ? ' open' : ''}>
    <summary><span class="sc-res ${out}">${out}</span>
      <span class="sc-sum"><b>${home ? 'v' : '@'} ${esc(o.name)}</b> <span class="muted">${isKnockout(f) ? `${esc(STAGE_NAMES[f.stage])} · ` : `Week ${esc(f.week)} · `}${esc(fmtDate(k))}</span></span>
      <span class="sc-score">${res[mine]}–${res[theirs]}${res.shootout ? `<small>pens ${res.shootout[mine]}–${res.shootout[theirs]}</small>` : ''}</span></summary>
    <div class="stack" style="gap:14px;margin-top:12px">
      ${motm ? `<p style="margin:0;font-size:.88rem">Player of the match: <b>${esc(motm.name)}</b> <span class="muted">(${esc(motm.team)}, ${motm.r.toFixed(1)})</span></p>` : ''}
      <div class="sc-stats"><div class="sc-stat head"><b>${esc(me)}</b><div></div><b>${esc(opp)}</b></div>
        ${stat('Possession %', 'possession')}${stat('xG', 'xg', v => (typeof v === 'number' ? v.toFixed(2) : v))}${stat('Shots', 'shots')}${stat('On target', 'shots_on_target')}${stat('Pass accuracy %', 'pass_accuracy')}${stat('Tackles won', 'tackles_won')}${stat('Corners', 'corners')}${stat('Fouls', 'fouls')}</div>
      ${timeline ? `<div><h3 class="sc-h">Goals and cards</h3><div class="sc-timeline">${timeline}</div></div>` : ''}
      <div><h3 class="sc-h">Your ratings</h3>${table}</div>
      <a class="btn small" href="${matchUrl(f)}" style="justify-self:start">Watch the replay →</a>
    </div></details>`;
}
