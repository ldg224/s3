// League edit mode.
//
// Security model: the site is public and static, so a PIN on its own can't protect anything.
// Edits are saved by committing to the GitHub repo with a GitHub access token. The token is
// entered once per device, encrypted with the PIN (AES-GCM, PBKDF2-derived key) and kept only
// in that browser. The PIN unlocks it; without the token nobody can change the site.

import { REPO, BRANCH, SEASON_FILE, MATCH_DIR } from './config.js';
import { loadSeason, setSeason, summariseMatch, parseMatchBlob, localFiles, kickoff } from './data.js';
import { esc, safeColour } from './ui.js';

const STORE = 'hcl-s3-admin';
const SESSION = 'hcl-s3-admin-token';
const enc = new TextEncoder(), dec = new TextDecoder();

let token = null;
let base = null;          // season as last loaded/published
let draft = null;         // working copy
let uploads = new Map();  // repo path -> Blob to commit
let tab = 'fixtures';

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
let toggle, panel;

function pendingCount() {
  if (!draft || !base) return 0;
  return uploads.size + (JSON.stringify(strip(draft)) !== JSON.stringify(strip(base)) ? 1 : 0);
}
const strip = s => ({ ...s, updated: null });

function updateToggle() {
  const n = pendingCount();
  toggle.classList.toggle('on', !!token);
  toggle.innerHTML = token ? `✎ Edit mode${n ? ` <span class="badge">${n}</span>` : ''}` : '🔒 Edit';
}

function modal(html) {
  const m = el(`<div class="ed-modal" role="dialog" aria-modal="true"><div class="ed-box">${html}</div></div>`);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
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
  m.querySelector('[data-reset]').onclick = () => { if (confirm('Forget the saved access token on this device and set up again?')) { localStorage.removeItem(STORE); m.remove(); openSetup(); } };
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
    base = structuredClone(await loadSeason());
    draft = structuredClone(base);
  }
  updateToggle();
  openPanel();
}

function openPanel() {
  if (!panel) {
    panel = el(`<aside class="ed-panel" aria-label="League editor">
      <div class="ed-head"><h2>League editor</h2><span class="ed-pending"></span>
        <button class="ed-btn primary" data-publish>Publish</button><button class="ed-btn" data-discard>Discard</button>
        <button class="ed-btn" data-lock title="Lock edit mode">Lock</button><button class="ed-btn" data-close aria-label="Close">✕</button></div>
      <div class="ed-tabs" role="tablist"></div>
      <div class="ed-body"></div></aside>`);
    document.body.appendChild(panel);
    panel.querySelector('[data-close]').onclick = () => panel.classList.remove('open');
    panel.querySelector('[data-lock]').onclick = lock;
    panel.querySelector('[data-discard]').onclick = () => { if (confirm('Discard all unpublished changes?')) { draft = structuredClone(base); uploads.clear(); refresh(); } };
    panel.querySelector('[data-publish]').onclick = publish;
  }
  requestAnimationFrame(() => panel.classList.add('open'));
  refresh();
}

function lock() {
  if (pendingCount() && !confirm('You have unpublished changes. Lock anyway? They will be lost.')) return;
  token = null;
  try { sessionStorage.removeItem(SESSION); } catch { /* storage unavailable */ }
  panel?.classList.remove('open');
  draft = base = null; uploads.clear();
  updateToggle();
}

function refresh() {
  const n = pendingCount();
  panel.querySelector('.ed-pending').textContent = n ? `${n} unpublished change${n > 1 ? 's' : ''}` : 'No changes';
  panel.querySelector('[data-publish]').disabled = !n;
  const tabs = [['fixtures', 'Fixtures'], ['upload', 'Upload match'], ['teams', 'Teams'], ['settings', 'Settings']];
  const tb = panel.querySelector('.ed-tabs');
  tb.innerHTML = tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('');
  tb.onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; refresh(); } };
  const body = panel.querySelector('.ed-body');
  body.innerHTML = '';
  body.onchange = null;
  ({ fixtures: fixturesTab, upload: uploadTab, teams: teamsTab, settings: settingsTab })[tab](body);
  updateToggle();
  // Show edits on the page immediately (only when something actually changed).
  const sig = JSON.stringify(draft) + uploads.size;
  if (sig !== refresh.sig) {
    refresh.sig = sig;
    setSeason(draft);
    window.dispatchEvent(new CustomEvent('season-changed', { detail: draft }));
  }
}

// ---------- Fixtures ----------

const teamOpts = (sel) => draft.teams.map(t => `<option value="${esc(t.code)}"${t.code === sel ? ' selected' : ''}>${esc(t.code)}</option>`).join('');
const newId = (week, h, a) => {
  let id = `w${week}-${h}-${a}`.toLowerCase(), i = 2;
  while (draft.fixtures.some(f => f.id === id)) id = `w${week}-${h}-${a}-${i++}`.toLowerCase();
  return id;
};

function fixturesTab(body) {
  const fx = [...draft.fixtures].sort((a, b) => (a.week ?? 999) - (b.week ?? 999) || (kickoff(a) ?? 0) - (kickoff(b) ?? 0));
  const rows = fx.map(f => `<tr data-id="${esc(f.id)}">
    <td><input class="ed-input w" type="number" min="1" data-k="week" value="${esc(f.week ?? '')}" aria-label="Week"></td>
    <td><input class="ed-input" type="date" data-k="date" value="${esc(f.date || '')}" aria-label="Date"></td>
    <td><input class="ed-input" type="time" data-k="time" value="${esc(f.time || '')}" aria-label="Kick-off time"></td>
    <td><select class="ed-select" data-k="home" aria-label="Home">${teamOpts(f.home)}</select></td>
    <td><select class="ed-select" data-k="away" aria-label="Away">${teamOpts(f.away)}</select></td>
    <td class="fx-result ${f.result ? '' : 'none'}">${f.result ? `${f.result.home}-${f.result.away}${uploads.has(f.file) ? ' •' : ''}` : 'No file'}</td>
    <td><div class="ed-row" style="flex-wrap:nowrap">
      <button class="ed-btn small" data-act="upload">${f.result ? 'Replace' : 'Upload'}</button>
      ${f.result ? '<button class="ed-btn small danger" data-act="clear" title="Remove the match file">Remove file</button>' : ''}
      <button class="ed-btn small danger" data-act="delete" aria-label="Delete fixture">✕</button></div></td></tr>`).join('');
  body.innerHTML = `<div class="ed-section"><h3>Fixtures</h3>
    <p class="ed-hint">Set each match's week, date and kick-off time. Results stay hidden until kick-off, then the match plays out live over ${esc(draft.live_minutes || 10)} minutes (change this in Settings).</p>
    <div style="overflow-x:auto"><table class="fx-table"><thead><tr><th>Wk</th><th>Date</th><th>Kick-off</th><th>Home</th><th>Away</th><th>Result</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="ed-hint">No fixtures yet.</td></tr>'}
    <tr class="fx-new"><td><input class="ed-input w" type="number" min="1" id="nf-week" value="${esc(fx.length ? fx[fx.length - 1].week : 1)}" aria-label="New fixture week"></td>
      <td><input class="ed-input" type="date" id="nf-date" aria-label="New fixture date"></td><td><input class="ed-input" type="time" id="nf-time" value="12:00" aria-label="New fixture time"></td>
      <td><select class="ed-select" id="nf-home">${teamOpts(draft.teams[0]?.code)}</select></td><td><select class="ed-select" id="nf-away">${teamOpts(draft.teams[1]?.code)}</select></td>
      <td colspan="2"><button class="ed-btn small primary" id="nf-add">+ Add fixture</button></td></tr></tbody></table></div></div>`;

  body.querySelector('tbody').addEventListener('change', e => {
    const tr = e.target.closest('tr[data-id]'), k = e.target.dataset.k;
    if (!tr || !k) return;
    const f = draft.fixtures.find(x => x.id === tr.dataset.id);
    let v = e.target.value;
    if (k === 'week') v = v === '' ? null : +v;
    if ((k === 'home' || k === 'away') && f.result && !confirm('This fixture already has a match file for different teams. Change the team anyway?')) { refresh(); return; }
    f[k] = v || (k === 'week' ? null : '');
    refresh();
  });
  body.querySelector('tbody').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const f = draft.fixtures.find(x => x.id === b.closest('tr').dataset.id);
    if (b.dataset.act === 'delete' && confirm(`Delete ${f.home} v ${f.away} (week ${f.week})?`)) {
      if (f.file) uploads.delete(f.file);
      draft.fixtures = draft.fixtures.filter(x => x !== f);
      refresh();
    }
    if (b.dataset.act === 'clear' && confirm('Remove the match file from this fixture?')) {
      uploads.delete(f.file); f.result = null; delete f.file; refresh();
    }
    if (b.dataset.act === 'upload') { tab = 'upload'; uploadTarget = f.id; refresh(); }
  });
  body.querySelector('#nf-add').onclick = () => {
    const week = +body.querySelector('#nf-week').value || 1, h = body.querySelector('#nf-home').value, a = body.querySelector('#nf-away').value;
    if (h === a) return alert('Pick two different teams.');
    draft.fixtures.push({ id: newId(week, h, a), week, date: body.querySelector('#nf-date').value, time: body.querySelector('#nf-time').value, home: h, away: a, result: null });
    refresh();
  };
}

// ---------- Upload ----------

let uploadTarget = null;
let pendingFile = null;   // { data, blob }

function uploadTab(body) {
  body.innerHTML = `<div class="ed-section"><h3>Upload a match file</h3>
    <p class="ed-hint">Use a match file from the HCL simulator (.json or .json.gz). It's attached to a fixture; the result stays hidden until that fixture's kick-off time.</p>
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
    <p class="ed-hint">Changes are saved to the site when you press <b>Publish</b>.</p>`;
  const sel = body.querySelector('#u-target');
  if (!target) sel.value = '__new';
  sel.onchange = () => { uploadTarget = sel.value === '__new' ? '__new' : sel.value; renderUpload(body); };
  body.querySelector('#u-cancel').onclick = () => { pendingFile = null; uploadTarget = null; refresh(); };
  body.querySelector('#u-save').onclick = async () => {
    const week = +body.querySelector('#u-week').value || 1, date = body.querySelector('#u-date').value, time = body.querySelector('#u-time').value;
    if (!date) return alert('Set the kick-off date. The result is hidden until then.');
    ensureTeams(d);
    let f = sel.value === '__new' ? null : draft.fixtures.find(x => x.id === sel.value);
    if (f && (f.home !== h.code || f.away !== a.code) && !confirm('The teams in this file don\'t match that fixture. Attach anyway (the fixture will be updated to these teams)?')) return;
    if (!f) { f = { id: newId(week, h.code, a.code), result: null }; draft.fixtures.push(f); }
    Object.assign(f, { week, date, time, home: h.code, away: a.code });
    f.file = `${MATCH_DIR}/${f.id}.json.gz`;
    f.result = summariseMatch(d);
    const gz = await new Response(new Blob([JSON.stringify(d)]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
    uploads.set(f.file, gz);
    localFiles.set(f.file, gz);
    pendingFile = null; uploadTarget = null; tab = 'fixtures';
    refresh();
  };
}

// Teams and players that appear in a match file but not yet in the season are added.
function ensureTeams(d) {
  for (const side of ['home', 'away']) {
    const t = d.teams[side];
    if (!draft.teams.some(x => x.code === t.code)) draft.teams.push({ code: t.code, name: t.name, manager: '', colour: t.colour });
  }
  draft.players = draft.players || [];
  for (const p of d.players) {
    if (draft.players.some(x => x.id === p.id)) continue;
    const a = p.attributes || {};
    const off = Math.round(((a.finishing ?? 50) + (a.dribbling ?? 50) + (a.passing ?? 50)) / 30);
    const dfn = p.position === 'GK' ? Math.round((a.reflexes ?? 50) / 10) : Math.round(((a.tackling ?? 50) + (a.marking ?? 50)) / 20);
    draft.players.push({ id: p.id, name: p.name, team: p.team, position: p.position, offense: Math.max(1, Math.min(10, off)), defense: Math.max(1, Math.min(10, dfn)) });
  }
}

// ---------- Teams ----------

function teamsTab(body) {
  body.innerHTML = `<div class="ed-section"><h3>Teams</h3>
    <p class="ed-hint">Logos are optional PNGs (square, transparent background works best). The watermark logo is used in the faint background art.</p>
    ${draft.teams.map((t, i) => `<div class="team-edit" data-i="${i}">
      <input class="ed-input" value="${esc(t.code)}" disabled aria-label="Code">
      <input class="ed-input" data-k="name" value="${esc(t.name)}" aria-label="Team name">
      <input class="ed-input" data-k="manager" value="${esc(t.manager || '')}" placeholder="Manager" aria-label="Manager">
      <input type="color" data-k="colour" value="${esc(safeColour(t.colour).length === 7 ? t.colour : '#475569')}" aria-label="Colour">
      <div class="ed-row" style="flex-wrap:nowrap">
        <label class="ed-btn small">Logo<input type="file" accept="image/png" data-logo="" hidden></label>
        <label class="ed-btn small">Watermark<input type="file" accept="image/png" data-logo="-alt" hidden></label></div></div>`).join('')}
    <h3 style="margin-top:8px">Add a team</h3>
    <div class="team-edit"><input class="ed-input" id="nt-code" maxlength="4" placeholder="CODE"><input class="ed-input" id="nt-name" placeholder="Team name">
      <input class="ed-input" id="nt-man" placeholder="Manager"><input type="color" id="nt-col" value="#34d399"><button class="ed-btn small primary" id="nt-add">+ Add</button></div></div>`;
  body.onchange = e => {
    const row = e.target.closest('.team-edit[data-i]');
    if (!row) return;
    const t = draft.teams[+row.dataset.i];
    if (e.target.dataset.k) { t[e.target.dataset.k] = e.target.value; refresh(); }
    if (e.target.dataset.logo !== undefined && e.target.files[0]) {
      uploads.set(`assets/teams/${t.code.toLowerCase()}${e.target.dataset.logo}.png`, e.target.files[0]);
      refresh();
    }
  };
  body.querySelector('#nt-add').onclick = () => {
    const code = body.querySelector('#nt-code').value.trim().toUpperCase(), name = body.querySelector('#nt-name').value.trim();
    if (!/^[A-Z0-9]{2,4}$/.test(code)) return alert('Use a 2-4 letter team code.');
    if (draft.teams.some(t => t.code === code)) return alert('That code is already used.');
    if (!name) return alert('Enter the team name.');
    draft.teams.push({ code, name, manager: body.querySelector('#nt-man').value.trim(), colour: body.querySelector('#nt-col').value });
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
    <div class="ed-section"><h3>This device</h3><p class="ed-hint">The access token is stored encrypted in this browser. Forget it if this isn't your device.</p>
      <div class="ed-row"><button class="ed-btn danger" id="forget">Forget this device</button></div></div>`;
  body.onchange = e => {
    const k = e.target.dataset.k, pk = e.target.dataset.p;
    if (k) draft[k] = e.target.type === 'number' ? +e.target.value : e.target.value;
    if (pk) { draft.points = { ...(draft.points || { win: 3, draw: 1, loss: 0 }), [pk]: +e.target.value }; }
    if (k || pk) refresh();
  };
  body.querySelector('#forget').onclick = () => {
    if (!confirm('Remove the saved access token from this browser? You will need to set edit mode up again.')) return;
    localStorage.removeItem(STORE);
    lock();
  };
}

// ---------- Publish ----------

async function publish() {
  const btn = panel.querySelector('[data-publish]');
  const status = panel.querySelector('.ed-pending');
  btn.disabled = true;
  try {
    // Has someone else published since we loaded?
    status.textContent = 'Checking for other changes…';
    const raw = await fetch(`https://api.github.com/repos/${REPO}/contents/${SEASON_FILE}?ref=${BRANCH}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store',
    });
    if (!raw.ok) throw new Error(`GitHub: couldn't read the current league data (${raw.status})`);
    const remoteSeason = await raw.json();
    if (remoteSeason.updated !== base.updated && !confirm('The league data was changed somewhere else since you opened edit mode. Publishing will overwrite those changes. Continue?')) {
      btn.disabled = false; refresh(); return;
    }
    draft.updated = new Date().toISOString().slice(0, 19);
    const referenced = new Set(draft.fixtures.map(f => f.file).filter(Boolean));
    const removed = base.fixtures.map(f => f.file).filter(p => p && !referenced.has(p));
    const files = [...uploads].filter(([path]) => !path.startsWith(MATCH_DIR) || referenced.has(path));
    files.push([SEASON_FILE, new Blob([JSON.stringify(draft)], { type: 'application/json' })]);
    const n = draft.fixtures.length;
    const msg = `Edit mode: update league (${n} fixtures, ${files.length - 1} file${files.length === 2 ? '' : 's'})`;
    // Straight after a previous publish GitHub can briefly report the old branch tip, which makes
    // the new commit look out of date. Wait a moment and try again.
    for (let attempt = 1; ; attempt++) {
      try { await commit(files, [...new Set(removed)], msg, s => { status.textContent = s; }); break; }
      catch (e) {
        if (attempt >= 3 || !/fast forward|\(409\)|\(422\)/i.test(e.message)) throw e;
        status.textContent = 'Retrying…';
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
    base = structuredClone(draft);
    uploads.clear();
    refresh();
    status.innerHTML = '<span class="ed-ok">Published. The live site updates in about a minute.</span>';
  } catch (e) {
    status.textContent = '';
    alert(`Publishing failed: ${e.message}`);
    btn.disabled = false;
  }
}

// ---------- Boot ----------

function boot() {
  toggle = el('<button class="edit-toggle" type="button" aria-label="League edit mode"></button>');
  document.body.appendChild(toggle);
  try { token = sessionStorage.getItem(SESSION); } catch { token = null; }
  updateToggle();
  toggle.onclick = () => (token ? startEditing() : openUnlock());
  window.addEventListener('beforeunload', e => { if (pendingCount()) { e.preventDefault(); e.returnValue = ''; } });
}
boot();
