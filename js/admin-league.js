// Edit mode "League" tab: finals, suspensions, points adjustments and rescheduling.
// admin.js calls leagueTab(body, ctx) on every render; ctx = { draft (getter), refresh, esc, teamOpts }.
// Handlers read ctx.draft fresh (a restore replaces it) and call ctx.refresh() after changing it.
// Matches are shown as .fx-card match cards (classes shared with the Fixtures tab, in admin.css).

import { kickoff, byKickoff, ladder, teamMap, status } from './data.js';
import { logo, fmtTime } from './ui.js';
import * as L from './league.js';

let msg = null;   // { ok, text } shown once at the top of the tab after an action

const fmt = f => {
  const k = kickoff(f);
  return k ? k.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'No date';
};

export function leagueTab(body, ctx) {
  const S = ctx.draft, esc = ctx.esc, T = teamMap(S);
  const team = (f, s) => L.sideTeam(S, f, s, T);   // full team, or 'Winner SF1' for an undecided final
  const vs = f => `${team(f, 'home').name} v ${team(f, 'away').name}`;
  const round = f => (f.stage ? L.STAGE_NAMES[f.stage] : `Week ${f.week ?? '?'}`);
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date(), notStarted = f => !kickoff(f) || kickoff(f) > now;   // results are often simulated in advance

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

  // ---- Finals
  const ko = S.fixtures.filter(L.isKnockout).sort(byKickoff);
  const regular = S.fixtures.filter(f => !L.isKnockout(f));
  const unplayed = regular.filter(f => !f.result).length;
  const table = ladder(S, regular.filter(f => f.result));
  const size = S.finals?.teams === 2 ? 2 : 4;
  const finals = ko.length
    ? `<div class="fx-week">${ko.map(f => card(f, { meta: f.seeds ? ` · seeds ${f.seeds.home ?? '?'} v ${f.seeds.away ?? '?'}` : '' })).join('')}</div>
      <div class="ed-row" style="margin-top:10px">${field('Drawn finals are decided by', `<select class="ed-select" id="lg-ties"><option value="penalties"${S.finals?.ties !== 'higher-seed' ? ' selected' : ''}>Penalty shootout</option><option value="higher-seed"${S.finals?.ties === 'higher-seed' ? ' selected' : ''}>Higher seed goes through</option></select>`)}
        <button class="ed-btn small danger" data-act="del-finals" style="align-self:flex-end">Delete finals</button></div>
      <p class="ed-hint">Set dates and kick-off times in the Fixtures tab, and simulate or upload each final there. The Grand Final fills in once both semi-finals have a result.</p>`
    : `<p class="ed-hint">Top ${size} on the ladder${unplayed ? ` <b>right now</b> (${unplayed} regular-season match${unplayed > 1 ? 'es' : ''} still without a result)` : ''}:</p>
      <ol class="ed-seeds" style="margin:0 0 10px;padding-left:22px;display:grid;gap:4px">${table.slice(0, 4).map(r => `<li>${esc(r.team.name)} <span class="ed-hint">${r.pts} pts</span></li>`).join('') || '<li class="ed-hint">No teams yet</li>'}</ol>
      <div class="ed-row">
        ${field('Format', '<select class="ed-select" id="lg-fteams"><option value="4">Top 4: semi-finals (1 v 4, 2 v 3) + Grand Final</option><option value="2">Top 2: Grand Final only</option></select>', '260px')}
        ${field('First final', '<input class="ed-input" type="date" id="lg-fdate">', '150px')}
        ${field('Kick-off', '<input class="ed-input" type="time" id="lg-ftime" value="16:00">', '110px')}
        ${field('Days between rounds', '<input class="ed-input" type="number" id="lg-fgap" min="1" value="7">', '110px')}
        ${field('Draws', '<select class="ed-select" id="lg-fties"><option value="penalties">Penalty shootout</option><option value="higher-seed">Higher seed goes through</option></select>', '200px')}
      </div>
      <div class="ed-row"><button class="ed-btn primary" data-act="build-finals">Build finals</button><span class="ed-hint">Leave the date empty to start a week after the last regular match. Finals don't count on the ladder.</span></div>`;

  // ---- Suspensions
  const susp = L.suspensions(S);
  const upcoming = S.fixtures.filter(f => notStarted(f) && susp.has(f.id)).sort(byKickoff);
  const auto = upcoming.map(f => card(f, {
    extra: `<ul class="ed-hint" style="margin:6px 0 0;padding-left:18px">${susp.get(f.id).map(s => `<li><b style="color:var(--text)">${esc(s.name || s.player)}</b> (${esc(T[S.players.find(p => String(p.id) === String(s.player))?.team]?.name || '')}): ${esc(s.reason)}</li>`).join('')}</ul>`,
  })).join('');
  const player = id => S.players.find(p => String(p.id) === String(id));
  const bans = (S.bans || []).map(b => `<div class="q-row"><span><b>${esc(player(b.player)?.name || b.player)}</b> <span class="ed-hint">${esc(T[player(b.player)?.team]?.name || '')} · ${b.matches} match${b.matches > 1 ? 'es' : ''} from ${esc(b.from)}${b.reason ? ` · ${esc(b.reason)}` : ''}</span></span>
    <button class="ed-btn small danger" data-act="del-ban" data-id="${esc(b.id)}">Remove</button></div>`).join('');
  const playerOpts = S.teams.map(t => `<optgroup label="${esc(t.name)}">${S.players.filter(p => p.team === t.code).sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</optgroup>`).join('');
  const banN = Number.isFinite(S.ban_matches) ? S.ban_matches : 1;

  // ---- Adjustments
  const adjs = (S.adjustments || []).map(a => `<div class="q-row"><span style="display:flex;align-items:center;gap:8px;min-width:0">${logo(T[a.team] || { code: a.team }, 24)}<span><b>${esc(T[a.team]?.name || a.team)}</b> ${a.points > 0 ? '+' : ''}${a.points} pts<br><span class="ed-hint">${a.reason ? `${esc(a.reason)} · ` : ''}${esc(a.date)}</span></span></span>
    <button class="ed-btn small danger" data-act="del-adj" data-id="${esc(a.id)}">Remove</button></div>`).join('');
  const teamNameOpts = S.teams.map(t => `<option value="${esc(t.code)}">${esc(t.name)}</option>`).join('');

  // ---- Rescheduling
  const postponed = S.fixtures.filter(f => f.postponed).sort(byKickoff);
  const open = S.fixtures.filter(f => notStarted(f) && !f.postponed && f.home && f.away).sort(byKickoff);
  const weeks = [...new Set(S.fixtures.filter(f => notStarted(f) && !f.postponed && f.date && f.week != null).map(f => f.week))].sort((a, b) => a - b);
  const pp = postponed.map(f => card(f, {
    meta: f.postponed_reason ? ` · ${esc(f.postponed_reason)}` : '',
    actions: `<input class="ed-input" type="date" data-k="date" value="${esc(f.date || '')}" aria-label="New date" style="flex:1 1 140px">
      <input class="ed-input" type="time" data-k="time" value="${esc(f.time || '')}" aria-label="New kick-off time" style="flex:1 1 100px">
      <button class="ed-btn small primary" data-act="reschedule">Reschedule</button>`,
  })).join('');

  body.innerHTML = `
    ${msg ? `<p class="${msg.ok ? 'ed-ok' : 'ed-err'}">${esc(msg.text)}</p>` : ''}
    <div class="ed-section"><h3>Finals</h3>${finals}</div>

    <div class="ed-section"><h3>Suspensions</h3>
      <div class="ed-row">${field('A red card (or two yellows) bans a player for', `<select class="ed-select" id="lg-banN">${[1, 2, 3].map(n => `<option value="${n}"${n === banN ? ' selected' : ''}>${n} match${n > 1 ? 'es' : ''}</option>`).join('')}</select>`, '240px')}</div>
      <p class="ed-hint">Suspended players are left out when you Simulate, and marked on the match page.</p>
      <div class="ed-sub"><h4>Players missing upcoming matches</h4>${auto ? `<div class="fx-week">${auto}</div>` : '<p class="ed-hint">Nobody is suspended.</p>'}</div>
      <div class="ed-sub"><h4>Manual bans</h4>${bans || '<p class="ed-hint">No manual bans.</p>'}
        <div class="ed-row">${field('Player', `<select class="ed-select" id="lg-bp">${playerOpts}</select>`, '200px')}
          ${field('Matches', '<input class="ed-input" type="number" id="lg-bn" min="1" value="1">', '80px')}
          ${field('Reason', '<input class="ed-input" id="lg-br" placeholder="e.g. Misconduct">', '200px')}
          <button class="ed-btn small primary" data-act="add-ban" style="align-self:flex-end">Add ban</button></div>
        <p class="ed-hint">A manual ban covers the team's next matches that haven't been simulated or played yet.</p></div></div>

    <div class="ed-section"><h3>Points adjustments</h3>
      ${adjs || '<p class="ed-hint">No adjustments. Each one shows on the ladder with a note underneath.</p>'}
      <div class="ed-row">${field('Team', `<select class="ed-select" id="lg-at">${teamNameOpts}</select>`, '200px')}
        ${field('Points', '<input class="ed-input" type="number" id="lg-ap" value="-3">', '80px')}
        ${field('Reason', '<input class="ed-input" id="lg-ar" placeholder="e.g. Fielded an ineligible player">', '220px')}
        <button class="ed-btn small primary" data-act="add-adj" style="align-self:flex-end">Add</button></div></div>

    <div class="ed-section"><h3>Reschedule</h3>
      <div class="ed-sub"><h4>Postponed</h4>${pp ? `<div class="fx-week">${pp}</div>` : '<p class="ed-hint">No postponed matches.</p>'}</div>
      <div class="ed-sub"><h4>Postpone a match</h4>
        <div class="ed-row">${field('Match', `<select class="ed-select" id="lg-pf">${open.map(f => `<option value="${esc(f.id)}">${esc(round(f))}: ${esc(vs(f))} · ${esc(fmt(f))}</option>`).join('')}</select>`, '280px')}
          ${field('Reason', '<input class="ed-input" id="lg-pr" placeholder="e.g. Waterlogged pitch">', '200px')}
          <button class="ed-btn small danger" data-act="postpone" style="align-self:flex-end"${open.length ? '' : ' disabled'}>Postpone</button></div>
        <p class="ed-hint">A postponed match shows as P–P and isn't played until you reschedule it.</p></div>
      <div class="ed-sub"><h4>Move a whole week</h4>
        <div class="ed-row">${field('Week', `<select class="ed-select" id="lg-sw">${weeks.map(w => `<option value="${esc(w)}">Week ${esc(w)}</option>`).join('')}</select>`, '120px')}
          ${field('Days (+ later, − earlier)', '<input class="ed-input" type="number" id="lg-sd" value="7">', '120px')}
          <button class="ed-btn small primary" data-act="shift" style="align-self:flex-end"${weeks.length ? '' : ' disabled'}>Move week</button></div>
        <p class="ed-hint">Moves every match in that week that hasn't kicked off; kick-off times stay the same.</p></div></div>`;
  msg = null;

  const $ = id => body.querySelector('#' + id);
  const done = text => { msg = { ok: true, text }; ctx.refresh(); };
  const fail = e => { msg = { ok: false, text: e.message || String(e) }; ctx.refresh(); };

  body.onchange = e => {
    const d = ctx.draft;
    if (e.target.id === 'lg-ties') { d.finals = { ...(d.finals || {}), ties: e.target.value }; L.resolveFinals(d); ctx.refresh(); }
    if (e.target.id === 'lg-banN') { d.ban_matches = +e.target.value; ctx.refresh(); }
  };

  body.onclick = e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const d = ctx.draft;
    try {
      switch (b.dataset.act) {
        case 'build-finals': {
          const opts = { teams: +$('lg-fteams').value, startDate: $('lg-fdate').value || undefined, time: $('lg-ftime').value || '16:00', gapDays: Math.max(1, +$('lg-fgap').value || 7) };
          let made;
          try { made = L.buildFinals(d, opts); } catch (err) {
            if (!/no result yet/.test(err.message) || !confirm(`${err.message}\n\nBuild the finals from the current ladder anyway?`)) throw err;
            made = L.buildFinals(d, { ...opts, force: true });
          }
          d.finals.ties = $('lg-fties').value;
          return done(`Finals built: ${made.map(f => `${L.STAGE_NAMES[f.stage]} ${f.date}`).join(', ')}.`);
        }
        case 'del-finals': {
          const ko = d.fixtures.filter(L.isKnockout);
          const played = ko.filter(f => f.result).length;
          if (!confirm(played ? `${played} final${played > 1 ? 's have' : ' has'} a result. Delete all finals anyway?` : 'Delete all finals?')) return;
          d.fixtures = d.fixtures.filter(f => !L.isKnockout(f));
          delete d.finals;
          return done('Finals deleted.');
        }
        case 'add-ban': {
          const bn = L.addBan(d, $('lg-bp').value, +$('lg-bn').value, $('lg-br').value);
          return done(`Ban added for ${d.players.find(p => String(p.id) === bn.player)?.name}.`);
        }
        case 'del-ban': L.removeBan(d, b.dataset.id); return done('Ban removed.');
        case 'add-adj': {
          const a = L.addAdjustment(d, $('lg-at').value, +$('lg-ap').value, $('lg-ar').value);
          return done(`${T[a.team]?.name || a.team}: ${a.points > 0 ? '+' : ''}${a.points} pts added.`);
        }
        case 'del-adj': L.removeAdjustment(d, b.dataset.id); return done('Adjustment removed.');
        case 'postpone': {
          const f = d.fixtures.find(x => x.id === $('lg-pf').value);
          if (!f) throw new Error('Pick a match.');
          L.postpone(f, $('lg-pr').value);
          return done(`${vs(f)} postponed.`);
        }
        case 'reschedule': {
          const row = b.closest('[data-id]'), f = d.fixtures.find(x => x.id === row.dataset.id);
          const date = row.querySelector('[data-k="date"]').value, time = row.querySelector('[data-k="time"]').value;
          if (date && date < today && !confirm('That date is in the past, so the result would show straight away once it has one. Continue?')) return;
          L.reschedule(f, date, time);
          return done(`${vs(f)} rescheduled to ${fmt(f)}.`);
        }
        case 'shift': {
          const days = Math.trunc(+$('lg-sd').value);
          if (!days) throw new Error('Enter how many days to move it (negative moves earlier).');
          const moved = L.shiftWeek(d, $('lg-sw').value, days);
          return done(`${moved.length} match${moved.length === 1 ? '' : 'es'} moved ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ${days > 0 ? 'later' : 'earlier'}.`);
        }
      }
    } catch (err) { fail(err); }
  };
}
