// Edit mode "League" tab: finals, suspensions, points adjustments and moving a week (per-match postpone / reschedule is on the Fixtures cards).
// admin.js calls leagueTab(body, ctx) on every render; ctx = { draft (getter), refresh, esc, teamOpts, change, go, toast, ask }.
// Every action goes through ctx.change(label, mutate), which re-renders and shows "<label> · Undo".
// Each action is first tried on a copy of the draft, so a rule error shows next to its form and nothing changes.
// Matches are shown as .fx-card match cards (classes shared with the Fixtures tab, in admin.css).

import { kickoff, byKickoff, ladder, teamMap, status } from './data.js';
import { logo, fmtTime } from './ui.js';
import { toast, ask } from './admin-ui.js';
import * as L from './league.js';

const vals = {};                 // form values by input id; they survive re-renders (publishing re-renders the tab)
const errs = {};                 // section -> error shown inside that section
const closed = new Set();        // collapsed sections

const fmt = f => {
  const k = kickoff(f);
  return k ? k.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'No date';
};
const fmtDay = iso => (iso ? new Date(`${iso}T00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// Run fn on a copy of the draft to check it and get its result, then for real through ctx.change (with Undo).
function apply(ctx, sec, label, fn) {
  let res;
  try { res = fn(structuredClone(ctx.draft)); } catch (e) { errs[sec] = e.message || String(e); ctx.refresh(); return false; }
  delete errs[sec];
  const text = typeof label === 'function' ? label(res) : label;
  if (ctx.change) ctx.change(text, () => fn(ctx.draft));
  else { fn(ctx.draft); ctx.refresh(); toast(text, { kind: 'ok' }); }
  return true;
}

// Needs-attention items for the edit-mode home tab (postponed and undated matches are listed by admin.js).
export function attention(S) {
  const out = [], regular = S.fixtures.filter(f => !L.isKnockout(f));
  if (regular.length && !S.fixtures.some(L.isKnockout) && regular.every(f => f.result))
    out.push({ level: 'amber', tab: 'league', text: 'Every regular-season match has a result. Build the finals.' });
  for (const f of S.fixtures.filter(L.isKnockout)) {
    if (!f.home || !f.away || f.result || kickoff(f)) continue;
    out.push({ level: 'amber', tab: 'fixtures', text: `The ${L.STAGE_NAMES[f.stage]} teams are decided. Give it a date and kick-off time.` });
  }
  return out;
}

export function leagueTab(body, ctx) {
  const S = ctx.draft, esc = ctx.esc, T = teamMap(S);
  const team = (f, s) => L.sideTeam(S, f, s, T);   // full team, or 'Winner SF1' for an undecided final
  const vs = f => `${team(f, 'home').name} v ${team(f, 'away').name}`;
  const round = f => (f.stage ? L.STAGE_NAMES[f.stage] : `Week ${f.week ?? '?'}`);
  const now = new Date(), notStarted = f => !kickoff(f) || kickoff(f) > now;   // results are often simulated in advance
  const v = (id, def = '') => esc(vals[id] ?? def);
  const opt = (id, value, label, def = '') => `<option value="${esc(value)}"${String(vals[id] ?? def) === String(value) ? ' selected' : ''}>${esc(label)}</option>`;

  const chip = f => {
    const st = status(f, S);
    const [cls, text] = st === 'postponed' ? ['pp', 'Postponed'] : st === 'tba' ? ['tbc', 'No date']
      : st === 'live' ? ['done', 'Live'] : st === 'ft' ? ['done', 'Full time'] : f.result ? ['ready', 'Simulated'] : ['up', 'Upcoming'];
    return `<span class="fx-chip ${cls}">${text}</span>`;
  };
  // One match card. `extra` goes under the teams, `actions` in the button row.
  const card = (f, { meta = '', extra = '', actions = '' } = {}) => {
    const h = team(f, 'home'), a = team(f, 'away'), r = f.result;
    const mid = r ? `${r.home}–${r.away}${r.shootout ? `<small>pens ${r.shootout.home}–${r.shootout.away}</small>` : ''}` : esc(kickoff(f) ? fmtTime(kickoff(f)) : '–');
    return `<div class="fx-card" data-id="${esc(f.id)}">
      <div class="fx-meta">${esc(round(f))} · ${esc(fmt(f))}${meta} ${chip(f)}</div>
      <div class="fx-main"><span class="fx-team home"><span class="fx-name">${esc(h.name)}</span>${logo(h, 28)}</span>
        <span class="fx-mid">${mid}</span>
        <span class="fx-team away">${logo(a, 28)}<span class="fx-name">${esc(a.name)}</span></span></div>
      ${extra}${actions ? `<div class="fx-actions">${actions}</div>` : ''}</div>`;
  };
  const field = (label, input, width) => `<label class="ed-field" style="${width ? `flex:1 1 ${width}` : 'flex:1 1 180px'};min-width:0">${label}${input}</label>`;
  const err = sec => (errs[sec] ? `<p class="ed-err" role="alert">${esc(errs[sec])}</p>` : '');
  const section = (key, title, count, inner) => `<details class="ed-section lg-sec" data-sec="${key}"${closed.has(key) ? '' : ' open'}>
    <summary><h3>${title}</h3>${count ? `<span class="lg-count">${esc(count)}</span>` : ''}</summary><div class="lg-body">${inner}</div></details>`;

  // ---- Finals
  const ko = S.fixtures.filter(L.isKnockout).sort(byKickoff);
  const regular = S.fixtures.filter(f => !L.isKnockout(f));
  const unplayed = regular.filter(f => !f.result).length;
  const table = ladder(S, regular.filter(f => f.result));
  const size = +(vals['lg-fteams'] ?? 4) === 2 ? 2 : 4;
  const finals = ko.length
    ? `<div class="fx-week">${ko.map(f => card(f, { meta: f.seeds ? ` · seeds ${f.seeds.home ?? '?'} v ${f.seeds.away ?? '?'}` : '' })).join('')}</div>
      <div class="ed-row" style="margin-top:10px">${field('Drawn finals are decided by', `<select class="ed-select" id="lg-ties"><option value="penalties"${S.finals?.ties !== 'higher-seed' ? ' selected' : ''}>Penalty shootout</option><option value="higher-seed"${S.finals?.ties === 'higher-seed' ? ' selected' : ''}>Higher seed goes through</option></select>`)}
        <button class="ed-btn small danger" data-act="del-finals" style="align-self:flex-end">Delete finals</button></div>
      <p class="ed-hint">Set dates and kick-off times in the Fixtures tab, and simulate or upload each final there. The Grand Final fills in once both semi-finals have a result.</p>`
    : `<p class="ed-hint">Top ${size} on the ladder${unplayed ? ` <b>right now</b> (${unplayed} regular-season match${unplayed > 1 ? 'es' : ''} still without a result)` : ''}:</p>
      <ol class="lg-seeds">${table.slice(0, size).map(r => `<li>${esc(r.team.name)} <span class="ed-hint">${r.pts} pts</span></li>`).join('') || '<li class="ed-hint">No teams yet</li>'}</ol>
      <div class="ed-row">
        ${field('Format', `<select class="ed-select" id="lg-fteams">${opt('lg-fteams', 4, 'Top 4: semi-finals (1 v 4, 2 v 3) + Grand Final', 4)}${opt('lg-fteams', 2, 'Top 2: Grand Final only', 4)}</select>`, '260px')}
        ${field('First final', `<input class="ed-input" type="date" id="lg-fdate" value="${v('lg-fdate')}">`, '150px')}
        ${field('Kick-off', `<input class="ed-input" type="time" id="lg-ftime" value="${v('lg-ftime', '16:00')}">`, '110px')}
        ${field('Days between rounds', `<input class="ed-input" type="number" id="lg-fgap" min="1" value="${v('lg-fgap', 7)}">`, '110px')}
        ${field('Draws', `<select class="ed-select" id="lg-fties">${opt('lg-fties', 'penalties', 'Penalty shootout', 'penalties')}${opt('lg-fties', 'higher-seed', 'Higher seed goes through', 'penalties')}</select>`, '200px')}
      </div>
      <div class="ed-row"><button class="ed-btn primary" data-act="build-finals">Build finals</button><span class="ed-hint">Leave the date empty to start a week after the last regular match. Finals don't count on the ladder.</span></div>`;

  // ---- Suspensions
  const susp = L.suspensions(S);
  const upcoming = S.fixtures.filter(f => notStarted(f) && susp.has(f.id)).sort(byKickoff);
  const player = id => S.players.find(p => String(p.id) === String(id));
  const auto = upcoming.map(f => card(f, {
    extra: `<ul class="ed-hint lg-list">${susp.get(f.id).map(s => `<li><b style="color:var(--text)">${esc(s.name || s.player)}</b> (${esc(T[player(s.player)?.team]?.name || '')}): ${esc(s.reason)}</li>`).join('')}</ul>`,
  })).join('');
  const nSusp = upcoming.reduce((n, f) => n + susp.get(f.id).length, 0);
  // Which upcoming matches a manual ban covers (suspensions() lists each ban under its reason).
  const covers = b => upcoming.filter(f => susp.get(f.id).some(s => String(s.player) === String(b.player) && s.reason === (b.reason || 'Suspended')));
  const bans = (S.bans || []).map(b => {
    const c = covers(b);
    return `<div class="q-row"><span><b>${esc(player(b.player)?.name || b.player)}</b> <span class="ed-hint">${esc(T[player(b.player)?.team]?.name || '')} · ${b.matches} match${b.matches > 1 ? 'es' : ''} from ${esc(fmtDay(b.from))}${b.reason ? ` · ${esc(b.reason)}` : ''}</span>
      <br><span class="ed-hint">${c.length ? `Misses: ${c.map(f => esc(`${vs(f)} (${fmt(f)})`)).join(', ')}` : 'No upcoming matches left to miss.'}</span></span>
      <button class="ed-btn small danger" data-act="del-ban" data-id="${esc(b.id)}">Remove</button></div>`;
  }).join('');
  const playerOpts = `<option value="">Choose a player…</option>` + S.teams.map(t => `<optgroup label="${esc(t.name)}">${S.players.filter(p => p.team === t.code).sort((a, b) => a.name.localeCompare(b.name)).map(p => opt('lg-bp', p.id, p.name)).join('')}</optgroup>`).join('');
  const banN = Number.isFinite(S.ban_matches) ? S.ban_matches : 1;

  // ---- Adjustments
  const adjs = (S.adjustments || []).map(a => `<div class="q-row"><span style="display:flex;align-items:center;gap:8px;min-width:0">${logo(T[a.team] || { code: a.team }, 24)}<span><b>${esc(T[a.team]?.name || a.team)}</b> ${a.points > 0 ? '+' : ''}${a.points} pts<br><span class="ed-hint">${a.reason ? `${esc(a.reason)} · ` : ''}${esc(fmtDay(a.date))}</span></span></span>
    <button class="ed-btn small danger" data-act="del-adj" data-id="${esc(a.id)}">Remove</button></div>`).join('');
  const teamNameOpts = `<option value="">Choose a team…</option>` + S.teams.map(t => opt('lg-at', t.code, t.name)).join('');

  // ---- Rescheduling
  const postponed = S.fixtures.filter(f => f.postponed).sort(byKickoff);
  const weeks = [...new Set(S.fixtures.filter(f => notStarted(f) && !f.postponed && f.date && f.week != null).map(f => f.week))].sort((a, b) => a - b);
  const pp = postponed.map(f => card(f, {
    meta: f.postponed_reason ? ` · ${esc(f.postponed_reason)}` : '',
    actions: '<button class="ed-btn small" data-act="to-fixtures">Reschedule in Fixtures →</button>',
  })).join('');
  const sched = postponed.length ? `${postponed.length} postponed` : '';

  body.innerHTML = `
    ${section('finals', 'Finals', ko.length ? `${ko.length} match${ko.length > 1 ? 'es' : ''}` : 'not built', `${err('finals')}${finals}`)}

    ${section('suspensions', 'Suspensions', nSusp ? `${nSusp} upcoming` : '', `
      <div class="ed-row">${field('A red card (or two yellows) bans a player for', `<select class="ed-select" id="lg-banN">${[1, 2, 3].map(n => `<option value="${n}"${n === banN ? ' selected' : ''}>${n} match${n > 1 ? 'es' : ''}</option>`).join('')}</select>`, '240px')}</div>
      <p class="ed-hint">Suspended players are left out when you Simulate, and marked on the match page.</p>
      <div class="ed-sub"><h4>Players missing upcoming matches</h4>${auto ? `<div class="fx-week">${auto}</div>` : '<p class="ed-hint">Nobody is suspended.</p>'}</div>
      <div class="ed-sub"><h4>Manual bans</h4>${bans || '<p class="ed-hint">No manual bans.</p>'}
        <div class="ed-row">${field('Player', `<select class="ed-select" id="lg-bp">${playerOpts}</select>`, '200px')}
          ${field('Matches', `<input class="ed-input" type="number" id="lg-bn" min="1" value="${v('lg-bn', 1)}">`, '80px')}
          ${field('Reason', `<input class="ed-input" id="lg-br" placeholder="e.g. Misconduct" value="${v('lg-br')}">`, '200px')}
          <button class="ed-btn small primary" data-act="add-ban" style="align-self:flex-end">Add ban</button></div>
        ${err('bans')}
        <p class="ed-hint">A manual ban covers the team's next matches that haven't been simulated or played yet.</p></div>`)}

    ${section('adjustments', 'Points adjustments', (S.adjustments || []).length ? String(S.adjustments.length) : '', `
      ${adjs || '<p class="ed-hint">No adjustments. Each one shows on the ladder with a note underneath.</p>'}
      <div class="ed-row">${field('Team', `<select class="ed-select" id="lg-at">${teamNameOpts}</select>`, '200px')}
        ${field('Points', `<input class="ed-input" type="number" id="lg-ap" step="1" placeholder="e.g. -3" value="${v('lg-ap')}">`, '80px')}
        ${field('Reason', `<input class="ed-input" id="lg-ar" placeholder="e.g. Fielded an ineligible player" value="${v('lg-ar')}">`, '220px')}
        <button class="ed-btn small primary" data-act="add-adj" style="align-self:flex-end">Add</button></div>
      ${err('adjustments')}`)}

    ${section('schedule', 'Schedule', sched, `
      <div class="ed-sub"><h4>Postponed</h4>${pp ? `<div class="fx-week">${pp}</div>` : '<p class="ed-hint">No postponed matches.</p>'}<p class="ed-hint">To postpone, reschedule or restore a match, use its ⋯ menu in the Fixtures tab.</p></div>
      <div class="ed-sub"><h4>Move a whole week</h4>
        <div class="ed-row">${field('Week', `<select class="ed-select" id="lg-sw">${weeks.map(w => opt('lg-sw', w, `Week ${w}`, weeks[0])).join('')}</select>`, '120px')}
          ${field('Days (+ later, − earlier)', `<input class="ed-input" type="number" id="lg-sd" step="1" value="${v('lg-sd', 7)}">`, '120px')}
          <button class="ed-btn small primary" data-act="shift" style="align-self:flex-end"${weeks.length ? '' : ' disabled'}>Move week…</button></div>
        <div id="lg-sprev" class="lg-preview" aria-live="polite">${shiftPreview(S, esc, vs, weeks)}</div>
        ${err('shift')}
        <p class="ed-hint">Moves every match in that week that hasn't kicked off; kick-off times stay the same.</p></div>`)}`;

  const $ = id => body.querySelector('#' + CSS.escape(id));
  for (const d of body.querySelectorAll('details.lg-sec')) d.ontoggle = () => (d.open ? closed.delete(d.dataset.sec) : closed.add(d.dataset.sec));

  // Remember what's typed; a few inputs also change what the tab shows.
  const remember = e => {
    const el = e.target;
    if (!el.id?.startsWith('lg-') || el.id === 'lg-ties' || el.id === 'lg-banN') return;
    vals[el.id] = el.value;
    if (el.id === 'lg-sw' || el.id === 'lg-sd') $('lg-sprev').innerHTML = shiftPreview(ctx.draft, esc, vs, weeks);
  };
  body.oninput = remember;
  body.onchange = async e => {
    remember(e);
    const el = e.target;
    if (el.id === 'lg-fteams') return ctx.refresh();   // seed preview follows the format
    if (el.id === 'lg-ties') {
      const was = S.finals?.ties || 'penalties', val = el.value;
      const decided = ctx.draft.fixtures.filter(f => L.isKnockout(f) && f.result && f.result.home === f.result.away && !f.result.shootout).length;
      if (decided && !await ask({ title: 'Change the tie-break rule?', text: `${decided} drawn final${decided > 1 ? ' was' : 's were'} decided without a shootout. Changing the rule can change who reaches the Grand Final.`, ok: 'Change rule', danger: true })) {
        el.value = was; return;
      }
      return apply(ctx, 'finals', `Drawn finals: ${val === 'higher-seed' ? 'higher seed goes through' : 'penalty shootout'}`, d => { d.finals = { ...(d.finals || {}), ties: val }; L.resolveFinals(d); });
    }
    if (el.id === 'lg-banN') { const n = +el.value; return apply(ctx, 'suspensions', `Red card ban set to ${n} match${n > 1 ? 'es' : ''}`, d => { d.ban_matches = n; }); }
  };

  const clear = (...ids) => ids.forEach(id => delete vals[id]);

  body.onclick = async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    for (const k in errs) delete errs[k];
    const d = ctx.draft;
    switch (b.dataset.act) {
      case 'build-finals': {
        const opts = { teams: +(vals['lg-fteams'] ?? 4), startDate: vals['lg-fdate'] || undefined, time: vals['lg-ftime'] || '16:00', gapDays: Math.max(1, Math.trunc(+vals['lg-fgap'] || 7)) };
        const left = d.fixtures.filter(f => !L.isKnockout(f) && !f.result).length;
        if (left && !await ask({ title: 'Build finals now?', text: `${left} regular-season match${left > 1 ? 'es have' : ' has'} no result yet. The finals would be seeded from the current ladder.`, ok: 'Build anyway' })) return;
        const ties = vals['lg-fties'] || 'penalties';
        if (apply(ctx, 'finals', made => `Finals built: ${made.map(f => `${L.STAGE_NAMES[f.stage]} ${fmtDay(f.date)}`).join(', ')}`,
          x => { const made = L.buildFinals(x, { ...opts, force: !!left }); x.finals.ties = ties; return made; })) clear('lg-fdate');
        return;
      }
      case 'del-finals': {
        const played = d.fixtures.filter(f => L.isKnockout(f) && f.result).length;
        if (played && !await ask({ title: 'Delete the finals?', text: `${played} final${played > 1 ? 's have' : ' has'} a result, which is deleted too.`, ok: 'Delete finals', danger: true })) return;
        return apply(ctx, 'finals', 'Finals deleted', x => { x.fixtures = x.fixtures.filter(f => !L.isKnockout(f)); delete x.finals; });
      }
      case 'add-ban': {
        const pid = vals['lg-bp'] || '', n = Math.trunc(+(vals['lg-bn'] ?? 1)), reason = vals['lg-br'] || '';
        if (!(n >= 1)) { errs.bans = 'A ban is for at least 1 match.'; return ctx.refresh(); }
        if (apply(ctx, 'bans', bn => `Ban added for ${player(bn.player)?.name}`, x => L.addBan(x, pid, n, reason))) clear('lg-bp', 'lg-bn', 'lg-br');
        return;
      }
      case 'del-ban': {
        const bn = (d.bans || []).find(x => x.id === b.dataset.id);
        return apply(ctx, 'bans', `Ban removed for ${player(bn?.player)?.name || 'player'}`, x => L.removeBan(x, b.dataset.id));
      }
      case 'add-adj': {
        const code = vals['lg-at'] || '', pts = vals['lg-ap'] === undefined || vals['lg-ap'] === '' ? NaN : +vals['lg-ap'], reason = vals['lg-ar'] || '';
        if (!code) { errs.adjustments = 'Choose a team.'; return ctx.refresh(); }
        if (!Number.isInteger(pts)) { errs.adjustments = 'Enter a whole number of points, such as -3 or 2.'; return ctx.refresh(); }
        if (apply(ctx, 'adjustments', a => `${T[a.team]?.name || a.team}: ${a.points > 0 ? '+' : ''}${a.points} pts`, x => L.addAdjustment(x, code, pts, reason))) clear('lg-at', 'lg-ap', 'lg-ar');
        return;
      }
      case 'del-adj': {
        const a = (d.adjustments || []).find(x => x.id === b.dataset.id);
        return apply(ctx, 'adjustments', `Adjustment removed${a ? ` (${T[a.team]?.name || a.team} ${a.points > 0 ? '+' : ''}${a.points})` : ''}`, x => L.removeAdjustment(x, b.dataset.id));
      }
      case 'to-fixtures': return ctx.go ? ctx.go('fixtures', 'list') : undefined;
      case 'shift': {
        const w = vals['lg-sw'] ?? weeks[0], days = Math.trunc(+(vals['lg-sd'] ?? 7));
        if (!days) { errs.shift = 'Enter how many days to move it (negative moves earlier).'; return ctx.refresh(); }
        const moving = L.shiftWeek(structuredClone(d), w, days);
        if (!moving.length) { errs.shift = `Nothing in week ${w} can move: every match has kicked off or is postponed.`; return ctx.refresh(); }
        const later = days > 0 ? 'later' : 'earlier', n = Math.abs(days);
        if (!await ask({ title: `Move week ${w}?`, text: `${moving.length} match${moving.length === 1 ? '' : 'es'} move ${n} day${n === 1 ? '' : 's'} ${later}.`, html: previewList(d, moving, esc, vs), ok: 'Move week' })) return;
        apply(ctx, 'shift', `Week ${w}: ${moving.length} match${moving.length === 1 ? '' : 'es'} moved ${n} day${n === 1 ? '' : 's'} ${later}`, x => L.shiftWeek(x, w, days));
        return;
      }
    }
  };
}

// Which matches "Move week" would move, and where to.
function previewList(S, moved, esc, vs) {
  const old = id => S.fixtures.find(f => f.id === id);
  return `<ul class="lg-list">${moved.map(f => `<li>${esc(vs(f))}: ${esc(fmt(old(f.id)))} → <b>${esc(fmt(f))}</b></li>`).join('')}</ul>`;
}
function shiftPreview(S, esc, vs, weeks) {
  const w = vals['lg-sw'] ?? weeks[0], days = Math.trunc(+(vals['lg-sd'] ?? 7));
  if (w == null || !days) return '';
  const moved = L.shiftWeek(structuredClone(S), w, days);
  return moved.length ? previewList(S, moved, esc, vs) : '<p class="ed-hint">Nothing in that week can move.</p>';
}
