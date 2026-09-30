// League edit mode.
//
// Security model: the site is public and static, so a PIN on its own can't protect anything.
// Edits are saved by committing to the GitHub repo with a GitHub access token. The token is
// entered once per device, encrypted with the PIN (AES-GCM, PBKDF2-derived key) and kept only
// in that browser. The PIN unlocks it; without the token nobody can change the site.

import { REPO, BRANCH, SEASON_FILE, MATCH_DIR } from './config.js';
import { loadSeason, setSeason, summariseMatch, parseMatchBlob, localFiles, kickoff, loadMatchFile, status } from './data.js';
import { esc, safeColour, logo, fmtDate, fmtTime } from './ui.js';
import { STAGE_NAMES, postpone, reschedule } from './league.js';
import { loginHash, newSalt } from './managers.js';
import { toast, ask, askText, info } from './admin-ui.js';

const STORE = 'hcl-s3-admin';
const SESSION = 'hcl-s3-admin-token';
const enc = new TextEncoder(), dec = new TextDecoder();

let token = null;
let base = null;          // season as last loaded/published
let draft = null;         // working copy
const uploads = new Map();  // repo path -> Blob to commit
const TABS = [['home', 'Needs attention'], ['fixtures', 'Fixtures'], ['news', 'News'], ['teams', 'Teams'], ['league', 'League'], ['history', 'History'], ['settings', 'Settings']];
const SUBS = { fixtures: [['list', 'Matches'], ['generate', 'Generate a season'], ['upload', 'Upload a match file']], teams: [['clubs', 'Clubs'], ['players', 'Players']] };
let tab = 'home';
const sub = { fixtures: 'list', teams: 'clubs' };

// The open tab lives in the address (#fixtures/upload), so a reload or a shared link reopens it.
function readHash() {
  const [t, s] = location.hash.slice(1).split('/');
  if (TABS.some(([k]) => k === t)) tab = t;
  if (s && SUBS[tab]?.some(([k]) => k === s)) sub[tab] = s;
}
function writeHash() {
  const h = `#${tab}${SUBS[tab] ? `/${sub[tab]}` : ''}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}
function go(t, s) { tab = t; if (s) sub[t] = s; refresh(); }

// ---------- Holds and undo ----------
// Publishing is manual (the Publish button or Ctrl+S). Holds stop it racing a batch simulation.

const holds = new Set();
function hold(key) { holds.add(key); clearTimeout(autoTimer); if (panel) showState(); }
function release(key) { if (holds.delete(key)) scheduleAutoPublish(); if (panel) showState(); }

// Run a change with an Undo toast. Undo is a local change: nothing is published until you press Publish.
let undoN = 0;
function change(label, mutate) {
  const before = structuredClone(draft), beforeUploads = new Map(uploads);
  mutate();
  const key = `undo${++undoN}`;
  hold(key);
  refresh();
  toast(label, {
    kind: 'ok',
    undo: () => { draft = before; uploads.clear(); for (const [k, v] of beforeUploads) uploads.set(k, v); refresh(); },
    onClose: () => release(key),
  });
}

// ---------- Draft kept on this device ----------
// Unpublished changes (and files waiting to upload) are saved in IndexedDB, so a failed publish,
// a crash or a closed tab doesn't lose them. Cleared once everything is live.

const DRAFT_KEY = 'draft';
async function saveDraft() {
  try {
    if (!draft || !base) return;
    if (!pendingCount()) return await fsStore('readwrite', s => s.delete(DRAFT_KEY));
    await fsStore('readwrite', s => s.put({ draft, uploads: [...uploads], base_updated: base.updated || '', saved: new Date().toISOString() }, DRAFT_KEY));
  } catch { /* storage unavailable: work still publishes normally */ }
}
// Never let storage hold up opening the editor (IndexedDB can hang when a browser blocks it).
const loadDraft = () => Promise.race([fsStore('readonly', s => s.get(DRAFT_KEY)).catch(() => null), new Promise(r => setTimeout(r, 2000, null))]);
const dropDraft = () => fsStore('readwrite', s => s.delete(DRAFT_KEY)).catch(() => {});

async function offerSavedDraft() {
  const saved = await loadDraft();
  if (!saved?.draft || JSON.stringify(strip(saved.draft)) === JSON.stringify(strip(base))) { if (saved) dropDraft(); return; }
  const when = new Date(saved.saved).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const changedSince = (base.updated || '') > (saved.base_updated || '');
  const yes = await ask({
    title: 'Unpublished changes found',
    text: `This device has changes from ${when} that weren't published.${changedSince ? ' The league has been changed elsewhere since then, so restoring them replaces those newer changes.' : ''} Restore them?`,
    ok: 'Restore my changes', cancel: 'Throw them away', danger: changedSince,
  });
  if (!yes) { dropDraft(); return; }
  draft = saved.draft;
  draft.updated = base.updated;
  for (const [k, v] of saved.uploads || []) { uploads.set(k, v); if (k.startsWith(MATCH_DIR)) localFiles.set(k, v); }
  toast('Your unpublished changes are back.', { kind: 'ok' });
}

// ---------- Crypto ----------

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function keyFrom(pin, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function saveToken(tok, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(pin, salt), enc.encode(tok));
  localStorage.setItem(STORE, JSON.stringify({ salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
}
async function openToken(pin) {
  const s = JSON.parse(localStorage.getItem(STORE));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.iv) }, await keyFrom(pin, unb64(s.salt)), unb64(s.ct));
  return dec.decode(pt);
}
const hasDevice = () => { try { return !!localStorage.getItem(STORE); } catch { return false; } };

// ---------- GitHub ----------

async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    // GitHub lets browsers cache API answers for 60s; a cached branch tip makes the next
    // commit build on an old parent and fail with "not a fast forward" (422).
    cache: 'no-store',
    ...opts,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).message || msg; } catch { /* no body */ }
    throw new Error(`GitHub: ${msg} (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}
const blobB64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

// One commit containing every changed file (and removed match files).
async function commit(files, deletions, message, onStep) {
  const ref = await gh(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
  const head = await gh(`/repos/${REPO}/git/commits/${ref.object.sha}`);
  const tree = [];
  let n = 0;
  for (const [path, blob] of files) {
    onStep(`Uploading ${++n} of ${files.length}…`);
    const b = await gh(`/repos/${REPO}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: await blobB64(blob), encoding: 'base64' }) });
    tree.push({ path, mode: '100644', type: 'blob', sha: b.sha });
  }
  for (const path of deletions) tree.push({ path, mode: '100644', type: 'blob', sha: null });
  onStep('Saving…');
  const t = await gh(`/repos/${REPO}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: head.tree.sha, tree }) });
  const c = await gh(`/repos/${REPO}/git/commits`, { method: 'POST', body: JSON.stringify({ message, tree: t.sha, parents: [ref.object.sha] }) });
  await gh(`/repos/${REPO}/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
}

// ---------- UI shell ----------

const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
let panel;

function pendingCount() {
  if (!draft || !base) return 0;
  return uploads.size + (JSON.stringify(strip(draft)) !== JSON.stringify(strip(base)) ? 1 : 0);
}
const strip = s => ({ ...s, updated: null });


function modal(html) {
  const m = el(`<div class="ed-modal"><div class="ed-box" role="dialog" aria-modal="true">${html}</div></div>`);
  m.addEventListener('click', e => { if (e.target === m) m.querySelector('[data-close]')?.click(); });
  m.addEventListener('keydown', e => { if (e.key === 'Escape') m.querySelector('[data-close]')?.click(); });
  document.body.appendChild(m);
  return m;
}

function openUnlock() {
  if (!hasDevice()) return openSetup();
  const m = modal(`<h2>Edit mode</h2><p>Enter your PIN to edit the league.</p>
    <input class="ed-input pin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="12" aria-label="PIN">
    <div class="ed-err"></div>
    <div class="ed-row"><button class="ed-btn primary">Unlock</button><button class="ed-btn" data-close>Cancel</button><button class="ed-btn small danger" data-reset style="margin-left:auto">Set up again</button></div>`);
  const input = m.querySelector('input'), err = m.querySelector('.ed-err');
  input.focus();
  const go = async () => {
    try {
      token = await openToken(input.value);
      try { sessionStorage.setItem(SESSION, token); } catch { /* storage unavailable */ }
      m.remove();
      await startEditing();
    } catch { err.textContent = 'Wrong PIN.'; input.select(); }
  };
  m.querySelector('.primary').onclick = go;
  input.onkeydown = e => { if (e.key === 'Enter') go(); };
  m.querySelector('[data-close]').onclick = () => m.remove();
  m.querySelector('[data-reset]').onclick = async () => {
    if (!await ask({ title: 'Set up again?', text: 'This forgets the saved access token on this device. You’ll need a GitHub token to set it up again.', ok: 'Forget and set up', danger: true })) return;
    localStorage.removeItem(STORE); m.remove(); openSetup();
  };
}

function openSetup() {
  const m = modal(`<h2>Set up edit mode on this device</h2>
    <p>Changes are saved to the site's GitHub repository, so edit mode needs a GitHub access token. You only do this once per device.</p>
    <ol>
      <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → New fine-grained token</a>.</li>
      <li>Repository access: <b>Only select repositories</b> → <b>${esc(REPO)}</b>.</li>
      <li>Permissions → Repository → <b>Contents: Read and write</b>. Generate and copy it.</li>
    </ol>
    <label class="ed-field">Access token<input class="ed-input" id="tok" type="password" autocomplete="off" placeholder="github_pat_…"></label>
    <label class="ed-field">Choose a PIN<input class="ed-input" id="pin1" type="password" inputmode="numeric" autocomplete="off" maxlength="12"></label>
    <label class="ed-field">Repeat PIN<input class="ed-input" id="pin2" type="password" inputmode="numeric" autocomplete="off" maxlength="12"></label>
    <p>The token is encrypted with your PIN and stored only in this browser.</p>
    <div class="ed-err"></div>
    <div class="ed-row"><button class="ed-btn primary">Save and unlock</button><button class="ed-btn" data-close>Cancel</button></div>`);
  const err = m.querySelector('.ed-err');
  m.querySelector('[data-close]').onclick = () => m.remove();
  m.querySelector('.primary').onclick = async () => {
    const tok = m.querySelector('#tok').value.trim(), p1 = m.querySelector('#pin1').value, p2 = m.querySelector('#pin2').value;
    if (!tok) return (err.textContent = 'Paste your access token.');
    if (p1.length < 4) return (err.textContent = 'Use a PIN of at least 4 digits.');
    if (p1 !== p2) return (err.textContent = "The PINs don't match.");
    err.textContent = 'Checking the token…';
    token = tok;
    try {
      const repo = await gh(`/repos/${REPO}`);
      if (!repo.permissions?.push) throw new Error('This token can read the repository but not write to it. Give it Contents: Read and write.');
      await saveToken(tok, p1);
      try { sessionStorage.setItem(SESSION, token); } catch { /* storage unavailable */ }
      m.remove();
      await startEditing();
    } catch (e) { token = null; err.textContent = e.message; }
  };
}

async function startEditing() {
  if (!base) {
    base = structuredClone(await loadSeason(true)); // fresh copy, not the one the page loaded earlier
    draft = structuredClone(base);
    await offerSavedDraft();
  }
  openPanel();
}

function openPanel() {
  if (!panel) {
    panel = el(`<section class="ed-panel" aria-label="League editor">
      <div class="ed-head"><h2>League admin</h2><span class="ed-pending" role="status" aria-live="polite"></span>
        <button class="ed-btn primary" data-publish title="Publish (Ctrl+S)">Publish</button><button class="ed-btn" data-discard>Discard</button>
        <a class="ed-btn" href="index.html" target="_blank" rel="noopener">View site ↗</a>
        <button class="ed-btn" data-lock title="Lock edit mode">Lock</button></div>
      <nav class="ed-tabs" role="tablist" aria-label="Admin sections"></nav>
      <div class="ed-body" role="tabpanel"></div></section>`);
    root().replaceChildren(panel);
    panel.querySelector('[data-lock]').onclick = lock;
    panel.querySelector('[data-discard]').onclick = async () => {
      if (!await ask({ title: 'Discard unpublished changes?', text: 'Everything not yet live goes back to how it is on the site.', ok: 'Discard', danger: true })) return;
      draft = structuredClone(base); uploads.clear(); holds.clear(); refresh();
    };
    panel.querySelector('[data-publish]').onclick = () => { autoBlocked = false; publish(); };
  }
  refresh();
}

async function lock() {
  if (publishing) { toast('Wait for the current save to finish, then lock.', { kind: 'err' }); return; }
  if (pendingCount() && !await ask({ title: 'Lock with unpublished changes?', text: 'They stay saved on this device and you’ll be offered them next time you unlock.', ok: 'Lock' })) return;
  await saveDraft();
  token = null;
  try { sessionStorage.removeItem(SESSION); } catch { /* storage unavailable */ }
  clearTimeout(autoTimer); holds.clear();
  panel = null;
  draft = base = null; uploads.clear();
  showLocked();
}

// ---------- Admin page ----------

const root = () => document.getElementById('admin-root');

function showLocked() {
  root().innerHTML = `<section class="card admin-locked">
    <img src="assets/league/logo.png" alt="" width="64" height="64" onerror="this.remove()">
    <h1>League admin</h1>
    <p>${hasDevice() ? 'Enter your PIN to manage the league.' : 'Set up this device to manage the league. You only do this once per device.'}</p>
    <button class="ed-btn primary" id="unlock">${hasDevice() ? 'Unlock' : 'Set up this device'}</button>
    <p class="ed-hint">Managers: your login is in the <a href="manager.html">Manager Hub</a>.</p></section>`;
  root().querySelector('#unlock').onclick = openUnlock;
  openUnlock();
}

function refresh() {
  if (!panel) return;   // locked while something was still running
  const n = pendingCount();
  showState();
  panel.querySelector('[data-publish]').disabled = !n || publishing;
  writeHash();
  const tb = panel.querySelector('.ed-tabs');
  const home = homeCount();
  tb.innerHTML = TABS.map(([k, l]) => `<button role="tab" id="tab-${k}" data-tab="${k}" aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}">${l}${k === 'home' && home ? ` <span class="ed-badge">${home}</span>` : ''}</button>`).join('');
  tb.onclick = e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); };
  // Arrow keys move between tabs (the usual tablist keyboard pattern).
  tb.onkeydown = e => {
    const i = TABS.findIndex(([k]) => k === tab), j = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    go(TABS[(j + TABS.length) % TABS.length][0]);
    panel.querySelector(`#tab-${tab}`).focus();
  };
  const body = panel.querySelector('.ed-body');
  body.setAttribute('aria-labelledby', `tab-${tab}`);
  body.innerHTML = '';
  body.onchange = null;
  body.onclick = null;
  body.oninput = null;
  let target = body;
  if (SUBS[tab]) {
    // Tabs with sub-views (Fixtures: matches / generate / upload; Teams: clubs / players).
    body.innerHTML = `<div class="ed-subnav" role="group" aria-label="View">${SUBS[tab].map(([k, l]) => `<button class="fx-filter" data-sub="${k}" aria-pressed="${sub[tab] === k}">${l}</button>`).join('')}</div><div class="ed-subbody"></div>`;
    body.querySelector('.ed-subnav').onclick = e => { const b = e.target.closest('[data-sub]'); if (b) go(tab, b.dataset.sub); };
    target = body.querySelector('.ed-subbody');
  }
  const views = {
    home: homeTab, news: newsTabHost, league: leagueTabHost, history: historyTab, settings: settingsTab,
    fixtures: { list: fixturesTab, generate: generateTab, upload: uploadTab }[sub.fixtures],
    teams: { clubs: teamsTab, players: playersTab }[sub.teams],
  };
  views[tab](target);
  syncDraft();
}

// Show edits on the page immediately and queue the auto-publish (only when something actually changed).
function syncDraft() {
  const sig = JSON.stringify(draft) + uploads.size;
  if (sig !== syncDraft.sig) {
    syncDraft.sig = sig;
    setSeason(draft);
    window.dispatchEvent(new CustomEvent('season-changed', { detail: draft }));
    saveDraft();
    scheduleAutoPublish();
  }
}

// The draft changed but the tab doesn't need re-rendering (e.g. typing in the news composer).
function touch() {
  if (!panel) return;
  showState();
  panel.querySelector('[data-publish]').disabled = !pendingCount() || publishing;
  syncDraft();
}

// ---------- Fixtures ----------

const teamOpts = (sel) => draft.teams.map(t => `<option value="${esc(t.code)}"${t.code === sel ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
const newId = (week, h, a) => {
  let id = `w${week}-${h}-${a}`.toLowerCase(), i = 2;
  while (draft.fixtures.some(f => f.id === id)) id = `w${week}-${h}-${a}-${i++}`.toLowerCase();
  return id;
};

// Fixture cards grouped by week. What each card shows depends on where the match is up to.
const fxOpenWeeks = new Set(), fxEditing = new Set();
let fxFilter = 'all', fxWeeksInit = false;

function fxState(f) {
  const st = status(f, draft);
  if (!f.home || !f.away) return { key: 'tbc', label: 'Teams to be decided' };
  if (st === 'postponed') return { key: 'pp', label: 'Postponed' };
  if (!kickoff(f)) return { key: 'tbc', label: f.result ? 'Result ready · needs a date' : 'Needs a date' };
  if (f.result) return st === 'upcoming' ? { key: 'ready', label: 'Result ready · hidden until kick-off' } : st === 'live' ? { key: 'done', label: 'Live now' } : { key: 'done', label: 'Played' };
  return st === 'upcoming' ? { key: 'up', label: 'Upcoming · no result yet' } : { key: 'warn', label: 'Kicked off · needs a result' };
}

function fixtureCard(f, T) {
  const side = code => T[code] || { code: code || '?', name: code ? code : 'TBC' };
  const h = side(f.home), a = side(f.away), k = kickoff(f), state = fxState(f), editing = fxEditing.has(f.id);
  const mid = f.result ? `<span class="fx-score ${state.key === 'ready' ? 'hidden' : ''}" title="${state.key === 'ready' ? 'Hidden from the public until kick-off' : ''}">${f.result.home}–${f.result.away}</span>`
    : `<span class="fx-time">${k ? esc(fmtTime(k)) : 'TBC'}</span>`;
  const btn = (act, label, cls = '') => `<button class="ed-btn small ${cls}" data-act="${act}">${label}</button>`;
  const item = (act, label, cls = '') => `<button class="ed-menu-item ${cls}" data-act="${act}">${label}</button>`;
  // The everyday actions stay visible; the rest (and anything destructive) go in the ⋯ menu.
  const menu = [
    item('upload', f.result ? 'Replace match file' : 'Upload match file'),
    f.result ? item('video', '🎬 Highlights video') : '',
    f.home && f.away ? item('press', f.result?.press ? '🎙 Press effect it was played with' : '🎙 Press effect (preview)') : '',
    !f.postponed && !f.result && f.home && f.away ? item('postpone', 'Postpone') : '',
    f.postponed || f.original ? item('restore-date', f.original?.date ? `Restore original date (${esc(fmtDate(kickoff({ ...f, ...f.original })))})` : 'Cancel postponement') : '',
    f.result ? item('clear', 'Remove result', 'danger') : '',
    item('delete', 'Delete fixture', 'danger'),
  ].join('');
  const actions = [
    !f.result && !f.postponed && f.home && f.away ? btn('sim', '⚡ Simulate', 'primary') : '',
    btn('edit', editing ? 'Done' : f.postponed ? 'Reschedule' : 'Edit'),
    `<details class="ed-menu"><summary class="ed-btn small" aria-label="More actions">⋯</summary><div class="ed-menu-list">${menu}</div></details>`,
  ].join('');
  return `<article class="fx-card ${state.key}" data-id="${esc(f.id)}">
    <div class="fx-meta"><span>${f.stage ? `<b>${esc(STAGE_NAMES[f.stage] || f.stage)}</b> · ` : ''}${k ? esc(fmtDate(k)) : 'No date set'}</span>
      <span class="fx-chip ${state.key}">${esc(state.label)}</span></div>
    <div class="fx-main">
      <span class="fx-team home"><span class="fx-name">${esc(h.name)}</span>${logo(h, 34)}</span>
      <span class="fx-mid">${mid}</span>
      <span class="fx-team away">${logo(a, 34)}<span class="fx-name">${esc(a.name)}</span></span>
    </div>
    <div class="fx-actions">${actions}</div>
    ${editing ? `<div class="fx-edit">
      <label class="ed-field">Week<input class="ed-input" type="number" min="1" data-k="week" value="${esc(f.week ?? '')}"></label>
      <label class="ed-field">Date<input class="ed-input" type="date" data-k="date" value="${esc(f.date || '')}"></label>
      <label class="ed-field">Kick-off<input class="ed-input" type="time" data-k="time" value="${esc(f.time || '')}"></label>
      <label class="ed-field">Home<select class="ed-select" data-k="home">${teamOpts(f.home)}</select></label>
      <label class="ed-field">Away<select class="ed-select" data-k="away">${teamOpts(f.away)}</select></label></div>` : ''}
  </article>`;
}

function fixturesTab(body) {
  const T = Object.fromEntries(draft.teams.map(t => [t.code, t]));
  const all = [...draft.fixtures].sort((a, b) => (a.week ?? 999) - (b.week ?? 999) || (kickoff(a) ?? 0) - (kickoff(b) ?? 0));
  const states = new Map(all.map(f => [f.id, fxState(f).key]));
  const count = key => all.filter(f => states.get(f.id) === key).length;
  const filters = [['all', 'All', all.length], ['todo', 'Need a result', count('up') + count('warn')], ['ready', 'Result ready', count('ready')], ['done', 'Played', count('done')], ['tbc', 'Needs a date', count('tbc') + count('pp')]];
  const keep = f => fxFilter === 'all' || (fxFilter === 'todo' ? ['up', 'warn'].includes(states.get(f.id)) : fxFilter === 'tbc' ? ['tbc', 'pp'].includes(states.get(f.id)) : states.get(f.id) === fxFilter);
  const shown = all.filter(keep);
  const weeks = [...new Set(shown.map(f => f.week ?? 'TBA'))];
  // First visit: open the weeks that still have work to do (or the first week).
  if (!fxWeeksInit && all.length) {
    fxWeeksInit = true;
    for (const f of all) if (states.get(f.id) !== 'done') { fxOpenWeeks.add(String(f.week ?? 'TBA')); break; }
    if (!fxOpenWeeks.size) fxOpenWeeks.add(String(all[0].week ?? 'TBA'));
  }
  const weekHtml = weeks.map(w => {
    const list = shown.filter(f => (f.week ?? 'TBA') === w), open = fxOpenWeeks.has(String(w)) || fxFilter !== 'all';
    const dates = [...new Set(list.map(f => (kickoff(f) ? fmtDate(kickoff(f)) : null)).filter(Boolean))];
    const done = list.filter(f => f.result).length;
    return `<details class="fx-week" data-week="${esc(w)}"${open ? ' open' : ''}>
      <summary class="fx-week-head"><b>${w === 'TBA' ? 'Unscheduled' : `Week ${esc(w)}`}</b><span>${esc(dates.join(', ') || 'No date')}</span><span class="fx-count">${done}/${list.length} results</span></summary>
      <div class="fx-list">${list.map(f => fixtureCard(f, T)).join('')}</div></details>`;
  }).join('');
  const todo = unplayed().length;
  body.innerHTML = `<div class="ed-section">
    <div class="fx-top"><div><h3>Fixtures</h3><p class="ed-hint">${all.length} matches · ${count('ready') + count('done')} with results · results stay hidden until kick-off, then play out live over ${esc(draft.live_minutes || 10)} minutes.</p></div>
      ${todo ? `<button class="ed-btn primary" id="sim-all">⚡ Simulate all ${todo} without a result</button>` : ''}</div>
    <div class="fx-filters">${filters.map(([k, l, n]) => `<button class="fx-filter" data-filter="${k}" aria-pressed="${fxFilter === k}">${l} <span>${n}</span></button>`).join('')}</div>
    ${weekHtml || (all.length ? '<p class="ed-hint">Nothing matches this filter.</p>'
    : `<div class="ed-empty"><b>No fixtures yet.</b><span class="ed-hint">Build a whole season in one go, or add fixtures one at a time below.</span><button class="ed-btn primary" data-go-sub="generate">Generate a season</button></div>`)}
    <details class="fx-add"><summary>+ Add a fixture</summary>
      <div class="fx-edit">
        <label class="ed-field">Week<input class="ed-input" type="number" min="1" id="nf-week" value="${esc(all.length ? all[all.length - 1].week ?? 1 : 1)}"></label>
        <label class="ed-field">Date<input class="ed-input" type="date" id="nf-date"></label>
        <label class="ed-field">Kick-off<input class="ed-input" type="time" id="nf-time" value="16:00"></label>
        <label class="ed-field">Home<select class="ed-select" id="nf-home">${teamOpts(draft.teams[0]?.code)}</select></label>
        <label class="ed-field">Away<select class="ed-select" id="nf-away">${teamOpts(draft.teams[1]?.code)}</select></label>
        <button class="ed-btn primary" id="nf-add">Add fixture</button></div></details></div>`;

  body.querySelectorAll('details.fx-week').forEach(d => d.addEventListener('toggle', () => { d.open ? fxOpenWeeks.add(d.dataset.week) : fxOpenWeeks.delete(d.dataset.week); }));
  body.onchange = async e => {
    const card = e.target.closest('.fx-card'), k = e.target.dataset.k;
    if (!card || !k) return;
    const f = draft.fixtures.find(x => x.id === card.dataset.id);
    let v = e.target.value;
    if (k === 'week') v = v === '' ? null : +v;
    if (k === 'home' || k === 'away') {
      if (v === f[k === 'home' ? 'away' : 'home']) { toast('A team can’t play itself. Pick a different team.', { kind: 'err' }); refresh(); return; }
      if (f.result && !await ask({ title: 'Change a team with a result?', text: 'This fixture already has a result for different teams. The result stays attached.', ok: 'Change team', danger: true })) { refresh(); return; }
    }
    if ((k === 'date' || k === 'time') && f.postponed && v) {
      // Giving a postponed match a date reschedules it.
      reschedule(f, k === 'date' ? v : f.date, k === 'time' ? v : f.time);
      if (!f.date) f.postponed = true;   // only the time was set; still waiting for a date
      else toast(`${nameOf(T, f.home)} v ${nameOf(T, f.away)} rescheduled.`, { kind: 'ok' });
    } else f[k] = v || (k === 'week' ? null : '');
    if (k === 'week') fxOpenWeeks.add(String(v ?? 'TBA'));
    refresh();
  };
  body.onclick = async e => {
    const gs = e.target.closest('[data-go-sub]');
    if (gs) { go('fixtures', gs.dataset.goSub); return; }
    const fl = e.target.closest('[data-filter]');
    if (fl) { fxFilter = fl.dataset.filter; refresh(); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const f = draft.fixtures.find(x => x.id === b.closest('.fx-card').dataset.id);
    const vs = `${nameOf(T, f.home)} v ${nameOf(T, f.away)}`;
    const act = b.dataset.act;
    if (act === 'edit') { fxEditing.has(f.id) ? fxEditing.delete(f.id) : fxEditing.add(f.id); refresh(); }
    if (act === 'delete') change(`${vs} (week ${f.week ?? '?'}) deleted.`, () => { if (f.file) uploads.delete(f.file); draft.fixtures = draft.fixtures.filter(x => x !== f); });
    if (act === 'clear') change(`Result of ${vs} removed.`, () => { uploads.delete(f.file); f.result = null; delete f.file; });
    if (act === 'upload') { uploadTarget = f.id; go('fixtures', 'upload'); }
    if (act === 'video') openVideoExport(f);
    if (act === 'press') openPressEffect(f);
    if (act === 'sim') simulateMany([f]);
    if (act === 'postpone') {
      const reason = await askText({ title: `Postpone ${vs}?`, text: 'It stays in the fixture list, marked postponed, until you give it a new date (Reschedule).', label: 'Reason (optional, shown on the site)', ok: 'Postpone' });
      if (reason !== null) change(`${vs} postponed.`, () => postpone(f, reason));
    }
    if (act === 'restore-date') change(f.original?.date ? `${vs} back on its original date.` : `${vs} is no longer postponed.`, () => {
      if (f.original?.date) reschedule(f, f.original.date, f.original.time);
      else { delete f.postponed; delete f.postponed_reason; }
      delete f.original;
    });
  };
  body.querySelector('#sim-all')?.addEventListener('click', async () => {
    const list = unplayed();
    if (await ask({ title: `Simulate ${list.length} fixture${list.length > 1 ? 's' : ''}?`, text: 'This can take a while. Keep this tab open; each result is kept on this device as it finishes. Press Publish when it’s done to put the results live.', ok: 'Simulate' })) simulateMany(list);
  });
  body.querySelector('#nf-add').onclick = () => {
    const week = +body.querySelector('#nf-week').value || 1, h = body.querySelector('#nf-home').value, a = body.querySelector('#nf-away').value;
    if (h === a) return toast('Pick two different teams.', { kind: 'err' });
    draft.fixtures.push({ id: newId(week, h, a), week, date: body.querySelector('#nf-date').value, time: body.querySelector('#nf-time').value, home: h, away: a, result: null });
    fxOpenWeeks.add(String(week));
    toast(`${nameOf(T, h)} v ${nameOf(T, a)} added to week ${week}.`, { kind: 'ok' });
    refresh();
  };
}
const nameOf = (T, c) => T[c]?.name || c || 'TBC';

// ---------- Press effect (docs/PRESS_EFFECT.md) ----------
// Played matches show the snapshot stored when they were simulated; others preview what
// Simulate would use right now, from the team files as they are in the repo.

async function openPressEffect(f) {
  const T = Object.fromEntries(draft.teams.map(t => [t.code, t]));
  const m = modal(`<h2>🎙 Press effect</h2><p>${esc(nameOf(T, f.home))} v ${esc(nameOf(T, f.away))} · Week ${esc(f.week ?? '?')}</p>
    <div class="pe-body"><p class="ed-hint">Loading…</p></div><div class="ed-row"><button class="ed-btn" data-close>Close</button></div>`);
  m.querySelector('.ed-box').classList.add('wide');
  m.querySelector('[data-close]').onclick = () => m.remove();
  const box = m.querySelector('.pe-body');
  try {
    const [{ pressEffect }, view] = await Promise.all([import('./press-effect.js'), import('./press-view.js')]);
    let e = f.result?.press, note;
    if (e) note = `Frozen when the match was simulated (${new Date(`${e.at}Z`).toLocaleString('en-AU')}). Later statements don't change it.`;
    else {
      const files = Object.fromEntries(await Promise.all(draft.teams.map(async t => {
        const b = await readRepo(`data/teams/${t.code.toLowerCase()}.json`);
        return [t.code, b ? JSON.parse(await b.text()) : {}];
      })));
      e = pressEffect(draft, files, f, { now: new Date() });
      note = f.result ? 'This result was added before the press effect existed (or uploaded), so it was played without one. Below is what it would be now.'
        : 'What Simulate would use if you ran it now. It changes as managers speak, until the match is simulated.';
    }
    box.innerHTML = `<p class="ed-hint">${esc(note)}</p>
      ${view.pressMeters(e.home, { opp: nameOf(T, f.away), why: true, title: nameOf(T, f.home) })}
      ${view.pressMeters(e.away, { opp: nameOf(T, f.home), why: true, title: nameOf(T, f.away) })}`;
    box.querySelectorAll('details.pm-why').forEach(d => { d.open = true; });
  } catch (err) { box.innerHTML = `<p class="ed-err">Couldn't work out the press effect: ${esc(err.message)}</p>`; }
}

// ---------- Highlights video ----------
// Renders a ~3 minute highlights MP4, thumbnail and YouTube text for a fixture, in the browser,
// and saves them into a folder the user picks once (remembered per device). Saving files here
// doesn't change the league data, so nothing is published.

const FS_DB = 'hcl-s3-video';
function fsStore(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FS_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', mode), r = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(r?.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}
const getFolder = () => fsStore('readonly', s => s.get('folder')).catch(() => null);
const setFolder = h => fsStore('readwrite', s => s.put(h, 'folder')).catch(() => {});
const canPickFolder = () => typeof window.showDirectoryPicker === 'function';

function saveDownload(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function openVideoExport(f) {
  const hl = await import('./highlights.js');
  const T = Object.fromEntries(draft.teams.map(t => [t.code, t]));
  const label = `Week ${f.week} · ${T[f.home]?.name || f.home} ${f.result.home}-${f.result.away} ${T[f.away]?.name || f.away}`;
  const m = modal(`<h2>🎬 Highlights video</h2><p>${esc(label)}</p>
    <canvas class="vid-preview" width="480" height="270" aria-label="Preview"></canvas>
    <div class="vid-bar"><span></span></div>
    <p class="vid-status">About 3 minutes of highlights in 1080p, with a thumbnail and YouTube title and description.</p>
    <div class="ed-row vid-folder"></div>
    <div class="ed-err"></div>
    <div class="ed-row"><button class="ed-btn primary" data-go>Export video</button><button class="ed-btn" data-close>Close</button></div>`);
  m.querySelector('.ed-box').classList.add('wide');
  const status = m.querySelector('.vid-status'), bar = m.querySelector('.vid-bar span'), err = m.querySelector('.ed-err');
  const go = m.querySelector('[data-go]'), close = m.querySelector('[data-close]'), pv = m.querySelector('.vid-preview').getContext('2d');
  let folder = await getFolder(), cancelled = false, running = false;
  // Don't let a stray click on the backdrop hide an export that's still running.
  m.addEventListener('click', e => { if (running && e.target === m) e.stopImmediatePropagation(); }, true);

  const showFolder = () => {
    const box = m.querySelector('.vid-folder');
    if (!hl.supported()) { box.innerHTML = '<span class="ed-err">This browser can\'t make videos. Use Chrome or Edge on a computer.</span>'; go.disabled = true; return; }
    box.innerHTML = canPickFolder()
      ? `<span class="ed-hint">Save to: <b>${folder ? esc(folder.name) : 'no folder chosen yet'}</b></span><button class="ed-btn small" data-pick>${folder ? 'Change folder' : 'Choose folder'}</button>`
      : '<span class="ed-hint">The files will download to your Downloads folder.</span>';
    const pick = box.querySelector('[data-pick]');
    if (pick) pick.onclick = async () => {
      try { folder = await window.showDirectoryPicker({ id: 'hcl-highlights', mode: 'readwrite', startIn: 'videos' }); await setFolder(folder); showFolder(); }
      catch { /* picker cancelled */ }
    };
  };
  showFolder();
  close.onclick = () => { if (running) { cancelled = true; close.textContent = 'Cancelling…'; } else m.remove(); };

  go.onclick = async () => {
    err.textContent = '';
    cancelled = false;
    let partial = null;   // an unfinished .mp4 in the folder, removed if the export doesn't complete
    try {
      // Folder first (needs this click as the user gesture).
      if (canPickFolder()) {
        if (!folder) { folder = await window.showDirectoryPicker({ id: 'hcl-highlights', mode: 'readwrite', startIn: 'videos' }); await setFolder(folder); showFolder(); }
        if ((await folder.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await folder.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Permission to save into that folder was refused.');
      }
      running = true; go.disabled = true; close.textContent = 'Cancel';
      status.textContent = 'Loading the match…';
      const data = await loadMatchFile(f.file);
      const r = new hl.HighlightsRenderer(data, { season: draft, fixture: f, assets: await hl.loadAssets(draft.teams) });
      const safe = s => String(s).replace(/[\\/:*?"<>|]/g, '-');
      const base = safe(`Week ${f.week} - ${f.home} ${f.result.home}-${f.result.away} ${f.away} Highlights`);
      const t0 = performance.now();
      const fileHandle = folder ? await folder.getFileHandle(`${base}.mp4`, { create: true }) : null;
      if (fileHandle) partial = `${base}.mp4`;
      const mp4 = await hl.exportVideo(r, {
        fileHandle,
        isCancelled: () => cancelled,
        onProgress: (phase, frac) => {
          bar.style.width = `${Math.round(frac * 100)}%`;
          const secs = (performance.now() - t0) / 1000, left = frac > 0.03 ? secs / frac - secs : null;
          status.textContent = `${phase} ${Math.round(frac * 100)}%${left ? ` · about ${Math.max(1, Math.round(left / 60))} min left` : ''}`;
        },
        onPreview: cv => pv.drawImage(cv, 0, 0, 480, 270),
      });
      partial = null;   // the video file is complete
      status.textContent = 'Making the thumbnail…';
      const thumb = await hl.makeThumbnail(r), text = hl.youtubeText(r).text;
      const files = [[`${base} - Thumbnail.png`, thumb], [`${base} - YouTube.txt`, new Blob([text], { type: 'text/plain' })]];
      if (folder) {
        for (const [name, blob] of files) { const h = await folder.getFileHandle(name, { create: true }), w = await h.createWritable(); await w.write(blob); await w.close(); }
      } else {
        saveDownload(mp4, `${base}.mp4`);
        for (const [name, blob] of files) saveDownload(blob, name);
      }
      bar.style.width = '100%';
      const t = Math.round(r.duration), mins = Math.floor(t / 60), secs = t % 60;
      status.innerHTML = `<span class="ed-ok">Done: ${mins}:${String(secs).padStart(2, '0')} video saved${folder ? ` to <b>${esc(folder.name)}</b>` : ''}, with the thumbnail and YouTube text.</span>`;
      const img = new Image(); img.onload = () => pv.drawImage(img, 0, 0, 480, 270); img.src = URL.createObjectURL(thumb);
    } catch (e) {
      err.textContent = e.message === 'Cancelled' ? 'Export cancelled.' : (e.name === 'AbortError' ? 'No folder chosen.' : `Couldn't make the video: ${e.message}`);
      bar.style.width = '0';
      if (folder && partial) {
        // Don't leave a half-written video in the folder.
        try { await folder.removeEntry(partial); err.textContent += ' The unfinished video file was removed.'; }
        catch { err.textContent += ` The unfinished file "${partial}" is still in the folder; delete it.`; }
      }
    } finally {
      running = false; go.disabled = false; go.textContent = 'Export again'; close.textContent = 'Close';
    }
  };
}

// ---------- Upload ----------

let uploadTarget = null;
let pendingFile = null;   // { data, blob }

function uploadTab(body) {
  body.innerHTML = `<div class="ed-section"><h3>Upload a match file</h3>
    <p class="ed-hint">Use a match file from the vLeague simulator (.json or .json.gz). It's attached to a fixture; the result stays hidden until that fixture's kick-off time.</p>
    <label class="drop" id="drop"><strong>Drop a match file here</strong>or click to choose<input type="file" accept=".json,.gz,application/json" hidden></label>
    <div id="upl"></div></div>`;
  const drop = body.querySelector('#drop'), input = drop.querySelector('input');
  const take = async file => {
    try {
      const data = await parseMatchBlob(file, file.name.endsWith('.gz'));
      pendingFile = { data };
      renderUpload(body);
    } catch (e) { body.querySelector('#upl').innerHTML = `<p class="ed-err">${esc(e.message)}</p>`; }
  };
  input.onchange = () => input.files[0] && take(input.files[0]);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) take(e.dataTransfer.files[0]); };
  if (pendingFile) renderUpload(body);
}

function renderUpload(body) {
  const d = pendingFile.data, h = d.teams.home, a = d.teams.away;
  const matching = draft.fixtures.filter(f => f.home === h.code && f.away === a.code);
  // uploadTarget: a fixture id, '__new' (explicitly a new fixture), or null (pick the best match).
  const target = uploadTarget === '__new' ? null
    : draft.fixtures.find(f => f.id === uploadTarget) || matching.find(f => !f.result) || matching[0];
  const opts = draft.fixtures.map(f => `<option value="${esc(f.id)}"${target && f.id === target.id ? ' selected' : ''}>Week ${esc(f.week)} · ${esc(f.home)} v ${esc(f.away)}${f.result ? ' (has file)' : ''}</option>`).join('');
  const mismatch = target && (target.home !== h.code || target.away !== a.code);
  body.querySelector('#upl').innerHTML = `
    <div class="upl-preview"><span class="sw" style="width:12px;height:12px;border-radius:3px;background:${esc(safeColour(h.colour))}"></span>${esc(h.name)}
      <span class="sc">${d.result.home} - ${d.result.away}</span>${esc(a.name)}<span class="sw" style="width:12px;height:12px;border-radius:3px;background:${esc(safeColour(a.colour))}"></span></div>
    <p class="ed-hint">Seed ${esc(d.engine.seed)} · engine ${esc(d.engine.version)} · ${d.result.goals.length} goals</p>
    <label class="ed-field">Attach to
      <select class="ed-select" id="u-target"><option value="__new">New fixture…</option>${opts}</select></label>
    ${mismatch ? '<p class="ed-err">The teams in this file don\'t match that fixture.</p>' : ''}
    <div class="ed-row">
      <label class="ed-field" style="width:80px">Week<input class="ed-input" id="u-week" type="number" min="1" value="${esc(target?.week ?? d.match?.week ?? 1)}"></label>
      <label class="ed-field">Date<input class="ed-input" id="u-date" type="date" value="${esc(target?.date || '')}"></label>
      <label class="ed-field">Kick-off<input class="ed-input" id="u-time" type="time" value="${esc(target?.time || '12:00')}"></label>
    </div>
    <div class="ed-row"><button class="ed-btn primary" id="u-save">Add to season</button><button class="ed-btn" id="u-cancel">Cancel</button></div>
    <p class="ed-hint">Goes live when you press Publish.</p>`;
  const sel = body.querySelector('#u-target');
  if (!target) sel.value = '__new';
  sel.onchange = () => { uploadTarget = sel.value === '__new' ? '__new' : sel.value; renderUpload(body); };
  body.querySelector('#u-cancel').onclick = () => { pendingFile = null; uploadTarget = null; refresh(); };
  body.querySelector('#u-save').onclick = async () => {
    const week = +body.querySelector('#u-week').value || 1, date = body.querySelector('#u-date').value, time = body.querySelector('#u-time').value;
    if (!date) { body.querySelector('#u-date').focus(); return toast('Set the kick-off date. The result is hidden until then.', { kind: 'err' }); }
    let f = sel.value === '__new' ? null : draft.fixtures.find(x => x.id === sel.value);
    if (f && (f.home !== h.code || f.away !== a.code) && !await ask({ title: 'Teams don’t match', text: 'The teams in this file don’t match that fixture. Attach it anyway? The fixture will be changed to these teams.', ok: 'Attach anyway', danger: true })) return;
    if (!f) { f = { id: newId(week, h.code, a.code), result: null }; draft.fixtures.push(f); }
    Object.assign(f, { week, date, time, home: h.code, away: a.code });
    await attachMatch(f, d);
    pendingFile = null; uploadTarget = null;
    fxOpenWeeks.add(String(week));
    toast(`${h.name} ${d.result.home}–${d.result.away} ${a.name} added to week ${week}.`, { kind: 'ok' });
    go('fixtures', 'list');
  };
}

// Attach a match (uploaded or simulated) to a fixture: result summary in the season, full file uploaded.
async function attachMatch(f, d) {
  ensureTeams(d);
  f.file = `${MATCH_DIR}/${f.id}.json.gz`;
  f.result = summariseMatch(d);
  if (d.press) f.result.press = d.press;   // the press effect it was played with (docs/PRESS_EFFECT.md)
  try { (await import('./league.js')).applyKnockoutRules?.(draft, f, d); } catch { /* league rules not installed */ }
  const gz = await new Response(new Blob([JSON.stringify(d)]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  uploads.set(f.file, gz);
  localFiles.set(f.file, gz);
}

// ---------- Simulate ----------
// Runs the vLeague match simulator in this browser (js/simulate.js) and attaches the result.

const unplayed = () => draft.fixtures.filter(f => !f.result && !f.postponed && f.home && f.away).sort((a, b) => (a.week ?? 999) - (b.week ?? 999) || (kickoff(a) ?? 0) - (kickoff(b) ?? 0));

async function simulateMany(list) {
  const m = modal(`<h2>⚡ Simulate</h2><p class="sim-what"></p>
    <div class="vid-bar"><span></span></div><p class="vid-status">Starting the simulator…</p><div class="ed-err"></div>
    <div class="ed-row"><button class="ed-btn" data-close>Cancel</button></div>`);
  const what = m.querySelector('.sim-what'), bar = m.querySelector('.vid-bar span'), status = m.querySelector('.vid-status'), err = m.querySelector('.ed-err'), close = m.querySelector('[data-close]');
  let cancelled = false, running = true, done = 0;
  const skipped = [];
  m.addEventListener('click', e => { if (running && e.target === m) e.stopImmediatePropagation(); }, true);
  close.onclick = () => { if (running) { cancelled = true; close.textContent = 'Stopping after this match…'; } else m.remove(); };
  hold('sim');   // one publish at the end of the batch (each result is still saved on this device)
  try {
    const sim = await import('./simulate.js').catch(() => { throw new Error('The simulator isn’t installed on the site yet.'); });
    for (const f of list) {
      if (cancelled) break;
      what.textContent = `${f.home || 'TBC'} v ${f.away || 'TBC'} · Week ${f.week ?? '?'}${list.length > 1 ? ` (${done + 1} of ${list.length})` : ''}`;
      let data;
      try {
        // A fresh seed each time, so simulating a fixture again gives a new result.
        data = await sim.simulateFixture(draft, f, { seed: Math.floor(Math.random() * 2 ** 31), onProgress: frac => {
          bar.style.width = `${Math.round(((done + Math.min(1, frac)) / list.length) * 100)}%`;
          status.textContent = frac < 0.02 ? 'Loading the simulator (first time takes a moment)…' : `Playing the match… ${Math.round(frac * 100)}%`;
        } });
      } catch (e) {
        if (list.length === 1) throw e;
        skipped.push(`${f.home || 'TBC'} v ${f.away || 'TBC'}: ${e.message}`);   // keep going with the rest
        continue;
      }
      await attachMatch(f, data);
      done++;
      refresh();
    }
    bar.style.width = '100%';
    status.innerHTML = `<span class="ed-ok">${done} match${done === 1 ? '' : 'es'} simulated${cancelled ? ' (stopped early)' : ''}.${done ? ' Press Publish to put the results live.' : ''}</span>`;
    if (skipped.length) err.innerHTML = `${skipped.length} skipped:<br>${skipped.map(esc).join('<br>')}`;
  } catch (e) {
    err.textContent = `${done ? `${done} simulated, then: ` : ''}${e.message}`;
  } finally {
    running = false; close.textContent = 'Close';
    release('sim');
    refresh();
  }
}

// ---------- Generate a season ----------
// Round-robin (circle method). Odd team counts get a bye each round.

const gen = { teams: null, legs: 1, start: '', every: 7, time: '16:00', gap: 5, mode: 'append' };

function roundRobin(codes, legs) {
  const t = [...codes];
  if (t.length % 2) t.push(null);
  const n = t.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      let h = t[i], a = t[n - 1 - i];
      if ((i === 0 && r % 2) || (i > 0 && i % 2)) [h, a] = [a, h];
      if (h && a) games.push([h, a]);
    }
    rounds.push(games);
    t.splice(1, 0, t.pop());   // rotate everyone but the first team
  }
  const out = [...rounds];
  for (let l = 1; l < legs; l++) out.push(...rounds.map(g => g.map(([h, a]) => (l % 2 ? [a, h] : [h, a]))));
  return out;
}

function planSeason() {
  const codes = draft.teams.map(t => t.code).filter(c => gen.teams.has(c));
  if (codes.length < 2) return { error: 'Pick at least two teams.' };
  if (!gen.start) return { error: 'Choose the date of the first round.' };
  const kept = gen.mode === 'replace' ? draft.fixtures.filter(f => f.result) : draft.fixtures;
  const firstWeek = Math.max(0, ...kept.map(f => f.week || 0)) + 1;
  const [y, mo, d] = gen.start.split('-').map(Number), [hh, mm] = (gen.time || '16:00').split(':').map(Number);
  const pad = n => String(n).padStart(2, '0');
  const fixtures = [];
  roundRobin(codes, gen.legs).forEach((games, r) => {
    const day = new Date(y, mo - 1, d + r * gen.every);
    const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    games.forEach(([h, a], j) => {
      const mins = hh * 60 + mm + j * gen.gap;
      fixtures.push({ week: firstWeek + r, date, time: `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`, home: h, away: a });
    });
  });
  return { fixtures, removed: draft.fixtures.length - kept.length };
}

function generateTab(body) {
  if (!gen.teams) gen.teams = new Set(draft.teams.filter(t => !t.withdrawn).map(t => t.code));
  if (!gen.start) { const d = new Date(Date.now() + 7 * 86400000); gen.start = d.toISOString().slice(0, 10); }
  body.innerHTML = `<div class="ed-section"><h3>Generate a season</h3>
    <p class="ed-hint">Every team plays every other team. With an odd number of teams, one team rests each round.</p>
    <div class="gen-teams">${draft.teams.map(t => `<label class="gen-team"><input type="checkbox" data-team="${esc(t.code)}"${gen.teams.has(t.code) ? ' checked' : ''}><span class="sw" style="background:${esc(safeColour(t.colour))}"></span>${esc(t.name)}</label>`).join('') || '<p class="ed-hint">Add teams first.</p>'}</div>
    <div class="ed-row">
      <label class="ed-field">Each pair plays<select class="ed-select" data-g="legs"><option value="1"${gen.legs === 1 ? ' selected' : ''}>Once</option><option value="2"${gen.legs === 2 ? ' selected' : ''}>Twice (home and away)</option><option value="3"${gen.legs === 3 ? ' selected' : ''}>Three times</option></select></label>
      <label class="ed-field">First round<input class="ed-input" type="date" data-g="start" value="${esc(gen.start)}"></label>
      <label class="ed-field" style="width:120px">Days between rounds<input class="ed-input" type="number" min="1" max="60" data-g="every" value="${gen.every}"></label>
    </div>
    <div class="ed-row">
      <label class="ed-field">First kick-off<input class="ed-input" type="time" data-g="time" value="${esc(gen.time)}"></label>
      <label class="ed-field" style="width:150px">Minutes between matches<input class="ed-input" type="number" min="0" max="600" data-g="gap" value="${gen.gap}"></label>
      <label class="ed-field">Existing fixtures<select class="ed-select" data-g="mode"><option value="append"${gen.mode === 'append' ? ' selected' : ''}>Keep them, add after</option><option value="replace"${gen.mode === 'replace' ? ' selected' : ''}>Replace the ones without results</option></select></label>
    </div></div>
    <div class="ed-section"><h3>Preview</h3><div id="gen-preview"></div>
      <div class="ed-row"><button class="ed-btn primary" id="gen-add">Add to season</button></div></div>`;
  const preview = () => {
    const plan = planSeason(), box = body.querySelector('#gen-preview'), btn = body.querySelector('#gen-add');
    btn.disabled = !!plan.error;
    if (plan.error) { box.innerHTML = `<p class="ed-err">${esc(plan.error)}</p>`; return; }
    const weeks = [...new Set(plan.fixtures.map(f => f.week))];
    btn.textContent = `Add ${plan.fixtures.length} fixtures${plan.removed ? ` (replacing ${plan.removed})` : ''}`;
    box.innerHTML = `<p class="ed-hint">${weeks.length} rounds, ${plan.fixtures.length} matches.</p><div class="gen-weeks">${weeks.map(w => {
      const games = plan.fixtures.filter(f => f.week === w);
      return `<div class="gen-week"><b>Week ${w}</b> <span class="ed-hint">${esc(games[0].date)}</span>${games.map(g => `<div>${esc(g.time)} · ${esc(g.home)} v ${esc(g.away)}</div>`).join('')}</div>`;
    }).join('')}</div>`;
  };
  body.oninput = body.onchange = e => {
    const k = e.target.dataset.g, team = e.target.dataset.team;
    if (team) e.target.checked ? gen.teams.add(team) : gen.teams.delete(team);
    if (k) gen[k] = ['legs', 'every', 'gap'].includes(k) ? Math.max(k === 'gap' ? 0 : 1, +e.target.value || 0) : e.target.value;
    if (k || team) preview();
  };
  body.querySelector('#gen-add').onclick = () => {
    const plan = planSeason();
    if (plan.error) return;
    tab = 'fixtures'; sub.fixtures = 'list';
    fxOpenWeeks.add(String(plan.fixtures[0].week));
    change(`${plan.fixtures.length} fixtures added${plan.removed ? `, ${plan.removed} without results replaced` : ''}.`, () => {
      if (gen.mode === 'replace') draft.fixtures = draft.fixtures.filter(f => f.result);
      for (const f of plan.fixtures) draft.fixtures.push({ id: newId(f.week, f.home, f.away), ...f, result: null });
    });
  };
  preview();
}

// ---------- News, forms and polls: js/admin-news.js (format in docs/NEWS.md) ----------

// A file straight from the repo (not the Pages copy, which lags): Blob, or null if it doesn't exist.
async function readRepo(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}&t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub: couldn't read ${path} (${res.status})`);
  return res.blob();
}

// What the News and League tabs get from here (shared UI in js/admin-ui.js).
//   change(label, mutate)  run an edit with an Undo toast; publishing waits for the toast
//   hold(key) / release(key)  pause / resume auto-publish
//   go(tab, sub)  switch tab
const ctx = {
  get draft() { return draft; }, refresh, touch, esc, uploads, readRepo, teamOpts,
  change, hold, release, go, toast, ask, askText, info,
};

let newsMod;
const loadNews = () => import('./admin-news.js').then(m => (newsMod = m));
function newsTabHost(body) {
  if (newsMod) return newsMod.newsTab(body, ctx);
  body.innerHTML = '<div class="ed-section"><p class="ed-hint">Loading…</p></div>';
  loadNews()
    .then(() => { if (tab === 'news') refresh(); })
    .catch(e => { body.innerHTML = `<div class="ed-section"><h3>News</h3><p class="ed-err">Couldn't load the news editor: ${esc(e.message)}</p></div>`; });
}

// ---------- Needs attention (home) ----------
// One list of everything waiting on the admin, from every tab. Each item links to where it's fixed.

function coreAttention() {
  const items = [], T = Object.fromEntries(draft.teams.map(t => [t.code, t]));
  const byState = key => draft.fixtures.filter(f => fxState(f).key === key);
  const vsList = list => list.slice(0, 3).map(f => `${nameOf(T, f.home)} v ${nameOf(T, f.away)}`).join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '');
  if (liveState === 'failed') items.push({ level: 'red', text: 'The last publish didn’t go through. Your changes are still here; press Publish to try again.' });
  const late = byState('warn');
  if (late.length) items.push({ level: 'red', text: `${late.length} match${late.length > 1 ? 'es have' : ' has'} kicked off without a result: ${vsList(late)}.`, tab: 'fixtures', filter: 'todo', act: '⚡ Simulate them' });
  const soon = draft.fixtures.filter(f => fxState(f).key === 'up' && kickoff(f) - Date.now() < 2 * 86400000);
  if (soon.length) items.push({ level: 'amber', text: `${soon.length} match${soon.length > 1 ? 'es kick' : ' kicks'} off in the next 2 days with no result yet: ${vsList(soon)}.`, tab: 'fixtures', filter: 'todo' });
  const undated = draft.fixtures.filter(f => f.home && f.away && (!kickoff(f) || f.postponed));
  if (undated.length) items.push({ level: 'amber', text: `${undated.length} fixture${undated.length > 1 ? 's need' : ' needs'} a date${undated.some(f => f.postponed) ? ' (including postponed ones)' : ''}.`, tab: 'fixtures', filter: 'tbc' });
  const players = draft.players || [];
  const active = draft.teams.filter(t => !t.withdrawn);
  const unready = active.filter(t => { const ps = players.filter(p => p.team === t.code); return ps.length < 11 || !ps.some(p => p.position === 'GK'); });
  if (unready.length) items.push({ level: 'amber', text: `${unready.map(t => t.name).join(', ')} can’t be simulated yet: each team needs 11 players including a goalkeeper.`, tab: 'teams', sub: 'players' });
  const noLogin = active.filter(t => !(draft.managers || {})[t.code]);
  if (noLogin.length) items.push({ level: 'amber', text: `${noLogin.length} team${noLogin.length > 1 ? 's have' : ' has'} no manager login: ${noLogin.map(t => t.name).join(', ')}.`, tab: 'teams', sub: 'clubs' });
  if (draft.managers && Object.keys(draft.managers).length && !draft.manager_relay) items.push({ level: 'amber', text: 'Managers have logins but the Manager Hub link isn’t set, so they can’t save.', tab: 'settings' });
  if (!draft.fixtures.length) items.push({ level: 'amber', text: 'There are no fixtures yet.', tab: 'fixtures', sub: 'generate', act: 'Generate a season' });
  return items;
}

// Items from the News and League tabs, once those modules have loaded. Only the home tab passes
// ctx (which lets News fetch the team files); the tab badge uses whatever is already cached.
function moduleAttention(load = false) {
  const out = [];
  for (const [mod, t] of [[newsMod, 'news'], [leagueMod, 'league']]) {
    try { for (const it of mod?.attention?.(draft, load ? ctx : undefined) || []) out.push({ tab: t, ...it }); } catch { /* a module's check failing shouldn't hide the rest */ }
  }
  return out;
}
const homeCount = () => (draft ? coreAttention().length + moduleAttention().length : 0);

function homeTab(body) {
  // Load News and League in the background so their items appear too.
  if (!newsMod || !leagueMod) Promise.allSettled([newsMod || loadNews(), leagueMod || loadLeague()]).then(() => { if (tab === 'home') refresh(); });
  const items = [...coreAttention(), ...moduleAttention(true)].sort((a, b) => (a.level === 'red' ? 0 : 1) - (b.level === 'red' ? 0 : 1));
  const T = Object.fromEntries(draft.teams.map(t => [t.code, t]));
  const next = draft.fixtures.filter(f => kickoff(f) && kickoff(f) > Date.now() && !f.postponed).sort((a, b) => kickoff(a) - kickoff(b)).slice(0, 5);
  const label = it => it.act || (it.view === 'responses' ? 'Review responses' : null) || { fixtures: 'Open fixtures', news: 'Open post', league: 'Open League', teams: 'Open teams', settings: 'Open settings' }[it.tab] || 'Open';
  body.innerHTML = `<div class="ed-section"><h3>Needs attention</h3>
    ${items.length ? `<div class="att-list">${items.map((it, i) => `<div class="att-item ${it.level}"><span class="att-dot" aria-hidden="true"></span><span class="att-text">${esc(it.text)}</span>${it.tab ? `<button class="ed-btn small" data-att="${i}">${esc(label(it))}</button>` : ''}</div>`).join('')}</div>`
    : '<p class="ed-ok">✓ Nothing needs doing right now.</p>'}</div>
    <div class="ed-section"><h3>Coming up</h3>${next.length ? next.map(f => `<div class="hist-row"><span><b>${esc(nameOf(T, f.home))} v ${esc(nameOf(T, f.away))}</b><span class="ed-hint">Week ${esc(f.week ?? '?')} · ${esc(fmtDate(kickoff(f)))} ${esc(fmtTime(kickoff(f)))}</span></span><span class="fx-chip ${fxState(f).key}">${esc(fxState(f).label)}</span></div>`).join('') : '<p class="ed-hint">No upcoming matches.</p>'}</div>`;
  body.onclick = e => {
    const b = e.target.closest('[data-att]');
    if (!b) return;
    const it = items[+b.dataset.att];
    if (it.filter) fxFilter = it.filter;
    if (it.tab === 'news' && it.post) newsMod?.openPost?.(it.post, it.view);
    if (it.act === '⚡ Simulate them') { go('fixtures', 'list'); simulateMany(draft.fixtures.filter(f => fxState(f).key === 'warn')); return; }
    go(it.tab, it.sub);
  };
}

// ---------- League (finals, suspensions, adjustments, rescheduling): js/admin-league.js ----------

let leagueMod;
const loadLeague = () => import('./admin-league.js').then(m => (leagueMod = m));
function leagueTabHost(body) {
  if (leagueMod) return leagueMod.leagueTab(body, ctx);
  body.innerHTML = '<div class="ed-section"><p class="ed-hint">Loading…</p></div>';
  loadLeague()
    .then(() => { if (tab === 'league') refresh(); })
    .catch(() => { body.innerHTML = '<div class="ed-section"><h3>League</h3><p class="ed-hint">Finals, suspensions, points adjustments and rescheduling are coming soon.</p></div>'; });
}

// ---------- Players ----------

const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'];
let playerTeam = 'all';

function playersTab(body) {
  draft.players = draft.players || [];
  const teams = draft.teams, known = new Set(teams.map(t => t.code)), free = p => !known.has(p.team);
  const shown = draft.players.filter(p => playerTeam === 'all' || (playerTeam === '__free' ? free(p) : p.team === playerTeam))
    .sort((a, b) => a.team.localeCompare(b.team) || POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) || a.name.localeCompare(b.name));
  // Squad chips double as the team filter.
  const squads = () => teams.map(t => {
    const ps = draft.players.filter(p => p.team === t.code), gk = ps.filter(p => p.position === 'GK').length;
    const ok = ps.length >= 11 && gk >= 1;
    return `<button class="squad-chip ${ok ? '' : 'bad'}" data-show="${esc(t.code)}" aria-pressed="${playerTeam === t.code}" title="${ok ? 'Ready to simulate' : 'Needs at least 11 players including a goalkeeper to simulate'}">${esc(t.code)} ${ps.length}${gk ? '' : ' · no GK'}</button>`;
  }).join('') + (draft.players.some(free) ? `<button class="squad-chip free" data-show="__free" aria-pressed="${playerTeam === '__free'}">Free agents ${draft.players.filter(free).length}</button>` : '');
  const squad = squads();
  const teamSel = (sel, attrs) => `<select class="ed-select" ${attrs}><option value=""${known.has(sel) ? '' : ' selected'}>Free agent</option>${teams.map(t => `<option value="${esc(t.code)}"${t.code === sel ? ' selected' : ''}>${esc(t.code)}</option>`).join('')}</select>`;
  const posSel = (sel, attrs) => `<select class="ed-select" ${attrs}>${POSITIONS.map(x => `<option${x === sel ? ' selected' : ''}>${x}</option>`).join('')}</select>`;
  body.innerHTML = `<div class="ed-section"><h3>Squads</h3><div class="squads">${squad || '<span class="ed-hint">No teams yet.</span>'}</div>
    <p class="ed-hint">Ratings are 1 to 10. Each team needs at least 11 players, including a goalkeeper, for the simulator. Free agents aren't in any team; set their team to sign them.</p></div>
    <div class="ed-section"><div class="ed-row" style="justify-content:space-between"><h3>Players</h3>
      <label class="ed-field" style="width:140px">Show<select class="ed-select" id="pl-filter"><option value="all">All teams</option>${teams.map(t => `<option value="${esc(t.code)}"${t.code === playerTeam ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}<option value="__free"${playerTeam === '__free' ? ' selected' : ''}>Free agents</option></select></label></div>
    <div style="overflow-x:auto"><table class="fx-table pl-table"><thead><tr><th>Name</th><th>Team</th><th>Pos</th><th>Off</th><th>Def</th><th></th></tr></thead><tbody>
    ${shown.map(p => `<tr data-pid="${esc(p.id)}"><td><input class="ed-input" data-k="name" value="${esc(p.name)}" aria-label="Name"></td>
      <td>${teamSel(p.team, 'data-k="team" aria-label="Team"')}</td><td>${posSel(p.position, 'data-k="position" aria-label="Position"')}</td>
      <td><input class="ed-input w" type="number" min="1" max="10" data-k="offense" value="${esc(p.offense)}" aria-label="Offence"></td>
      <td><input class="ed-input w" type="number" min="1" max="10" data-k="defense" value="${esc(p.defense)}" aria-label="Defence"></td>
      <td><button class="ed-btn small danger" data-remove-player aria-label="Remove ${esc(p.name)}">✕</button></td></tr>`).join('') || '<tr><td colspan="6" class="ed-hint">No players.</td></tr>'}
    <tr class="fx-new"><td><input class="ed-input" id="np-name" placeholder="New player name"></td><td>${teamSel(playerTeam === 'all' ? teams[0]?.code : playerTeam === '__free' ? '' : playerTeam, 'id="np-team"')}</td>
      <td>${posSel('MID', 'id="np-pos"')}</td><td><input class="ed-input w" type="number" min="1" max="10" id="np-off" value="5"></td>
      <td><input class="ed-input w" type="number" min="1" max="10" id="np-def" value="5"></td><td><button class="ed-btn small primary" id="np-add">+ Add</button></td></tr>
    </tbody></table></div></div>`;
  body.querySelector('#pl-filter').onchange = e => { playerTeam = e.target.value; refresh(); };
  body.onchange = e => {
    const tr = e.target.closest('tr[data-pid]'), k = e.target.dataset.k;
    if (!tr || !k) return;
    const pl = draft.players.find(x => x.id === tr.dataset.pid);
    let v = e.target.value;
    if (k === 'offense' || k === 'defense') v = Math.max(1, Math.min(10, Math.round(+v) || 1));
    if (k === 'name' && !v.trim()) { e.target.value = pl.name; toast('A player needs a name.', { kind: 'err' }); return; }
    pl[k] = typeof v === 'string' ? v.trim() : v;
    if (typeof v === 'number') e.target.value = v;
    // Update in place (no re-render), so Tab moves on to the next field as normal.
    body.querySelector('.squads').innerHTML = squads();
    touch();
  };
  body.onclick = e => {
    const sh = e.target.closest('[data-show]');
    if (sh) { playerTeam = playerTeam === sh.dataset.show ? 'all' : sh.dataset.show; refresh(); return; }
    const rm = e.target.closest('[data-remove-player]');
    if (rm) {
      const pl = draft.players.find(x => x.id === rm.closest('tr').dataset.pid);
      change(`${pl.name} removed.`, () => { draft.players = draft.players.filter(x => x !== pl); });
      return;
    }
    if (!e.target.closest('#np-add')) return;
    const name = body.querySelector('#np-name').value.trim();
    if (!name) { body.querySelector('#np-name').focus(); return toast('Enter the player’s name.', { kind: 'err' }); }
    const next = Math.max(-1, ...draft.players.map(x => parseInt(x.id, 10)).filter(Number.isFinite)) + 1;
    const clamp10 = v => Math.max(1, Math.min(10, Math.round(+v) || 5));
    draft.players.push({ id: String(next).padStart(4, '0'), name, team: body.querySelector('#np-team').value, position: body.querySelector('#np-pos').value,
      offense: clamp10(body.querySelector('#np-off').value), defense: clamp10(body.querySelector('#np-def').value) });
    toast(`${name} added.`, { kind: 'ok' });
    refresh();
    panel.querySelector('#np-name')?.focus();   // ready for the next one
  };
}

// ---------- History ----------
// Every publish is a commit, so the history is the list of commits to the season file.

let historyList = null, historyErr = '';

async function loadHistory() {
  try {
    historyList = await gh(`/repos/${REPO}/commits?path=${encodeURIComponent(SEASON_FILE)}&sha=${BRANCH}&per_page=30`);
    historyErr = '';
  } catch (e) { historyErr = e.message; }
  if (tab === 'history' && panel) refresh();
}

function historyTab(body) {
  if (!historyList && !historyErr) { body.innerHTML = '<div class="ed-section"><p class="ed-hint">Loading the history…</p></div>'; loadHistory(); return; }
  const when = iso => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  body.innerHTML = `<div class="ed-section"><div class="ed-row" style="justify-content:space-between"><h3>Change history</h3><button class="ed-btn small" id="hist-reload">Refresh</button></div>
    <p class="ed-hint">Every saved change is listed here. Restore puts the league back exactly as it was then, including match files, and publishes it straight away (with anything else unpublished). You can undo a restore by restoring the version above it.</p>
    ${historyErr ? `<p class="ed-err">${esc(historyErr)}</p>` : ''}
    <div class="hist">${(historyList || []).map((c, i) => `<div class="hist-row"><div><b>${esc(c.commit.message.split('\n')[0].replace(/^Edit mode: /, ''))}</b><span class="ed-hint">${esc(when(c.commit.author.date))}${i === 0 ? ' · current version' : ''}</span></div>
      ${i === 0 ? '' : `<button class="ed-btn small" data-restore="${esc(c.sha)}" data-when="${esc(when(c.commit.author.date))}">Restore</button>`}</div>`).join('')}</div></div>`;
  body.querySelector('#hist-reload').onclick = () => { historyList = null; historyErr = ''; refresh(); };
  body.onclick = e => {
    const b = e.target.closest('[data-restore]');
    if (b) restoreVersion(b.dataset.restore, b.dataset.when, b);
  };
}

async function restoreVersion(sha, when, btn) {
  if (publishing) return toast('Wait for the current save to finish, then try again.', { kind: 'err' });
  btn.disabled = true; btn.textContent = 'Loading…';
  try {
    const raw = await fetch(`https://api.github.com/repos/${REPO}/contents/${SEASON_FILE}?ref=${sha}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store',
    });
    if (!raw.ok) throw new Error(`GitHub: couldn't read that version (${raw.status})`);
    const old = await raw.json();
    // Say what restoring would actually change, before doing it.
    const what = describeChanges(draft, old, []);
    if (!await ask({ title: `Restore the version from ${when}?`, text: 'The league goes back exactly as it was then, including match files, and is published straight away. You can undo this by restoring the version above it.',
      html: `<p><b>Compared with now:</b> ${esc(what === 'saved' ? 'no differences in fixtures, teams or players' : what)}.</p>`, ok: 'Restore', danger: true })) {
      btn.disabled = false; btn.textContent = 'Restore';
      return;
    }
    btn.textContent = 'Restoring…';
    // Bring back any match files that have been deleted since.
    const wanted = [...new Set((old.fixtures || []).map(f => f.file).filter(Boolean))];
    if (wanted.length) {
      const now = new Set((await gh(`/repos/${REPO}/git/trees/${BRANCH}?recursive=1`)).tree.map(x => x.path));
      const missing = wanted.filter(path => !now.has(path));
      if (missing.length) {
        const then = new Map((await gh(`/repos/${REPO}/git/trees/${sha}?recursive=1`)).tree.map(x => [x.path, x.sha]));
        let n = 0;
        for (const path of missing) {
          btn.textContent = `Restoring files ${++n}/${missing.length}…`;
          if (!then.has(path)) continue;
          const b = await gh(`/repos/${REPO}/git/blobs/${then.get(path)}`);
          const blob = new Blob([unb64(b.content.replace(/\n/g, ''))], { type: 'application/gzip' });
          uploads.set(path, blob); localFiles.set(path, blob);
        }
      }
    }
    old.updated = draft.updated;
    draft = old;
    nextMessage = `Edit mode: restore the version from ${when}`;
    historyList = null;
    toast(`Restored the version from ${when}. Publishing…`, { kind: 'ok' });
    go('fixtures', 'list');
    autoBlocked = false; publish();   // a restore is deliberate: publish it now
  } catch (e) {
    toast(`Couldn't restore: ${e.message}`, { kind: 'err' });
    btn.disabled = false; btn.textContent = 'Restore';
  }
}

// What changed between two versions, in words, for the commit message and history list.
let nextMessage = null;
function describeChanges(a, b, files) {
  const parts = [];
  const diff = (key, id, label) => {
    const A = new Map((a[key] || []).map(x => [id(x), JSON.stringify(x)])), B = new Map((b[key] || []).map(x => [id(x), JSON.stringify(x)]));
    let add = 0, chg = 0, rem = 0;
    for (const [k, v] of B) if (!A.has(k)) add++; else if (A.get(k) !== v) chg++;
    for (const k of A.keys()) if (!B.has(k)) rem++;
    const say = (n, verb) => n && parts.push(`${n} ${label}${n > 1 ? 's' : ''} ${verb}`);
    say(add, 'added'); say(chg, 'edited'); say(rem, 'removed');
  };
  diff('fixtures', f => f.id, 'fixture');
  diff('teams', t => t.code, 'team');
  diff('players', pl => pl.id, 'player');
  if (['season', 'live_minutes', 'notice', 'points', 'manager_relay'].some(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]))) parts.push('settings changed');
  if (JSON.stringify(a.managers || {}) !== JSON.stringify(b.managers || {})) parts.push('manager logins updated');
  if (JSON.stringify(a.press_questions || []) !== JSON.stringify(b.press_questions || [])) parts.push('press questions updated');
  const sentNow = (b.news || []).filter(n => n.status === 'live' && (a.news || []).find(o => o.id === n.id)?.status !== 'live').length;
  if (sentNow) parts.push(`${sentNow} news post${sentNow > 1 ? 's' : ''} sent`);
  else if (JSON.stringify(a.news || []) !== JSON.stringify(b.news || [])) parts.push('news updated');
  if (JSON.stringify(a.news_templates || []) !== JSON.stringify(b.news_templates || [])) parts.push('news templates updated');
  const logos = files.filter(([path]) => path.startsWith('assets/teams/')).length;
  if (logos) parts.push(`${logos} logo${logos > 1 ? 's' : ''} uploaded`);
  const images = files.filter(([path]) => path.startsWith('assets/news/')).length;
  if (images) parts.push(`${images} news image${images > 1 ? 's' : ''} uploaded`);
  return parts.join(', ') || 'saved';
}

// Teams and players that appear in a match file but not yet in the season are added.
function ensureTeams(d) {
  for (const side of ['home', 'away']) {
    const t = d.teams[side];
    if (!draft.teams.some(x => x.code === t.code)) draft.teams.push({ code: t.code, name: t.name, manager: '', colour: t.colour });
  }
  draft.players = draft.players || [];
  for (const p of d.players) {
    if (draft.players.some(x => String(x.id) === String(p.id))) continue;
    const a = p.attributes || {};
    const off = Math.round(((a.finishing ?? 50) + (a.dribbling ?? 50) + (a.passing ?? 50)) / 30);
    const dfn = p.position === 'GK' ? Math.round((a.reflexes ?? 50) / 10) : Math.round(((a.tackling ?? 50) + (a.marking ?? 50)) / 20);
    draft.players.push({ id: p.id, name: p.name, team: p.team, position: p.position, offense: Math.max(1, Math.min(10, off)), defense: Math.max(1, Math.min(10, dfn)) });
  }
}

// ---------- Teams ----------

const openTeams = new Set();   // which team dropdowns are expanded

function teamsTab(body) {
  // Don't add empty fields just by looking: that would count as a change and publish.
  const qsFor = code => (draft.press_questions || []).filter(q => q.team === code);
  const card = (t, i) => {
    const m = (draft.managers || {})[t.code], players = (draft.players || []).filter(p => p.team === t.code).length;
    return `<details class="team-card" data-i="${i}" data-code="${esc(t.code)}"${openTeams.has(t.code) ? ' open' : ''}>
      <summary><span class="sw" style="background:${esc(safeColour(t.colour))}"></span><b>${esc(t.name)}</b><span class="ed-hint">${esc(t.code)} · ${esc(t.manager || 'no manager')} · ${players} players</span>
        ${t.withdrawn ? '<span class="login-chip">Withdrawn</span>' : `<span class="login-chip ${m ? 'on' : ''}">${m ? 'Login set' : 'No login'}</span>`}</summary>
      <div class="team-body">
        <div class="ed-sub"><h4>Club</h4>
          <div class="ed-row"><label class="ed-field" style="flex:1 1 180px">Team name<input class="ed-input" data-k="name" value="${esc(t.name)}"></label>
            <label class="ed-field" style="flex:1 1 160px">Manager<input class="ed-input" data-k="manager" value="${esc(t.manager || '')}"></label>
            <label class="ed-field">Colour<input type="color" data-k="colour" value="${esc(safeColour(t.colour).length === 7 ? t.colour : '#475569')}"></label>
            <label class="ed-btn small" style="align-self:end">Upload logo<input type="file" accept="image/png" data-logo="" hidden></label></div></div>
        <div class="ed-sub"><h4>Manager login</h4>
          <p class="ed-hint">${m ? `Set ${esc(new Date(m.set || Date.now()).toLocaleDateString('en-AU'))}. Enter a new email and PIN to change it.` : 'Give this team’s manager an email and PIN.'} They sign in at <a href="manager.html" target="_blank">the Manager Hub</a>. Only a scrambled check is stored on the site, never the email or PIN, so note them down before you send them.</p>
          <div class="ed-row"><label class="ed-field" style="flex:1 1 200px">Manager’s email<input class="ed-input" type="email" data-login="email" placeholder="name@example.com" autocomplete="off"></label>
            <label class="ed-field" style="width:120px">PIN<input class="ed-input" data-login="pin" inputmode="numeric" placeholder="4+ digits" autocomplete="off"></label>
            <button class="ed-btn small primary" style="align-self:end" data-act="set-login">${m ? 'Change login' : 'Set login'}</button>
            ${m ? '<button class="ed-btn small danger" style="align-self:end" data-act="clear-login">Remove login</button>' : ''}</div></div>
        <div class="ed-sub"><h4>Questions for this manager</h4>
          ${qsFor(t.code).map(q => `<div class="q-row"><span>${esc(q.q)}</span><button class="ed-btn small danger" data-act="del-q" data-q="${esc(q.id)}" aria-label="Delete question">✕</button></div>`).join('') || '<p class="ed-hint">None yet. The media also asks automatic questions after each match.</p>'}
          <div class="ed-row"><input class="ed-input" style="flex:1 1 240px" data-newq placeholder="Ask ${esc(t.manager || 'the manager')} a question…" maxlength="300"><button class="ed-btn small" data-act="add-q">Ask</button></div></div>
        <div class="ed-row" style="justify-content:flex-end">${t.withdrawn ? `<button class="ed-btn small" data-act="reinstate">Reinstate ${esc(t.name)}</button>`
          : `<button class="ed-btn small danger" data-act="remove-team">${draft.fixtures.some(f => f.result && (f.home === t.code || f.away === t.code)) ? 'Withdraw' : 'Remove'} ${esc(t.name)}</button>`}</div>
      </div></details>`;
  };
  body.innerHTML = `<div class="ed-section"><h3>Teams</h3>
    <p class="ed-hint">Open a team to edit it. Logos are optional PNGs (square, transparent background works best).</p>
    <div class="team-cards">${draft.teams.map(card).join('') || '<p class="ed-hint">No teams yet.</p>'}</div>
    <details class="team-card"${openTeams.has('__new') ? ' open' : ''} data-code="__new"><summary><b>+ Add a team</b></summary><div class="team-body">
      <div class="ed-row"><label class="ed-field" style="width:90px">Code<input class="ed-input" id="nt-code" maxlength="4" placeholder="ABC"></label>
        <label class="ed-field" style="flex:1 1 160px">Team name<input class="ed-input" id="nt-name"></label>
        <label class="ed-field" style="flex:1 1 140px">Manager<input class="ed-input" id="nt-man"></label>
        <label class="ed-field">Colour<input type="color" id="nt-col" value="#1e88e5"></label>
        <button class="ed-btn small primary" style="align-self:end" id="nt-add">Add team</button></div></div></details></div>
    <div class="ed-section"><h3>Ask every manager</h3>
      ${qsFor('all').map(q => `<div class="q-row"><span>${esc(q.q)}</span><button class="ed-btn small danger" data-act="del-q" data-q="${esc(q.id)}" aria-label="Delete question">✕</button></div>`).join('')}
      <div class="ed-row"><input class="ed-input" style="flex:1 1 240px" id="q-all" placeholder="A question for all managers…" maxlength="300"><button class="ed-btn small" data-act="add-q-all">Ask all</button></div></div>`;

  body.querySelectorAll('details.team-card').forEach(d => d.addEventListener('toggle', () => { d.open ? openTeams.add(d.dataset.code) : openTeams.delete(d.dataset.code); }));
  body.onchange = e => {
    const cardEl = e.target.closest('.team-card[data-i]');
    if (!cardEl) return;
    const t = draft.teams[+cardEl.dataset.i];
    if (e.target.dataset.k) {
      const k = e.target.dataset.k, v = e.target.value.trim();
      if (k === 'name' && !v) { e.target.value = t.name; return toast('A team needs a name.', { kind: 'err' }); }
      t[k] = k === 'colour' ? e.target.value : v;
      // Update the card header in place (no re-render), so Tab carries on to the next field.
      cardEl.querySelector('summary b').textContent = t.name;
      cardEl.querySelector('summary .sw').style.background = safeColour(t.colour);
      touch();
    }
    if (e.target.dataset.logo !== undefined && e.target.files[0]) {
      uploads.set(`assets/teams/${t.code.toLowerCase()}${e.target.dataset.logo}.png`, e.target.files[0]);
      toast(`New logo for ${t.name} will publish in a moment.`, { kind: 'ok' });
      refresh();
    }
  };
  body.onclick = async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const cardEl = b.closest('.team-card[data-i]'), t = cardEl ? draft.teams[+cardEl.dataset.i] : null;
    const act = b.dataset.act;
    if (act === 'set-login') {
      const email = cardEl.querySelector('[data-login="email"]').value.trim(), pin = cardEl.querySelector('[data-login="pin"]').value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { cardEl.querySelector('[data-login="email"]').focus(); return toast('Enter the manager’s email address.', { kind: 'err' }); }
      if (!/^\d{4,}$/.test(pin)) { cardEl.querySelector('[data-login="pin"]').focus(); return toast('Use a PIN of at least 4 digits.', { kind: 'err' }); }
      b.disabled = true; b.textContent = 'Saving…';
      const salt = newSalt();
      draft.managers = { ...(draft.managers || {}), [t.code]: { salt, hash: await loginHash(salt, email, pin), set: new Date().toISOString().slice(0, 10) } };
      refresh();
      const note = `vLeague Manager Hub login for ${t.name}\nSign in at: ${new URL('manager.html', location.href).href}\nEmail: ${email}\nPIN: ${pin}`;
      await info({ title: `Login saved for ${t.name}`, copy: note,
        html: `<p>Send these to the manager now. They <b>can't be viewed again</b>: only a scrambled check is stored.</p><pre class="ed-copy">${esc(note)}</pre>` });
    }
    if (act === 'clear-login') change(`Manager login for ${t.name} removed.`, () => { delete draft.managers[t.code]; if (!Object.keys(draft.managers).length) delete draft.managers; });
    if (act === 'add-q' || act === 'add-q-all') {
      const input = act === 'add-q' ? cardEl.querySelector('[data-newq]') : body.querySelector('#q-all'), q = input.value.trim();
      if (!q) return input.focus();
      (draft.press_questions ||= []).push({ id: Date.now().toString(36), team: act === 'add-q' ? t.code : 'all', q, date: new Date().toISOString().slice(0, 10) });
      refresh();
    }
    if (act === 'del-q') change('Question deleted.', () => { draft.press_questions = (draft.press_questions || []).filter(q => q.id !== b.dataset.q); });
    if (act === 'remove-team') {
      const mine = f => f.home === t.code || f.away === t.code;
      const played = draft.fixtures.filter(f => mine(f) && f.result), unplayed = draft.fixtures.filter(f => mine(f) && !f.result);
      const players = (draft.players || []).filter(p => p.team === t.code).length;
      if (played.length) {
        // A team with results is withdrawn, not deleted: its played matches stay in the record.
        if (!await ask({ title: `Withdraw ${t.name}?`, text: `Its ${played.length} played match${played.length > 1 ? 'es stay' : ' stays'} in the results and table. ${unplayed.length ? `Its ${unplayed.length} unplayed fixture${unplayed.length > 1 ? 's are' : ' is'} removed. ` : ''}Its manager login is removed. Players stay listed with the team.`, ok: 'Withdraw team', danger: true })) return;
        change(`${t.name} withdrawn.`, () => {
          t.withdrawn = true;
          draft.fixtures = draft.fixtures.filter(f => !(mine(f) && !f.result));
          if (draft.managers) { delete draft.managers[t.code]; if (!Object.keys(draft.managers).length) delete draft.managers; }
        });
        return;
      }
      const also = [players && `${players} player${players > 1 ? 's' : ''}`, unplayed.length && `${unplayed.length} fixture${unplayed.length > 1 ? 's' : ''}`].filter(Boolean);
      change(`${t.name} removed${also.length ? `, with its ${also.join(' and ')}` : ''}.`, () => {
        draft.teams = draft.teams.filter(x => x !== t);
        draft.players = (draft.players || []).filter(p => p.team !== t.code);
        draft.fixtures = draft.fixtures.filter(f => !mine(f));
        if (draft.managers) { delete draft.managers[t.code]; if (!Object.keys(draft.managers).length) delete draft.managers; }
        if (draft.press_questions) draft.press_questions = draft.press_questions.filter(q => q.team !== t.code);
      });
    }
    if (act === 'reinstate') change(`${t.name} reinstated.`, () => { delete t.withdrawn; });
  };
  body.querySelector('#nt-add').onclick = () => {
    const code = body.querySelector('#nt-code').value.trim().toUpperCase(), name = body.querySelector('#nt-name').value.trim();
    if (!/^[A-Z0-9]{2,4}$/.test(code)) return toast('Use a 2-4 letter team code.', { kind: 'err' });
    if (draft.teams.some(t => t.code === code)) return toast('That code is already used.', { kind: 'err' });
    if (!name) return toast('Enter the team name.', { kind: 'err' });
    draft.teams.push({ code, name, manager: body.querySelector('#nt-man').value.trim(), colour: body.querySelector('#nt-col').value });
    openTeams.delete('__new'); openTeams.add(code);
    refresh();
  };
}

// ---------- Settings ----------

function settingsTab(body) {
  const p = draft.points || { win: 3, draw: 1, loss: 0 };
  body.innerHTML = `<div class="ed-section"><h3>Season</h3>
    <div class="ed-row"><label class="ed-field" style="width:110px">Season number<input class="ed-input" type="number" min="1" data-k="season" value="${esc(draft.season)}"></label>
      <label class="ed-field" style="width:160px">Live broadcast (minutes)<input class="ed-input" type="number" min="1" max="120" data-k="live_minutes" value="${esc(draft.live_minutes || 10)}"></label></div>
    <p class="ed-hint">How long a match takes to play out live on the site after kick-off (the full 90 minutes is sped up to fit).</p>
    <label class="ed-field">Banner message (leave empty to hide)<input class="ed-input" data-k="notice" value="${esc(draft.notice || '')}"></label>
    <div class="ed-row"><label class="ed-field" style="width:80px">Win pts<input class="ed-input" type="number" data-p="win" value="${p.win}"></label>
      <label class="ed-field" style="width:80px">Draw pts<input class="ed-input" type="number" data-p="draw" value="${p.draw}"></label>
      <label class="ed-field" style="width:80px">Loss pts<input class="ed-input" type="number" data-p="loss" value="${p.loss}"></label></div></div>
    <div class="ed-section"><h3>Manager Hub</h3>
      <p class="ed-hint">Managers save their tactics and press answers through a small Google script on your account, so no key is ever on the website. Follow <a href="https://github.com/${REPO}/blob/${BRANCH}/docs/MANAGER_SETUP.md" target="_blank">the 5-minute setup guide</a>, then paste the web app link here. Set each manager's login in <b>Teams</b>.</p>
      <label class="ed-field">Manager relay link<input class="ed-input" data-k="manager_relay" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(draft.manager_relay || '')}"></label>
      <div class="ed-row"><button class="ed-btn small" id="relay-test">Test the link</button><span class="ed-hint" id="relay-status"></span></div></div>
    <div class="ed-section"><h3>This device</h3><p class="ed-hint">The access token is stored encrypted in this browser. Forget it if this isn't your device.</p>
      <div class="ed-row"><button class="ed-btn danger" id="forget">Forget this device</button></div></div>`;
  body.onchange = e => {
    const k = e.target.dataset.k, pk = e.target.dataset.p, el = e.target;
    // Numbers must be whole and in range; an empty or bad value puts the old one back.
    const num = (old, min, max) => {
      const v = Number(el.value);
      if (el.value.trim() === '' || !Number.isInteger(v) || v < min || v > max) { el.value = old; toast(`Enter a whole number from ${min} to ${max}.`, { kind: 'err' }); return null; }
      return v;
    };
    if (k) {
      const v = el.type === 'number' ? num(draft[k] ?? (k === 'live_minutes' ? 10 : 1), 1, k === 'live_minutes' ? 120 : 99) : el.value.trim();
      if (v === null) return;
      draft[k] = v;
    }
    if (pk) {
      const pts = draft.points || { win: 3, draw: 1, loss: 0 }, v = num(pts[pk], -10, 10);
      if (v === null) return;
      draft.points = { ...pts, [pk]: v };
    }
    if (k || pk) touch();   // no re-render, so Tab moves on normally
  };
  body.querySelector('#relay-test').onclick = async () => {
    const out = body.querySelector('#relay-status');
    if (!draft.manager_relay) { out.textContent = 'Paste the link first.'; return; }
    out.textContent = 'Testing…';
    try {
      const r = await (await fetch(draft.manager_relay)).json();
      out.innerHTML = r.ok ? '<span class="ed-ok">✓ The relay is working.</span>' : `<span class="ed-err">${esc(r.error || 'Unexpected reply')}</span>`;
    } catch { out.innerHTML = '<span class="ed-err">Couldn’t reach it. Check the link, and that the deployment is set to “Anyone”.</span>'; }
  };
  body.querySelector('#forget').onclick = async () => {
    if (!await ask({ title: 'Forget this device?', text: 'This removes the saved access token from this browser. You’ll need a GitHub token to set edit mode up again.', ok: 'Forget this device', danger: true })) return;
    localStorage.removeItem(STORE);
    lock();
  };
}

// ---------- Publish ----------
//
// Changes wait on this device until you press Publish (or Ctrl+S); then they're committed to GitHub
// in one commit, and we watch the public site until GitHub Pages is serving it. If a Pages build fails
// (it can when two saves land seconds apart) we ask GitHub to build again.

let publishing = false, autoTimer = null, autoBlocked = false; // blocked after a conflict until Publish is pressed
let liveState = '', liveMsg = '';   // '', 'saving', 'live', 'failed'

function setState(state, msg) { liveState = state; liveMsg = msg; if (panel) showState(); }
function showState() {
  const box = panel.querySelector('.ed-pending'), n = pendingCount();
  if (publishing || liveState === 'saving' || liveState === 'failed') box.innerHTML = liveMsg;
  else if (n && autoBlocked) box.innerHTML = `<span class="ed-err">${n} change${n > 1 ? 's' : ''} not published. Press Publish.</span>`;
  else if (n && holds.has('sim')) box.innerHTML = `<span class="ed-wait">${n} unpublished change${n > 1 ? 's' : ''}. Publish once the simulation finishes.</span>`;
  else if (n) box.innerHTML = `<span class="ed-wait">${n} unpublished change${n > 1 ? 's' : ''}. Press Publish to put ${n > 1 ? 'them' : 'it'} live.</span>`;
  else box.innerHTML = liveMsg || '<span class="ed-ok">✓ Everything is live</span>';
}

// Auto-publish is off: an edit only updates the "unpublished changes" note next to Publish.
function scheduleAutoPublish() {
  clearTimeout(autoTimer);
  if (panel) showState();
}

async function publish() {
  clearTimeout(autoTimer);
  if (publishing || !pendingCount()) return;
  if (holds.has('sim')) return toast('Wait for the simulation to finish, then publish.', { kind: 'info' });
  publishing = true;
  panel.querySelector('[data-publish]').disabled = true;
  const snap = structuredClone(draft), sentUploads = new Map(uploads);
  const step = t => setState('saving', `<span class="ed-wait">${esc(t)}</span>`);
  try {
    // Has someone else published since we loaded? (A newer stamp than ours means yes; an older
    // one is just GitHub briefly serving the previous version straight after our own publish.)
    step('Checking for other changes…');
    const raw = await fetch(`https://api.github.com/repos/${REPO}/contents/${SEASON_FILE}?ref=${BRANCH}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store',
    });
    if (!raw.ok) throw new Error(`GitHub: couldn't read the current league data (${raw.status})`);
    const remote = await raw.json();
    if ((remote.updated || '') > (base.updated || '') && !await ask({ title: 'The league was changed elsewhere',
      text: 'Someone published changes (from another device or github.com) since you opened edit mode. Publishing now overwrites them. To keep both, reload the page instead: your changes stay saved on this device and you’ll be offered them back.',
      ok: 'Overwrite and publish', cancel: 'Don’t publish yet', danger: true })) {
      autoBlocked = true;
      setState('failed', '<span class="ed-err">Not published: the league was changed elsewhere. Reload the page to get the latest; your changes are kept on this device.</span>');
      return;
    }
    snap.updated = draft.updated = new Date().toISOString().slice(0, 19);
    const referenced = new Set(snap.fixtures.map(f => f.file).filter(Boolean));
    const removed = base.fixtures.map(f => f.file).filter(path => path && !referenced.has(path));
    const files = [...sentUploads].filter(([path]) => !path.startsWith(MATCH_DIR) || referenced.has(path));
    files.push([SEASON_FILE, new Blob([JSON.stringify(snap)], { type: 'application/json' })]);
    const msg = nextMessage || `Edit mode: ${describeChanges(base, snap, files)}`;
    // Straight after a previous publish GitHub can briefly report the old branch tip, which makes
    // the new commit look out of date. Wait a moment and try again.
    for (let attempt = 1; ; attempt++) {
      try { await commit(files, [...new Set(removed)], msg, step); break; }
      catch (e) {
        if (attempt >= 3 || !/fast forward|\(409\)|\(422\)/i.test(e.message)) throw e;
        step('Retrying…');
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
    base = snap;
    nextMessage = null;
    historyList = null;
    for (const [path, blob] of sentUploads) if (uploads.get(path) === blob) uploads.delete(path);
    (window.hclPublished ||= new Set()).add(snap.updated);
    saveDraft();   // clears the saved copy once nothing is left unpublished
    watchLive(snap.updated);
  } catch (e) {
    setState('failed', `<span class="ed-err">Not published: ${esc(e.message)}</span>`);
    autoBlocked = true;   // no auto-retry loop; pressing Publish clears this
    toast(`Publishing failed: ${e.message}. Your changes are still here and saved on this device. Press Publish to try again.`, { kind: 'err', ms: 15000 });
  } finally {
    publishing = false;
    refresh();
    scheduleAutoPublish(); // anything edited while we were saving
  }
}

// Poll the public site until it serves this version. A newer publish replaces an older watch.
async function watchLive(stamp) {
  watchLive.current = stamp;
  const started = Date.now();
  let rebuilt = false;
  setState('saving', '<span class="ed-wait">Saved. Waiting for the live site to update…</span>');
  while (watchLive.current === stamp) {
    await new Promise(r => setTimeout(r, 6000));
    if (watchLive.current !== stamp) return;
    try {
      const live = await (await fetch(`${SEASON_FILE}?t=${Date.now()}`, { cache: 'no-store' })).json();
      if ((live.updated || '') >= stamp) { setState('live', '<span class="ed-ok">✓ Live on the site. Everyone viewing gets a refresh prompt.</span>'); return; }
    } catch { /* keep waiting */ }
    const waited = Date.now() - started;
    if (!rebuilt && waited > 150000) {
      rebuilt = true;
      setState('saving', '<span class="ed-wait">The live site is slow to update. Asking GitHub to rebuild it…</span>');
      try { await gh(`/repos/${REPO}/pages/builds`, { method: 'POST' }); } catch { /* token may not allow it; keep waiting */ }
    }
    if (waited > 360000) {
      setState('failed', '<span class="ed-err">⚠ Saved to GitHub, but the live site hasn’t updated yet.</span> <button class="ed-btn small" data-recheck>Check again</button>');
      panel?.querySelector('[data-recheck]')?.addEventListener('click', () => watchLive(stamp));
      return;
    }
  }
}

// ---------- Boot ----------

function boot() {
  if (!root()) return;   // edit mode only runs on admin.html
  try { token = sessionStorage.getItem(SESSION); } catch { token = null; }
  readHash();
  window.addEventListener('hashchange', () => { readHash(); refresh(); });
  // An open ⋯ menu closes when you click anywhere else or press Escape.
  const closeMenus = keep => document.querySelectorAll('.ed-menu[open]').forEach(d => { if (d !== keep) d.open = false; });
  document.addEventListener('click', e => closeMenus(e.target.closest('.ed-menu')));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMenus(null);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && panel) { e.preventDefault(); autoBlocked = false; publish(); }
  });
  if (token) startEditing(); else showLocked();
  window.addEventListener('beforeunload', e => { if (pendingCount() || publishing) { e.preventDefault(); e.returnValue = ''; } });
}
boot();
