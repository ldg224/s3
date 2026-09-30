// Manager Hub: each team's manager signs in with the email and PIN the league admin set,
// then reads league news (the first tab), manages their lineup, formation, tactics and set
// pieces, checks their players' season ratings and answers questions from the media.
// Saves go through the manager relay. League news lives in js/manager-news.js.

import { loadSeason, teamMap, playerTotals, kickoff, status, ladder, finished, resultFor } from './data.js';
import { $, esc, logo, safeColour, onColour, countdown, dayLabel, fmtTime, matchUrl } from './ui.js';
import { FORMATIONS, TACTICS, STEPS, PRESETS, POS_ORDER, squadOf, autoLineup, normaliseTeamFile, loadTeamFile, loadTeamFiles, ratingColour, findManagerTeam, relaySave, pressQuestions } from './managers.js';
import { newsPane, bannerHtml, badgeCount, tickDue } from './manager-news.js';
import { pressMeters } from './press-view.js';
import { pressFor, nextFixture, headingInto } from './press-panels.js';

const SESSION = 'hcl-manager';
let S, T, me = null;          // me = { email, pin, team }
let file = null, saved = '';  // working manager file, and its last-saved JSON
let tab = 'news', picking = null, message = '';
let teamFiles = {};           // every team's file, for poll totals
let wantPost = null;          // a post to open after signing in (manager.html#news/<id>)
const REMEMBER = 'hcl-manager-email', STAY = 'hcl-manager-stay';

const shirt = p => String(p.id).slice(-2);
const surname = p => p.name.split(' ').slice(-1)[0];
// News answers are saved straight away through their own relay action, so they never count as unsaved.
const snapshot = f => JSON.stringify({ ...f, updated: null, news: null });
const dirty = () => file && snapshot(file) !== saved;

function stats() {
  const tot = playerTotals(S);
  return id => tot[id] || { apps: 0, g: 0, a: 0, avg: 0, motm: 0 };
}

// ---------- Sign in ----------

const remembered = () => { try { return localStorage.getItem(REMEMBER) || ''; } catch { return ''; } };

function renderLogin(err = '') {
  const configured = Object.keys(S.managers || {}).length;
  $('#mount').innerHTML = `<section class="card mg-login">
    <div class="mg-crests">${S.teams.map(t => logo(t, 30)).join('')}</div>
    <h1>Manager login</h1>
    <p>Sign in to read league news, pick your lineup, set your tactics and talk to the media.</p>
    ${wantPost ? '<p class="mg-wanted">📣 Sign in to see the league office post you opened.</p>' : ''}
    ${configured ? '' : '<p class="err">Manager logins haven’t been set up yet. Ask the league admin.</p>'}
    <form id="login" class="stack" style="gap:12px" autocomplete="on">
      <label class="field">Email<input class="input" type="email" name="email" autocomplete="email" required value="${esc(remembered())}"></label>
      <label class="field">PIN<input class="input" type="password" name="pin" inputmode="numeric" autocomplete="current-password" required></label>
      <label class="check"><input type="checkbox" name="remember"${remembered() ? ' checked' : ''}><span>Remember my email on this device</span></label>
      <label class="check"><input type="checkbox" name="stay"><span>Keep me signed in on this device <span class="muted">(only on your own phone or computer)</span></span></label>
      <p class="err" id="login-err">${esc(err)}</p>
      <button class="btn primary" type="submit">Sign in</button>
    </form>
    <p style="font-size:.78rem">Your email and PIN are set by the league admin. Forgotten them? Ask the admin to reset them.</p>
  </section>`;
  $('#login').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button'), fd = new FormData(e.target);
    btn.disabled = true; btn.textContent = 'Checking…'; $('#login-err').textContent = '';
    const team = await findManagerTeam(S, fd.get('email'), fd.get('pin'));
    if (!team) { btn.disabled = false; btn.textContent = 'Sign in'; $('#login-err').textContent = 'That email and PIN don’t match any team.'; return; }
    me = { email: String(fd.get('email')).trim(), pin: String(fd.get('pin')).trim(), team };
    try {
      sessionStorage.setItem(SESSION, JSON.stringify(me));
      if (fd.get('remember')) localStorage.setItem(REMEMBER, me.email); else localStorage.removeItem(REMEMBER);
      if (fd.get('stay')) localStorage.setItem(STAY, JSON.stringify(me)); else localStorage.removeItem(STAY);
    } catch { /* private mode */ }
    await openTeam();
  };
}

async function openTeam() {
  const live = await loadTeamFile(me.team);
  let local = null;
  try { local = JSON.parse(sessionStorage.getItem(`${SESSION}-file-${me.team}`) || 'null'); } catch { /* none */ }
  // Just after a save the live site can lag a minute behind; use whichever copy is newer.
  const newest = local && (!live || (local.updated || '') > (live.updated || '')) ? local : live;
  file = normaliseTeamFile(S, me.team, newest || {});
  saved = snapshot(file);
  teamFiles = {};
  if (wantPost) { openPost(wantPost, false, true); wantPost = null; } else render();
  // Other teams' files, for poll totals. The News tab redraws once they arrive (unless a form is in use).
  const code = me.team;
  loadTeamFiles(S).then(all => {
    if (!me || me.team !== code) return;
    delete all[code];   // our own file is `file`, which is fresher
    teamFiles = all;
    if (tab === 'news' && !document.querySelector('#pane form.nw-form :focus')) paneOnly();
    const pm = document.getElementById('press-mine'); if (pm) pm.innerHTML = myMeters();   // now with the opponent's jabs too
  });
}

// ---------- League news ----------

const newsCtx = () => ({
  season: S, me, file, teamFiles,
  // A relay 'news' reply: take its news block, keep any unsaved lineup or tactics edits.
  setNews(news, raw) {
    file.news = news;
    try { sessionStorage.setItem(`${SESSION}-file-${me.team}`, JSON.stringify(raw)); } catch { /* ignore */ }
  },
  openPost,
});

// Show the News tab scrolled to a post. flash = highlight it (deep links and banner taps).
function openPost(id, stay = false, flash = !stay) {
  const y = window.scrollY;
  tab = 'news'; picking = null;
  render();
  const el = document.getElementById(`news-${id}`);
  if (!el) {
    if (!stay) $('#pane').insertAdjacentHTML('afterbegin', '<section class="card"><p class="empty">That post isn’t available for your team (it may have been removed).</p></section>');
    return;
  }
  if (stay) { window.scrollTo({ top: y }); el.scrollIntoView({ block: 'nearest' }); }
  else el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (flash) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
}

// Redraw just the current tab's content (keeps the header, banner and tabs).
function paneOnly() {
  if (tab === 'news') newsPane($('#pane'), newsCtx());
}

function signOut() {
  if (dirty() && !confirm('You have unsaved changes. Sign out anyway?')) return;
  try { sessionStorage.removeItem(SESSION); localStorage.removeItem(STAY); } catch { /* ignore */ }
  me = null; file = null;
  renderLogin();
}

// ---------- Dashboard ----------

function render() {
  const t = T[me.team];
  const tabs = [['news', 'News'], ['overview', 'Overview'], ['lineup', 'Lineup'], ['tactics', 'Tactics'], ['squad', 'Squad'], ['scout', 'Scouting'], ['reports', 'Match reports'], ['media', 'Media']];
  const open = pressQuestions(S, me.team).filter(q => !file.press.some(p => p.id === q.id)).length;
  const ctx = newsCtx(), unread = badgeCount(ctx);
  const count = k => (k === 'media' && open ? ` (${open})` : k === 'news' && unread && tab !== 'news' ? ` <span class="mg-badge">${unread}</span>` : '');
  $('#mount').innerHTML = `<div class="stack">
    <section class="card mg-head">${logo(t, 60)}<div class="grow"><h1>${esc(t.name)}</h1><p>${esc(t.manager || 'Manager')} · signed in as ${esc(me.email)}</p></div>
      <button class="btn small" id="signout">Sign out</button></section>
    <div id="nwbanner">${bannerHtml(ctx)}</div>
    <div class="mg-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}${count(k)}</button>`).join('')}</div>
    <div id="pane"></div>
    <div class="savebar" id="savebar" hidden><span id="save-msg"></span><button class="btn primary" id="save">Save changes</button></div>
  </div>`;
  $('#signout').onclick = signOut;
  $('#nwbanner').onclick = e => { const b = e.target.closest('[data-open-post]'); if (b) openPost(b.dataset.openPost); };
  document.querySelector('.mg-tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; picking = null; render(); } };
  $('#save').onclick = () => save('updated their team');
  ({ news: p => newsPane(p, ctx), overview: overviewPane, lineup: lineupPane, tactics: tacticsPane, squad: squadPane, scout: p => extraPane(p, 'scoutPane'), reports: p => extraPane(p, 'reportsPane'), media: mediaPane })[tab]($('#pane'));
  updateSaveBar();
}

function updateSaveBar() {
  const bar = $('#savebar');
  if (!bar) return;
  bar.hidden = !dirty() && !message;
  $('#save-msg').innerHTML = message || 'You have unsaved changes.';
  $('#save').hidden = !dirty();
}

function changed() { message = ''; updateSaveBar(); }

async function save(what) {
  const btn = $('#save');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const out = await relaySave(S, { action: 'save', team: me.team, email: me.email, pin: me.pin, file, what });
    file = normaliseTeamFile(S, me.team, out.file);
    saved = snapshot(file);
    try { sessionStorage.setItem(`${SESSION}-file-${me.team}`, JSON.stringify(out.file)); } catch { /* ignore */ }
    message = '<span class="ok">✓ Saved. It’s live on the site within about a minute.</span>';
    render();
    return true;
  } catch (e) {
    message = `<span class="err">${esc(e.message)}</span>`;
    if (btn) { btn.disabled = false; btn.textContent = 'Save changes'; }
    updateSaveBar();
    return false;
  }
}

// ---------- Overview ----------

function overviewPane(pane) {
  const code = me.team, now = new Date(), name = c => T[c]?.name || c;
  const mine = S.fixtures.filter(f => (f.home === code || f.away === code) && f.home && f.away);   // skip finals with a team still TBC
  const next = mine.filter(f => ['upcoming', 'live'].includes(status(f, S, now))).sort((a, b) => kickoff(a) - kickoff(b))[0];
  const last = mine.filter(f => status(f, S, now) === 'ft').sort((a, b) => kickoff(b) - kickoff(a))[0];
  const row = ladder(S, finished(S, now)).find(r => r.team.code === code);
  const open = pressQuestions(S, code).filter(q => !file.press.some(p => p.id === q.id));
  const xi = Object.keys(file.lineup).length, slots = Object.keys(FORMATIONS[file.formation]).length;
  const preset = Object.keys(PRESETS).find(n => TACTICS.every(t => PRESETS[n][t.key] === file.tactics[t.key])) || 'Custom';
  const ord = n => n + (['st', 'nd', 'rd'][((n + 90) % 100 - 10) % 10 - 1] || 'th');
  const todo = [
    { ok: xi === slots, text: xi === slots ? `Starting XI picked (${file.formation})` : `Pick your starting XI (${xi}/${slots} chosen)`, go: 'lineup' },
    { ok: file.bench.length > 0, text: file.bench.length ? `${file.bench.length} substitutes on the bench` : 'Pick some substitutes', go: 'lineup' },
    { ok: !!file.captain, text: file.captain ? 'Captain chosen' : 'Choose a captain', go: 'tactics' },
    { ok: true, text: `Game plan: ${preset}`, go: 'tactics' },
    { ok: !open.length, text: open.length ? `${open.length} question${open.length > 1 ? 's' : ''} from the media waiting` : 'No media questions waiting', go: 'media' },
    { ok: !dirty(), text: dirty() ? 'You have unsaved changes' : (file.updated ? `Everything saved (${new Date(file.updated + 'Z').toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })})` : 'Nothing saved yet'), go: null },
  ];
  const vs = f => { const home = f.home === code, opp = home ? f.away : f.home; return { home, opp: T[opp] || { code: opp, name: opp } }; };
  const nextHtml = next ? (() => {
    const { home, opp } = vs(next), k = kickoff(next);
    return `<div class="ov-match">${logo(T[code], 48)}<span class="ov-v">${home ? 'v' : '@'}</span>${logo(opp, 48)}
      <div class="grow"><b>${esc(opp.name)}</b><span>${home ? 'Home' : 'Away'} · Week ${esc(next.week)} · ${esc(dayLabel(k))} ${esc(fmtTime(k))}</span>
      ${status(next, S, now) === 'live' ? '<span class="ov-live">● Live now</span>' : `<span class="countdown" data-kickoff="${k.getTime()}">${countdown(k)}</span>`}</div></div>
      <div class="chips"><button class="btn small primary" data-go="scout">Scout ${esc(opp.name)}</button><a class="btn small" href="${matchUrl(next)}">Match centre</a></div>`;
  })() : '<p class="empty">No upcoming matches scheduled.</p>';
  const lastHtml = last ? (() => {
    const { home, opp } = vs(last), r = resultFor(last, code), gf = home ? last.result.home : last.result.away, ga = home ? last.result.away : last.result.home;
    return `<a class="prow" href="${matchUrl(last)}" style="text-decoration:none"><span class="res-dot ${r}">${r}</span><span class="nm">${gf}-${ga} ${home ? 'v' : '@'} ${esc(opp.name)}</span><span class="tag">Week ${esc(last.week)}</span></a>`;
  })() : '<p class="empty" style="padding:6px">No matches played yet.</p>';
  pane.innerHTML = `<div class="ov-grid">
    <section class="card stack" style="gap:12px"><h2 class="card-title" style="margin:0">Next match</h2>${nextHtml}</section>
    <section class="card stack" style="gap:12px"><h2 class="card-title" style="margin:0">Before kick-off</h2>
      <div class="todo">${todo.map(t => `<button class="todo-row ${t.ok ? 'ok' : ''}" ${t.go ? `data-go="${t.go}"` : 'disabled'}><span class="tick">${t.ok ? '✓' : '!'}</span><span>${esc(t.text)}</span>${t.go ? '<span class="arrow">›</span>' : ''}</button>`).join('')}</div></section>
    <section class="card stack" style="gap:12px"><h2 class="card-title" style="margin:0">League position</h2>
      ${row ? `<div class="big-stat"><div><b>${row.p ? ord(row.rank) : '–'}</b><span>Position</span></div><div><b>${row.pts}</b><span>Points</span></div><div><b>${row.w}-${row.d}-${row.l}</b><span>W-D-L</span></div><div><b>${row.gd > 0 ? '+' : ''}${row.gd}</b><span>Goal diff</span></div></div>` : ''}
      <div class="chips"><a class="btn small" href="table.html">Full table</a></div></section>
    <section class="card stack" style="gap:12px"><h2 class="card-title" style="margin:0">Last result</h2>${lastHtml}<div class="chips"><button class="btn small" data-go="reports">All match reports</button></div></section>
  </div>`;
  pane.onclick = e => { const g = e.target.closest('[data-go]'); if (g) { tab = g.dataset.go; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } };
}

// Scouting and Match reports live in js/manager-scout.js.
let extraMod = null;
function extraPane(pane, fn) {
  const ctx = { season: S, team: me.team, teamFile: file, teams: T };
  if (extraMod?.[fn]) return extraMod[fn](pane, ctx);
  pane.innerHTML = '<section class="card"><p class="empty">Loading…</p></section>';
  import('./manager-scout.js')
    .then(m => { extraMod = m; if (m[fn]) m[fn](pane, ctx); else throw new Error(); })
    .catch(() => { pane.innerHTML = '<section class="card"><p class="empty">Coming soon.</p></section>'; });
}

// ---------- Lineup ----------

function lineupPane(pane) {
  const squad = squadOf(S, me.team), P = Object.fromEntries(squad.map(p => [p.id, p])), st = stats(), t = T[me.team];
  const col = safeColour(t.colour), on = onColour(col);
  const slots = FORMATIONS[file.formation];
  const inXI = new Set(Object.values(file.lineup));
  const lines = `<div class="ln" style="left:0;right:0;top:50%;border-width:2px 0 0"></div>
    <div class="ln" style="left:50%;top:50%;width:26%;aspect-ratio:1;border-radius:50%;transform:translate(-50%,-50%)"></div>
    <div class="ln" style="left:22%;right:22%;bottom:0;height:16%;border-bottom:0"></div><div class="ln" style="left:36%;right:36%;bottom:0;height:6%;border-bottom:0"></div>
    <div class="ln" style="left:22%;right:22%;top:0;height:16%;border-top:0"></div><div class="ln" style="left:36%;right:36%;top:0;height:6%;border-top:0"></div>`;
  const slotHtml = Object.entries(slots).map(([name, s]) => {
    const p = P[file.lineup[name]], r = p ? st(p.id).avg : 0;
    return `<button class="pslot ${p ? '' : 'empty'} ${picking === name ? 'picked' : ''}" data-slot="${name}" style="left:${s.x}%;bottom:${s.y}%;--tc:${esc(col)};--on:${on}" aria-label="${name}: ${p ? esc(p.name) : 'empty'}">
      <span class="shirt">${p ? esc(shirt(p)) : '+'}${p && file.captain === p.id ? '<span class="cap">C</span>' : ''}${r ? `<span class="rt">${r.toFixed(1)}</span>` : ''}${p && p.position !== s.want ? '<span class="oop" title="Out of position"></span>' : ''}</span>
      <span class="nm">${p ? esc(surname(p)) : 'Pick'}</span><span class="sl">${name}</span></button>`;
  }).join('');
  const bench = file.bench.map(id => P[id]).filter(Boolean);
  const spare = squad.filter(p => !inXI.has(p.id) && !file.bench.includes(p.id));
  const row = (p, act, tag) => `<button class="prow" data-${act}="${esc(p.id)}"><span class="pos">${p.position}</span><span class="nm">${esc(p.name)}</span>${tag ? `<span class="tag">${tag}</span>` : ''}<span class="od"><span class="o">${p.offense}</span>/<span class="d">${p.defense}</span></span><span class="rt" style="color:${ratingColour(st(p.id).avg)}">${st(p.id).avg ? st(p.id).avg.toFixed(1) : '–'}</span></button>`;
  const avgXI = (() => { const rs = [...inXI].map(id => st(id).avg).filter(Boolean); return rs.length ? (rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(2) : '–'; })();
  pane.innerHTML = `<div class="mg-lineup">
    <section class="card stack" style="gap:14px">
      <div class="chips">${Object.keys(FORMATIONS).map(f => `<button class="chip-btn" data-form="${f}" aria-pressed="${f === file.formation}">${f}</button>`).join('')}</div>
      <div class="pitch2d">${lines}${slotHtml}</div>
      <div class="chips" style="justify-content:space-between;align-items:center"><span class="muted" style="font-size:.8rem">Starting XI season average: <b style="color:var(--text)">${avgXI}</b>. Tap a player to change them.</span>
        <button class="btn small" id="auto">Auto-pick best XI</button></div>
    </section>
    <aside class="stack">
      <section class="card"><h2 class="card-title">Bench <span>${bench.length}/7</span></h2><div class="plist">${bench.map(p => row(p, 'unbench', 'Remove')).join('') || '<p class="empty" style="padding:6px">No substitutes picked.</p>'}</div></section>
      <section class="card"><h2 class="card-title">Not in the squad</h2><div class="plist">${spare.map(p => row(p, 'bench', bench.length < 7 ? '+ Bench' : '')).join('') || '<p class="empty" style="padding:6px">Everyone is involved.</p>'}</div></section>
    </aside></div>`;
  pane.onclick = e => {
    const f = e.target.closest('[data-form]'), s = e.target.closest('[data-slot]'), b = e.target.closest('[data-bench]'), u = e.target.closest('[data-unbench]');
    if (f) setFormation(f.dataset.form);
    else if (s) openPicker(s.dataset.slot);
    else if (e.target.closest('#auto')) { file.lineup = autoLineup(file.formation, squad); file.bench = file.bench.filter(id => !Object.values(file.lineup).includes(id)); changed(); lineupPane(pane); }
    else if (b && file.bench.length < 7) { file.bench.push(b.dataset.bench); changed(); lineupPane(pane); }
    else if (u) { file.bench = file.bench.filter(id => id !== u.dataset.unbench); changed(); lineupPane(pane); }
  };
}

// Changing formation keeps players in slots of the same name, then fills the gaps sensibly.
function setFormation(f) {
  if (f === file.formation) return;
  const squad = squadOf(S, me.team), old = file.lineup, keep = {};
  for (const name of Object.keys(FORMATIONS[f])) if (old[name]) keep[name] = old[name];
  const leftovers = Object.values(old).filter(id => !Object.values(keep).includes(id));
  const P = Object.fromEntries(squad.map(p => [p.id, p]));
  for (const [name, s] of Object.entries(FORMATIONS[f])) {
    if (keep[name]) continue;
    const i = leftovers.findIndex(id => P[id]?.position === s.want);
    keep[name] = leftovers.splice(i >= 0 ? i : 0, 1)[0];
    if (!keep[name]) delete keep[name];
  }
  file.formation = f;
  file.lineup = keep;
  changed();
  lineupPane($('#pane'));
}

function openPicker(slotName) {
  const squad = squadOf(S, me.team), st = stats(), want = FORMATIONS[file.formation][slotName].want;
  const where = id => Object.entries(file.lineup).find(([, v]) => v === id)?.[0] || (file.bench.includes(id) ? 'Bench' : '');
  const list = [...squad].sort((a, b) => (b.position === want) - (a.position === want) || POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position) || st(b.id).avg - st(a.id).avg);
  const back = document.createElement('div');
  back.className = 'sheet-back';
  back.innerHTML = `<div class="sheet" role="dialog" aria-label="Pick a player for ${slotName}"><h3>${slotName} <span class="muted" style="font-weight:600;font-size:.8rem">· best suited: ${want}</span></h3>
    <div class="plist">${list.map(p => `<button class="prow" data-pick="${esc(p.id)}"><span class="pos">${p.position}</span><span class="nm">${esc(p.name)}</span>${where(p.id) ? `<span class="tag">${where(p.id)}</span>` : ''}<span class="od"><span class="o">${p.offense}</span>/<span class="d">${p.defense}</span></span><span class="rt" style="color:${ratingColour(st(p.id).avg)}">${st(p.id).avg ? st(p.id).avg.toFixed(1) : '–'}</span></button>`).join('')}</div>
    <div class="chips">${file.lineup[slotName] ? '<button class="btn small" data-clear>Leave empty</button>' : ''}<button class="btn small" data-close>Cancel</button></div></div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.onclick = e => {
    if (e.target === back || e.target.closest('[data-close]')) return close();
    if (e.target.closest('[data-clear]')) { delete file.lineup[slotName]; close(); changed(); lineupPane($('#pane')); return; }
    const pick = e.target.closest('[data-pick]');
    if (!pick) return;
    const id = pick.dataset.pick, from = Object.entries(file.lineup).find(([, v]) => v === id)?.[0], current = file.lineup[slotName];
    if (from) { if (current) file.lineup[from] = current; else delete file.lineup[from]; }   // swap places
    file.lineup[slotName] = id;
    file.bench = file.bench.filter(b => b !== id);
    close(); changed(); lineupPane($('#pane'));
  };
}

// ---------- Tactics ----------

function tacticsPane(pane) {
  const squad = squadOf(S, me.team);
  const seg = t => `<div class="tac"><div class="tac-head">${t.label}<span>${STEPS.indexOf(file.tactics[t.key]) === 2 ? 'Balanced' : file.tactics[t.key] < 0.5 ? t.lo : t.hi}</span></div>
    <div class="seg" data-tac="${t.key}">${STEPS.map(v => `<button data-v="${v}" aria-pressed="${file.tactics[t.key] === v}" aria-label="${t.label} ${v * 100}%"></button>`).join('')}</div>
    <div class="seg-ends"><span>${t.lo}</span><span>${t.hi}</span></div></div>`;
  const picker = (key, label) => `<label class="field">${label}<select class="select" data-role="${key}"><option value="">Automatic</option>${squad.map(p => `<option value="${esc(p.id)}"${file[key] === p.id ? ' selected' : ''}>${esc(p.name)} (${p.position})</option>`).join('')}</select></label>`;
  pane.innerHTML = `<div class="stack">
    <section class="card stack" style="gap:16px"><h2 class="card-title" style="margin:0">Game plan</h2>
      <div class="chips">${Object.keys(PRESETS).map(n => `<button class="chip-btn" data-preset="${esc(n)}" aria-pressed="${TACTICS.every(t => PRESETS[n][t.key] === file.tactics[t.key])}">${esc(n)}</button>`).join('')}</div>
      <div class="grid2">${TACTICS.map(seg).join('')}</div>
      <p class="muted" style="font-size:.78rem;margin:0">These settings change how your team plays in simulated matches.</p></section>
    <section class="card stack" style="gap:12px"><h2 class="card-title" style="margin:0">Captain and set pieces</h2>
      <div class="grid2">${picker('captain', 'Captain')}${picker('penalties', 'Penalty taker')}${picker('freekicks', 'Free kicks')}${picker('corners', 'Corners')}</div></section>
    <section class="card stack" style="gap:10px"><h2 class="card-title" style="margin:0">Team news</h2>
      <label class="field">A message to fans, shown in the press room<textarea class="textarea" id="message" maxlength="500" placeholder="e.g. Injury update, a word for the fans, a warning to Saturday's opponents…">${esc(file.message)}</textarea></label></section>
  </div>`;
  pane.onclick = e => {
    const v = e.target.closest('[data-v]'), pr = e.target.closest('[data-preset]');
    if (v) { file.tactics[v.closest('[data-tac]').dataset.tac] = +v.dataset.v; changed(); tacticsPane(pane); }
    if (pr) { file.tactics = { ...PRESETS[pr.dataset.preset] }; changed(); tacticsPane(pane); }
  };
  pane.onchange = e => { const r = e.target.dataset.role; if (r) { file[r] = e.target.value || null; changed(); } };
  pane.querySelector('#message').oninput = e => { file.message = e.target.value.slice(0, 500); changed(); };
}

// ---------- Squad ----------

function squadPane(pane) {
  const squad = squadOf(S, me.team), st = stats();
  const rows = [...squad].sort((a, b) => st(b.id).avg - st(a.id).avg || POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position));
  const played = rows.filter(p => st(p.id).apps);
  const teamAvg = played.length ? (played.reduce((s, p) => s + st(p.id).avg, 0) / played.length).toFixed(2) : '–';
  const best = played[0];
  pane.innerHTML = `<section class="card stack" style="gap:14px"><h2 class="card-title" style="margin:0">Season ratings</h2>
    <div class="big-stat"><div><b>${teamAvg}</b><span>Squad average</span></div><div><b>${squad.length}</b><span>Players</span></div>${best ? `<div><b>${esc(surname(best))}</b><span>Top rated (${st(best.id).avg.toFixed(2)})</span></div>` : ''}</div>
    <div style="overflow-x:auto"><table class="sq"><thead><tr><th>Player</th><th>Pos</th><th>Apps</th><th>Goals</th><th>Assists</th><th class="wide">MOTM</th><th class="wide">Off/Def</th><th>Avg rating</th></tr></thead>
    <tbody>${rows.map(p => { const s = st(p.id); return `<tr><td>${esc(p.name)}</td><td>${p.position}</td><td>${s.apps}</td><td>${s.g}</td><td>${s.a}</td><td class="wide">${s.motm}</td>
      <td class="wide"><span class="od"><span class="o">${p.offense}</span>/<span class="d">${p.defense}</span></span></td><td>${s.apps ? `<span class="rating-pill" style="background:${ratingColour(s.avg)}">${s.avg.toFixed(2)}</span>` : '<span class="muted">–</span>'}</td></tr>`; }).join('')}</tbody></table></div>
    <p class="muted" style="font-size:.78rem;margin:0">Match ratings are out of 10 and come from every completed match this season.</p></section>`;
}

// ---------- Media ----------

// This team's press meters heading into its next match (docs/PRESS_EFFECT.md), with the reasons.
function myMeters() {
  const fx = nextFixture(S, me.team);
  if (!fx) return '<p class="muted" style="margin:0">No match coming up, so nothing you say counts yet.</p>';
  const opp = T[fx.home === me.team ? fx.away : fx.home]?.name || 'your opponent';
  const p = pressFor(S, { ...teamFiles, [me.team]: file }, fx), side = p?.[fx.home === me.team ? 'home' : 'away'];
  if (!side) return '';
  return `${fx.result ? `<p class="muted" style="margin:0;font-size:.82rem">Your match v ${esc(opp)} has already been played out behind the scenes, so these are locked in. What you say now counts toward the match after.</p>` : ''}
    ${pressMeters(side, { opp, why: true, title: headingInto(fx, opp) })}`;
}
const PRESS_RULES = `<ul class="press-rules">
  <li>Everything you say after your last match counts toward the next one, until it's played.</li>
  <li>Answering the media's questions counts for more than your own statements.</li>
  <li>Say each thing once: a repeat counts once and annoys the fans, and only your strongest few comments count.</li>
  <li>Praise and backing your players lifts the dressing room; blaming them in public hurts it. Fans like respect, honesty and thanks, not excuses or arrogance.</li>
  <li>A jab at your next opponent only lands if it's true (their form, late goals, a suspension, or a tactic you really use). Empty trash talk fires them up instead.</li>
</ul>`;

function mediaPane(pane) {
  const open = pressQuestions(S, me.team).filter(q => !file.press.some(p => p.id === q.id));
  const past = [...file.press].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const when = d => (d ? new Date(d).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
  pane.innerHTML = `<div class="stack">
    <section class="card stack" style="gap:12px"><h2 class="card-title" style="margin:0">Your press meters</h2>
      <div id="press-mine" class="stack" style="gap:10px">${myMeters()}</div>
      <details><summary class="muted" style="cursor:pointer;font-size:.85rem">How the press effect works</summary>${PRESS_RULES}</details></section>
    <section class="card stack" style="gap:12px"><h2 class="card-title" style="margin:0">Questions from the media <span>${open.length} waiting</span></h2>
      ${open.map(q => `<div class="qcard" data-q="${esc(q.id)}"><span class="from">${esc(q.from)}</span><div class="q">${esc(q.q)}</div>
        <textarea class="textarea" maxlength="1500" placeholder="Your answer…"></textarea><div class="chips"><button class="btn primary small" data-answer>Publish answer</button></div></div>`).join('')
        || '<p class="empty">No questions right now. Check back after your next match.</p>'}
    </section>
    <section class="card stack" style="gap:12px"><h2 class="card-title" style="margin:0">Make a statement</h2>
      <div class="qcard" data-q="statement"><textarea class="textarea" maxlength="1500" placeholder="Say anything you like to the media: a message to the fans, a jab at a rival…"></textarea>
      <div class="chips"><button class="btn primary small" data-answer>Publish statement</button></div></div></section>
    <section class="card stack" style="gap:12px"><h2 class="card-title" style="margin:0">Your press conferences</h2>
      ${past.map(p => `<div class="qcard"><span class="from">${esc(p.from || 'Press')}</span><div class="q">${esc(p.q)}</div><div class="a">${esc(p.a)}</div>
        <div class="chips" style="justify-content:space-between;align-items:center"><span class="when">${esc(when(p.date))}</span><button class="btn small danger" data-del="${esc(p.id)}">Delete</button></div></div>`).join('')
        || '<p class="empty">Nothing published yet. Your answers appear in the public press room.</p>'}
    </section></div>`;
  pane.onclick = async e => {
    const ans = e.target.closest('[data-answer]'), del = e.target.closest('[data-del]');
    if (ans) {
      const card = ans.closest('[data-q]'), a = card.querySelector('textarea').value.trim();
      if (!a) return card.querySelector('textarea').focus();
      const id = card.dataset.q === 'statement' ? `st-${Date.now()}` : card.dataset.q;
      const q = card.dataset.q === 'statement' ? 'Statement' : open.find(x => x.id === id)?.q;
      const from = card.dataset.q === 'statement' ? 'Statement' : open.find(x => x.id === id)?.from;
      file.press = [...file.press, { id, q, a, from, date: new Date().toISOString().slice(0, 19) }];
      ans.disabled = true; ans.textContent = 'Publishing…';
      if (!(await save('spoke to the media'))) { file.press = file.press.filter(p => p.id !== id); ans.disabled = false; ans.textContent = 'Try again'; }
    }
    if (del && confirm('Delete this answer from the press room?')) {
      const keep = file.press;
      file.press = file.press.filter(p => p.id !== del.dataset.del);
      if (!(await save('removed a press answer'))) file.press = keep;
    }
  };
}

// ---------- Start ----------

async function init() {
  try { S = await loadSeason(); } catch (e) { $('#mount').innerHTML = `<div class="card empty">Couldn't load the league. ${esc(e.message)}</div>`; return; }
  T = teamMap(S);
  try { me = JSON.parse(sessionStorage.getItem(SESSION) || localStorage.getItem(STAY) || 'null'); } catch { me = null; }
  if (me && !T[me.team]) me = null;
  const linked = () => { const m = location.hash.match(/^#news\/(.+)$/); return m ? decodeURIComponent(m[1]) : null; };
  wantPost = linked();
  if (me) await openTeam(); else renderLogin();
  window.addEventListener('hashchange', () => { const id = linked(); if (!id) return; if (me && file) openPost(id); else { wantPost = id; renderLogin(); } });
  window.addEventListener('beforeunload', e => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
  setInterval(() => {
    document.querySelectorAll('.countdown[data-kickoff]').forEach(el => { el.textContent = countdown(new Date(+el.dataset.kickoff)); });
    tickDue();
  }, 15000);
}

init();
