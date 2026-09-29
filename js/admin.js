// League edit mode.
//
// Security model: the site is public and static, so a PIN on its own can't protect anything.
// Edits are saved by committing to the GitHub repo with a GitHub access token. The token is
// entered once per device, encrypted with the PIN (AES-GCM, PBKDF2-derived key) and kept only
// in that browser. The PIN unlocks it; without the token nobody can change the site.

import { REPO, BRANCH, SEASON_FILE, MATCH_DIR } from './config.js';
import { loadSeason, setSeason, summariseMatch, parseMatchBlob, localFiles, kickoff, loadMatchFile } from './data.js';
import { esc, safeColour } from './ui.js';
import { loginHash, newSalt } from './managers.js';

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
  if (!toggle) return;
  const n = pendingCount();
  toggle.classList.toggle('on', !!token);
  const dot = { saving: '⏳', live: '✓', failed: '⚠' }[liveState] || '';
  toggle.innerHTML = token ? `✎ Edit mode${n ? ` <span class="badge">${n}</span>` : dot ? ` <span class="state">${dot}</span>` : ''}` : 'Editor login';
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
    base = structuredClone(await loadSeason(true)); // fresh copy, not the one the page loaded earlier
    draft = structuredClone(base);
  }
  updateToggle();
  openPanel();
}

function openPanel() {
  if (!panel) {
    panel = el(`<section class="ed-panel full" aria-label="League editor">
      <div class="ed-head"><h2>League admin</h2><span class="ed-pending"></span>
        <button class="ed-btn primary" data-publish>Publish now</button><button class="ed-btn" data-discard>Discard</button>
        <a class="ed-btn" href="index.html" target="_blank" rel="noopener">View site ↗</a>
        <button class="ed-btn" data-lock title="Lock edit mode">Lock</button></div>
      <nav class="ed-tabs" role="tablist" aria-label="Admin sections"></nav>
      <div class="ed-body"></div></section>`);
    root().replaceChildren(panel);
    panel.querySelector('[data-lock]').onclick = lock;
    panel.querySelector('[data-discard]').onclick = () => { if (confirm('Discard all unpublished changes?')) { draft = structuredClone(base); uploads.clear(); refresh(); } };
    panel.querySelector('[data-publish]').onclick = () => { autoBlocked = false; publish(); };
  }
  refresh();
}

function lock() {
  if (pendingCount() && !confirm('Some changes haven’t been published yet. Lock anyway? They will be lost.')) return;
  token = null;
  try { sessionStorage.removeItem(SESSION); } catch { /* storage unavailable */ }
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
  const n = pendingCount();
  showState();
  panel.querySelector('[data-publish]').disabled = !n || publishing;
  const tabs = [['fixtures', 'Fixtures'], ['generate', 'Generate'], ['upload', 'Upload match'], ['teams', 'Teams'], ['players', 'Players'], ['league', 'League'], ['history', 'History'], ['settings', 'Settings']];
  const tb = panel.querySelector('.ed-tabs');
  tb.innerHTML = tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('');
  tb.onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; refresh(); } };
  const body = panel.querySelector('.ed-body');
  body.innerHTML = '';
  body.onchange = null;
  body.onclick = null;
  body.oninput = null;
  ({ fixtures: fixturesTab, generate: generateTab, upload: uploadTab, teams: teamsTab, players: playersTab, league: leagueTabHost, history: historyTab, settings: settingsTab })[tab](body);
  updateToggle();
  // Show edits on the page immediately (only when something actually changed).
  const sig = JSON.stringify(draft) + uploads.size;
  if (sig !== refresh.sig) {
    refresh.sig = sig;
    setSeason(draft);
    window.dispatchEvent(new CustomEvent('season-changed', { detail: draft }));
    scheduleAutoPublish();
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
      ${f.result ? '<button class="ed-btn small primary" data-act="video" title="Export a highlights video">🎬 Video</button>' : '<button class="ed-btn small primary" data-act="sim" title="Play this match in the simulator">⚡ Simulate</button>'}
      <button class="ed-btn small" data-act="upload">${f.result ? 'Replace' : 'Upload'}</button>
      ${f.result ? '<button class="ed-btn small danger" data-act="clear" title="Remove the match file">Remove file</button>' : ''}
      <button class="ed-btn small danger" data-act="delete" aria-label="Delete fixture">✕</button></div></td></tr>`).join('');
  body.innerHTML = `<div class="ed-section"><h3>Fixtures</h3>
    <p class="ed-hint">Set each match's week, date and kick-off time. Results stay hidden until kick-off, then the match plays out live over ${esc(draft.live_minutes || 10)} minutes (change this in Settings). Use <b>Generate</b> to build a whole season at once.</p>
    ${unplayed().length ? `<div class="ed-row"><button class="ed-btn primary" id="sim-all">⚡ Simulate all ${unplayed().length} fixtures without a result</button><span class="ed-hint">Results stay hidden until each kick-off.</span></div>` : ''}
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
    if (b.dataset.act === 'delete' && confirm(`Delete ${f.home || 'TBC'} v ${f.away || 'TBC'} (week ${f.week})?`)) {
      if (f.file) uploads.delete(f.file);
      draft.fixtures = draft.fixtures.filter(x => x !== f);
      refresh();
    }
    if (b.dataset.act === 'clear' && confirm('Remove the match file from this fixture?')) {
      uploads.delete(f.file); f.result = null; delete f.file; refresh();
    }
    if (b.dataset.act === 'upload') { tab = 'upload'; uploadTarget = f.id; refresh(); }
    if (b.dataset.act === 'video') openVideoExport(f);
    if (b.dataset.act === 'sim') simulateMany([f]);
  });
  body.querySelector('#sim-all')?.addEventListener('click', () => {
    const list = unplayed();
    if (confirm(`Simulate ${list.length} fixture${list.length > 1 ? 's' : ''}? This can take a while; keep this tab open.`)) simulateMany(list);
  });
  body.querySelector('#nf-add').onclick = () => {
    const week = +body.querySelector('#nf-week').value || 1, h = body.querySelector('#nf-home').value, a = body.querySelector('#nf-away').value;
    if (h === a) return alert('Pick two different teams.');
    draft.fixtures.push({ id: newId(week, h, a), week, date: body.querySelector('#nf-date').value, time: body.querySelector('#nf-time').value, home: h, away: a, result: null });
    refresh();
  };
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
      const mins = Math.floor(r.duration / 60), secs = Math.round(r.duration % 60);
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
    <p class="ed-hint">Saved to the live site automatically a few seconds after you add it.</p>`;
  const sel = body.querySelector('#u-target');
  if (!target) sel.value = '__new';
  sel.onchange = () => { uploadTarget = sel.value === '__new' ? '__new' : sel.value; renderUpload(body); };
  body.querySelector('#u-cancel').onclick = () => { pendingFile = null; uploadTarget = null; refresh(); };
  body.querySelector('#u-save').onclick = async () => {
    const week = +body.querySelector('#u-week').value || 1, date = body.querySelector('#u-date').value, time = body.querySelector('#u-time').value;
    if (!date) return alert('Set the kick-off date. The result is hidden until then.');
    let f = sel.value === '__new' ? null : draft.fixtures.find(x => x.id === sel.value);
    if (f && (f.home !== h.code || f.away !== a.code) && !confirm('The teams in this file don\'t match that fixture. Attach anyway (the fixture will be updated to these teams)?')) return;
    if (!f) { f = { id: newId(week, h.code, a.code), result: null }; draft.fixtures.push(f); }
    Object.assign(f, { week, date, time, home: h.code, away: a.code });
    await attachMatch(f, d);
    pendingFile = null; uploadTarget = null; tab = 'fixtures';
    refresh();
  };
}

// Attach a match (uploaded or simulated) to a fixture: result summary in the season, full file uploaded.
async function attachMatch(f, d) {
  ensureTeams(d);
  f.file = `${MATCH_DIR}/${f.id}.json.gz`;
  f.result = summariseMatch(d);
  try { (await import('./league.js')).applyKnockoutRules?.(draft, f, d); } catch { /* league rules not installed */ }
  const gz = await new Response(new Blob([JSON.stringify(d)]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  uploads.set(f.file, gz);
  localFiles.set(f.file, gz);
}

// ---------- Simulate ----------
// Runs the HCL match simulator in this browser (js/simulate.js) and attaches the result.

const unplayed = () => draft.fixtures.filter(f => !f.result && f.home && f.away).sort((a, b) => (a.week ?? 999) - (b.week ?? 999) || (kickoff(a) ?? 0) - (kickoff(b) ?? 0));
let holdAuto = false;   // pause auto-publish during a batch, then publish once

async function simulateMany(list) {
  const m = modal(`<h2>⚡ Simulate</h2><p class="sim-what"></p>
    <div class="vid-bar"><span></span></div><p class="vid-status">Starting the simulator…</p><div class="ed-err"></div>
    <div class="ed-row"><button class="ed-btn" data-close>Cancel</button></div>`);
  const what = m.querySelector('.sim-what'), bar = m.querySelector('.vid-bar span'), status = m.querySelector('.vid-status'), err = m.querySelector('.ed-err'), close = m.querySelector('[data-close]');
  let cancelled = false, running = true, done = 0;
  const skipped = [];
  m.addEventListener('click', e => { if (running && e.target === m) e.stopImmediatePropagation(); }, true);
  close.onclick = () => { if (running) { cancelled = true; close.textContent = 'Stopping after this match…'; } else m.remove(); };
  holdAuto = true;
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
    status.innerHTML = `<span class="ed-ok">${done} match${done === 1 ? '' : 'es'} simulated${cancelled ? ' (stopped early)' : ''}.${done ? ' Saving to the live site…' : ''}</span>`;
    if (skipped.length) err.innerHTML = `${skipped.length} skipped:<br>${skipped.map(esc).join('<br>')}`;
  } catch (e) {
    err.textContent = `${done ? `${done} simulated, then: ` : ''}${e.message}`;
  } finally {
    running = false; holdAuto = false; close.textContent = 'Close';
    refresh();
    scheduleAutoPublish();
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
  if (!gen.teams) gen.teams = new Set(draft.teams.map(t => t.code));
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
    if (plan.removed && !confirm(`This removes ${plan.removed} fixture${plan.removed > 1 ? 's' : ''} without results. Continue?`)) return;
    if (gen.mode === 'replace') draft.fixtures = draft.fixtures.filter(f => f.result);
    for (const f of plan.fixtures) draft.fixtures.push({ id: newId(f.week, f.home, f.away), ...f, result: null });
    tab = 'fixtures';
    refresh();
  };
  preview();
}

// ---------- League (finals, suspensions, adjustments, rescheduling): js/admin-league.js ----------

let leagueMod;
function leagueTabHost(body) {
  const ctx = { get draft() { return draft; }, refresh, esc, teamOpts };
  if (leagueMod) return leagueMod.leagueTab(body, ctx);
  body.innerHTML = '<div class="ed-section"><p class="ed-hint">Loading…</p></div>';
  import('./admin-league.js')
    .then(m => { leagueMod = m; if (tab === 'league') refresh(); })
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
  const squad = teams.map(t => {
    const ps = draft.players.filter(p => p.team === t.code), gk = ps.filter(p => p.position === 'GK').length;
    const ok = ps.length >= 11 && gk >= 1;
    return `<span class="squad-chip ${ok ? '' : 'bad'}" title="${ok ? 'Ready to simulate' : 'Needs at least 11 players including a goalkeeper to simulate'}">${esc(t.code)} ${ps.length}${gk ? '' : ' · no GK'}</span>`;
  }).join('') + (draft.players.some(free) ? `<span class="squad-chip free">Free agents ${draft.players.filter(free).length}</span>` : '');
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
    if (k === 'name' && !v.trim()) { refresh(); return; }
    pl[k] = typeof v === 'string' ? v.trim() : v;
    refresh();
  };
  body.onclick = e => {
    const rm = e.target.closest('[data-remove-player]');
    if (rm) {
      const pl = draft.players.find(x => x.id === rm.closest('tr').dataset.pid);
      if (confirm(`Remove ${pl.name}?`)) { draft.players = draft.players.filter(x => x !== pl); refresh(); }
      return;
    }
    if (!e.target.closest('#np-add')) return;
    const name = body.querySelector('#np-name').value.trim();
    if (!name) return alert('Enter the player’s name.');
    const next = Math.max(-1, ...draft.players.map(x => parseInt(x.id, 10)).filter(Number.isFinite)) + 1;
    const clamp10 = v => Math.max(1, Math.min(10, Math.round(+v) || 5));
    draft.players.push({ id: String(next).padStart(4, '0'), name, team: body.querySelector('#np-team').value, position: body.querySelector('#np-pos').value,
      offense: clamp10(body.querySelector('#np-off').value), defense: clamp10(body.querySelector('#np-def').value) });
    refresh();
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
    <p class="ed-hint">Every saved change is listed here. Restore puts the league back exactly as it was then, including match files, and publishes it. You can undo a restore by restoring the version above it.</p>
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
  if (publishing) return alert('Wait for the current save to finish, then try again.');
  if (!confirm(`Put the league back to how it was on ${when}? Anything changed since then is replaced (you can restore it again from this list).`)) return;
  btn.disabled = true; btn.textContent = 'Restoring…';
  try {
    const raw = await fetch(`https://api.github.com/repos/${REPO}/contents/${SEASON_FILE}?ref=${sha}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store',
    });
    if (!raw.ok) throw new Error(`GitHub: couldn't read that version (${raw.status})`);
    const old = await raw.json();
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
    tab = 'fixtures';
    refresh();
  } catch (e) {
    alert(`Couldn't restore: ${e.message}`);
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
  const logos = files.filter(([path]) => path.startsWith('assets/')).length;
  if (logos) parts.push(`${logos} logo${logos > 1 ? 's' : ''} uploaded`);
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
        <span class="login-chip ${m ? 'on' : ''}">${m ? 'Login set' : 'No login'}</span></summary>
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
        <div class="ed-row" style="justify-content:flex-end"><button class="ed-btn small danger" data-act="remove-team">Remove ${esc(t.name)}</button></div>
      </div></details>`;
  };
  body.innerHTML = `<div class="ed-section"><h3>Teams</h3>
    <p class="ed-hint">Open a team to edit it. Logos are optional PNGs (square, transparent background works best).</p>
    <div class="team-cards">${draft.teams.map(card).join('') || '<p class="ed-hint">No teams yet.</p>'}</div>
    <details class="team-card"${openTeams.has('__new') ? ' open' : ''} data-code="__new"><summary><b>+ Add a team</b></summary><div class="team-body">
      <div class="ed-row"><label class="ed-field" style="width:90px">Code<input class="ed-input" id="nt-code" maxlength="4" placeholder="ABC"></label>
        <label class="ed-field" style="flex:1 1 160px">Team name<input class="ed-input" id="nt-name"></label>
        <label class="ed-field" style="flex:1 1 140px">Manager<input class="ed-input" id="nt-man"></label>
        <label class="ed-field">Colour<input type="color" id="nt-col" value="#34d399"></label>
        <button class="ed-btn small primary" style="align-self:end" id="nt-add">Add team</button></div></div></details></div>
    <div class="ed-section"><h3>Ask every manager</h3>
      ${qsFor('all').map(q => `<div class="q-row"><span>${esc(q.q)}</span><button class="ed-btn small danger" data-act="del-q" data-q="${esc(q.id)}" aria-label="Delete question">✕</button></div>`).join('')}
      <div class="ed-row"><input class="ed-input" style="flex:1 1 240px" id="q-all" placeholder="A question for all managers…" maxlength="300"><button class="ed-btn small" data-act="add-q-all">Ask all</button></div></div>`;

  body.querySelectorAll('details.team-card').forEach(d => d.addEventListener('toggle', () => { d.open ? openTeams.add(d.dataset.code) : openTeams.delete(d.dataset.code); }));
  body.onchange = e => {
    const cardEl = e.target.closest('.team-card[data-i]');
    if (!cardEl) return;
    const t = draft.teams[+cardEl.dataset.i];
    if (e.target.dataset.k) { t[e.target.dataset.k] = e.target.value; refresh(); }
    if (e.target.dataset.logo !== undefined && e.target.files[0]) {
      uploads.set(`assets/teams/${t.code.toLowerCase()}${e.target.dataset.logo}.png`, e.target.files[0]);
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
      if (!/^\S+@\S+\.\S+$/.test(email)) return alert('Enter the manager’s email address.');
      if (!/^\d{4,}$/.test(pin)) return alert('Use a PIN of at least 4 digits.');
      b.disabled = true; b.textContent = 'Saving…';
      const salt = newSalt();
      draft.managers = { ...(draft.managers || {}), [t.code]: { salt, hash: await loginHash(salt, email, pin), set: new Date().toISOString().slice(0, 10) } };
      alert(`Login saved for ${t.name}.\n\nEmail: ${email}\nPIN: ${pin}\n\nSend these to the manager. They can't be viewed again.`);
      refresh();
    }
    if (act === 'clear-login' && confirm(`Remove the manager login for ${t.name}? They won't be able to sign in until you set a new one.`)) { delete draft.managers[t.code]; if (!Object.keys(draft.managers).length) delete draft.managers; refresh(); }
    if (act === 'add-q' || act === 'add-q-all') {
      const input = act === 'add-q' ? cardEl.querySelector('[data-newq]') : body.querySelector('#q-all'), q = input.value.trim();
      if (!q) return input.focus();
      (draft.press_questions ||= []).push({ id: Date.now().toString(36), team: act === 'add-q' ? t.code : 'all', q, date: new Date().toISOString().slice(0, 10) });
      refresh();
    }
    if (act === 'del-q') { draft.press_questions = (draft.press_questions || []).filter(q => q.id !== b.dataset.q); refresh(); }
    if (act === 'remove-team') {
      const players = (draft.players || []).filter(p => p.team === t.code).length;
      const fixtures = draft.fixtures.filter(f => f.home === t.code || f.away === t.code).length;
      const also = [players && `${players} player${players > 1 ? 's' : ''}`, fixtures && `${fixtures} fixture${fixtures > 1 ? 's' : ''}`].filter(Boolean);
      if (!confirm(`Remove ${t.name}?${also.length ? ` This also removes its ${also.join(' and ')}.` : ''}`)) return;
      draft.teams = draft.teams.filter(x => x !== t);
      draft.players = (draft.players || []).filter(p => p.team !== t.code);
      draft.fixtures = draft.fixtures.filter(f => f.home !== t.code && f.away !== t.code);
      if (draft.managers) delete draft.managers[t.code];
      if (draft.press_questions) draft.press_questions = draft.press_questions.filter(q => q.team !== t.code);
      refresh();
    }
  };
  body.querySelector('#nt-add').onclick = () => {
    const code = body.querySelector('#nt-code').value.trim().toUpperCase(), name = body.querySelector('#nt-name').value.trim();
    if (!/^[A-Z0-9]{2,4}$/.test(code)) return alert('Use a 2-4 letter team code.');
    if (draft.teams.some(t => t.code === code)) return alert('That code is already used.');
    if (!name) return alert('Enter the team name.');
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
    const k = e.target.dataset.k, pk = e.target.dataset.p;
    if (k) draft[k] = e.target.type === 'number' ? +e.target.value : e.target.value;
    if (pk) { draft.points = { ...(draft.points || { win: 3, draw: 1, loss: 0 }), [pk]: +e.target.value }; }
    if (k || pk) refresh();
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
  body.querySelector('#forget').onclick = () => {
    if (!confirm('Remove the saved access token from this browser? You will need to set edit mode up again.')) return;
    localStorage.removeItem(STORE);
    lock();
  };
}

// ---------- Publish ----------
//
// Every change goes live on its own: a few seconds after the last edit it's committed to GitHub,
// then we watch the public site until GitHub Pages is serving it. If a Pages build fails
// (it can when two saves land seconds apart) we ask GitHub to build again.

const AUTO_DELAY = 4000;
let publishing = false, autoTimer = null, autoBlocked = false; // blocked after a conflict until 'Publish now'
let liveState = '', liveMsg = '';   // '', 'saving', 'live', 'failed'

function setState(state, msg) { liveState = state; liveMsg = msg; if (panel) showState(); updateToggle(); }
function showState() {
  const box = panel.querySelector('.ed-pending'), n = pendingCount();
  if (publishing || liveState === 'saving' || liveState === 'failed') box.innerHTML = liveMsg;
  else if (n) box.innerHTML = `<span class="ed-wait">${n} change${n > 1 ? 's' : ''}, publishing automatically…</span>`;
  else box.innerHTML = liveMsg || '<span class="ed-ok">✓ Everything is live</span>';
}

function scheduleAutoPublish() {
  clearTimeout(autoTimer);
  if (!token || !pendingCount() || autoBlocked || holdAuto) return;
  autoTimer = setTimeout(() => publish(), AUTO_DELAY);
  if (panel) showState();
}

async function publish() {
  clearTimeout(autoTimer);
  if (publishing || !pendingCount()) return;
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
    if ((remote.updated || '') > (base.updated || '') && !confirm('The league data was changed somewhere else since you opened edit mode. Publishing will overwrite those changes. Continue?')) {
      autoBlocked = true;
      setState('failed', '<span class="ed-err">Not published: the league was changed elsewhere. Reload the page to get the latest.</span>');
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
    watchLive(snap.updated);
  } catch (e) {
    setState('failed', `<span class="ed-err">Not published: ${esc(e.message)}</span>`);
    alert(`Publishing failed: ${e.message}\n\nYour changes are still here. Press "Publish now" to try again.`);
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
  if (token) startEditing(); else showLocked();
  window.addEventListener('beforeunload', e => { if (pendingCount() || publishing) { e.preventDefault(); e.returnValue = ''; } });
}
boot();
