// Edit mode "News" tab: write Discohook-style posts with live blocks and forms, send them to the
// manager portals, and track who has read, voted and submitted. Format: docs/NEWS.md.
// admin.js calls newsTab(body, ctx) on every render; ctx = { draft (getter), refresh, touch, esc, uploads, readRepo, change }.
// Typing only updates the post and the preview; structural edits call ctx.refresh().
// Drafts never go into season.json: they live on this device (posts in localStorage, their images in
// IndexedDB) until Send, because the repo is public. Sent posts live in season.json as before.
// The post renderer is js/news.js, shared with the manager portal and the public site.

import { kickoff, teamMap } from './data.js';
import { logo, parseStamp } from './ui.js';
import { toast, ask, askText } from './admin-ui.js';

let N = null;                 // js/news.js once loaded
let sel = null;               // selected post id (null = list)
let view = 'edit';            // 'edit' | 'responses'
let pane = 'edit';            // narrow screens show the editor or the preview: 'edit' | 'preview'
let previewMode = 'preview';  // 'preview' (portal look) | 'public'
let previewTeam = null;
let respTeam = null;          // team whose answers are open in Responses
const open = new Set();       // expanded editor cards, by key
let files = null, filesAt = null, filesErr = '', filesLoading = false;   // team code -> team file (straight from the repo)
const fileErrs = {};          // team code -> why its file couldn't be read
const blobUrls = new Map();   // repo path -> object URL (uploads not on the site yet, answer images)
let autoTimer = null;         // refreshes Responses every minute while it's open

const stamp = () => new Date().toISOString().slice(0, 19);   // UTC, like season.updated
const uid = p => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const clone = o => structuredClone(o);
const when = s => { const d = parseStamp(s); return d ? d.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''; };
const dueDate = p => (p.due?.date ? kickoff(p.due) : null);
const tpls = S => S.news_templates || [];
const DAY = 864e5;

// ---------- Drafts on this device ----------

const LS_KEY = 'hcl-s3-news-drafts';
let drafts = null;            // draft posts (status 'draft'), newest last
const draftFiles = new Map(); // repo path -> Blob, images added to drafts (IndexedDB copy)
let filesReady = false;

function loadDrafts() {
  try { drafts = JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { drafts = []; }
}
function saveDrafts() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(drafts)); }
  catch (e) { toast(`Couldn't save drafts on this device: ${e.message}`, { kind: 'err' }); }
}
const posts = S => [...(drafts || []), ...(S.news || []).filter(p => p.status !== 'draft')];

let dbp = null;
const db = () => (dbp ||= new Promise((res, rej) => {
  const r = indexedDB.open('hcl-s3-news', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('files');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
}));
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('files', mode), req = fn(tx.objectStore('files'));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}
// Every repo path a post refers to (images are plain strings such as assets/news/….png).
function pathsIn(o, out = new Set()) {
  if (typeof o === 'string') { if (draftFiles.has(o)) out.add(o); }
  else if (o && typeof o === 'object') for (const v of Object.values(o)) pathsIn(v, out);
  return out;
}
// Load draft images once, and drop any that no draft uses any more.
async function loadDraftFiles(ctx) {
  try {
    const keys = await idb('readonly', st => st.getAllKeys()), vals = await idb('readonly', st => st.getAll());
    keys.forEach((k, i) => draftFiles.set(k, vals[i]));
    const used = pathsIn(drafts);
    const gone = keys.filter(k => !used.has(k));
    if (gone.length) { gone.forEach(k => draftFiles.delete(k)); await idb('readwrite', st => gone.forEach(k => st.delete(k))); }
  } catch { /* no IndexedDB (private window): draft images last until the page closes */ }
  filesReady = true;
  ctx.refresh();
}
function putDraftFile(path, blob) {
  draftFiles.set(path, blob);
  idb('readwrite', st => st.put(blob, path)).catch(() => toast('Couldn’t keep that image on this device; it lasts until you close the page.', { kind: 'err' }));
}
function dropDraftFiles(paths) {
  const used = pathsIn(drafts), gone = [...paths].filter(k => !used.has(k));
  gone.forEach(k => draftFiles.delete(k));
  if (gone.length) idb('readwrite', st => gone.forEach(k => st.delete(k))).catch(() => {});
}

// Drafts made before drafts moved to the device are still in season.json: bring them here.
function adoptOldDrafts(S) {
  const old = (S.news || []).filter(p => p.status === 'draft');
  if (!old.length) return;
  for (const p of old) if (!drafts.some(d => d.id === p.id)) drafts.push(p);
  S.news = S.news.filter(p => p.status !== 'draft');
  saveDrafts();
  toast(`${old.length} draft${old.length > 1 ? 's' : ''} moved to this device; they're no longer in the public league data.`, { kind: 'info', ms: 9000 });
}

// ---------- Question and block types ----------

const QUESTION_TYPES = [['short', 'Short answer'], ['long', 'Paragraph'], ['number', 'Number'], ['choice', 'Multiple choice'], ['multi', 'Checkboxes'],
  ['dropdown', 'Dropdown'], ['checkbox', 'Yes / no tick'], ['colour', 'Colour'], ['image', 'Image upload'], ['date', 'Date'], ['player', 'Player from their squad']];
const TEAM_FIELDS = [['', 'Not linked'], ['team.name', 'Team name'], ['team.manager', 'Manager name'], ['team.colour', 'Main colour'],
  ['team.colour2', 'Second colour'], ['team.logo', 'Team logo'], ['team.logo_alt', 'Watermark logo']];
const MAP_TYPES = { 'team.name': ['short'], 'team.manager': ['short'], 'team.colour': ['colour'], 'team.colour2': ['colour'], 'team.logo': ['image'], 'team.logo_alt': ['image'] };
const OPTION_TYPES = new Set(['choice', 'multi', 'dropdown']);
const BLOCKS = [['embed', 'Embed'], ['table', 'League table'], ['fixtures', 'Fixtures / results'], ['team', 'Team spotlight'], ['poll', 'Poll']];

// ---------- New posts and templates ----------

const embed = (o = {}) => ({ type: 'embed', colour: '#1e88e5', author: { name: 'vLeague', icon: 'assets/league/logo.png', url: '' }, title: '', url: '', description: '',
  fields: [], thumbnail: '', image: '', footer: { text: 'vLeague', icon: '' }, timestamp: true, buttons: [], ...o });
const block = type => ({
  embed: () => embed(),
  table: () => ({ type: 'table', title: 'League table', rows: 0 }),
  fixtures: () => ({ type: 'fixtures', week: 'next', title: '' }),
  team: S => ({ type: 'team', team: S.teams[0]?.code || '', title: '' }),
  poll: () => ({ type: 'poll', id: uid('p'), question: 'Which kick-off time suits your team best?', options: ['12:00 pm', '4:00 pm', '6:00 pm'], results: 'after_vote' }),
})[type];
const question = (o = {}) => ({ id: uid('q'), type: 'short', label: '', help: '', required: false, options: [], min: null, max: null, maxlen: null, map: null, ...o });
const inDays = n => new Date(Date.now() + n * DAY).toLocaleDateString('en-CA');

const PRESETS = {
  announcement: { name: 'Announcement', post: () => ({ blocks: [embed({ title: 'League announcement', description: 'Write your announcement here.' })] }) },
  registration: {
    name: 'Team registration form',
    post: () => ({
      visibility: 'managers', ack: false,
      due: { date: inDays(7), time: '18:00' },
      blocks: [embed({ colour: '#1e88e5', title: 'Season 1 team registration',
        description: 'Hi **{manager}**, please confirm {team}’s details for the new season by **{due}**.\n\nAnything you change here (name, colours, logo) is updated once the league admin approves it.' })],
      form: { kind: 'registration', intro: '', submit: 'Submit registration', edit_after_submit: true, review: true, questions: [
        question({ type: 'short', label: 'Team name', required: true, maxlen: 40, map: 'team.name' }),
        question({ type: 'short', label: 'Manager name', required: true, maxlen: 40, map: 'team.manager' }),
        question({ type: 'colour', label: 'Main team colour', required: true, map: 'team.colour' }),
        question({ type: 'colour', label: 'Second team colour', map: 'team.colour2' }),
        question({ type: 'image', label: 'Team logo', help: 'Square PNG with a transparent background works best (at least 256 × 256).', map: 'team.logo' }),
        question({ type: 'short', label: 'Discord username', help: 'So we can reach you about league matters.', maxlen: 40 }),
        question({ type: 'long', label: 'Anything else we should know?', maxlen: 1000 }),
      ] },
    }),
  },
  matchday: { name: 'Matchday preview', post: () => ({ visibility: 'public', blocks: [embed({ colour: '#42a5f5', title: 'Matchday preview', description: 'This week’s fixtures. Good luck to every team!' }), block('fixtures')()] }) },
  table: { name: 'Table update', post: () => ({ visibility: 'public', blocks: [embed({ colour: '#64b5f6', title: 'Where the table stands', description: '' }), block('table')()] }) },
  poll: { name: 'Poll', post: () => ({ blocks: [embed({ colour: '#1565c0', title: 'Have your say', description: 'One vote per team. Votes are final.' }), block('poll')()] }) },
  form: { name: 'Custom form', post: () => ({ blocks: [embed({ title: 'Form title', description: 'Tell managers what this is for.' })],
    form: { kind: 'custom', intro: '', submit: 'Submit', edit_after_submit: true, review: false, questions: [question({ label: 'Your question', required: true })] } }) },
  blank: { name: 'Blank post', post: () => ({ blocks: [] }) },
};

function newPost(S, from) {
  return {
    id: uid('n'), status: 'draft', sent: null, updated: stamp(), pinned: false, visibility: 'managers', audience: 'all',
    due: null, ack: false, blocks: [], form: null, reviews: {}, ...clone(from),
  };
}
// A saved template has fresh ids for its poll blocks and questions each time it's used.
function freshIds(p) {
  for (const b of p.blocks || []) if (b.type === 'poll') b.id = uid('p');
  for (const q of p.form?.questions || []) q.id = uid('q');
  return p;
}
// Templates keep the deadline as "N days after you start the post"; a copied post drops a deadline that has passed.
function fromTemplate(t) {
  const p = freshIds(clone(t.post || {}));
  if (t.due_days != null) p.due = { date: inDays(t.due_days), time: t.due_time || '18:00' };
  return p;
}
function dropPastDue(p) {
  const d = dueDate(p);
  if (d && d < new Date()) { p.due = null; return true; }
  return false;
}

// Stable keys for editor cards (blocks have no id of their own), so moving or removing one keeps the right cards open.
const keys = new WeakMap();
const keyOf = b => { if (!keys.has(b)) keys.set(b, uid('k')); return keys.get(b); };

// ---------- Paths: inputs carry data-path="blocks.0.fields.1.name" relative to the selected post ----------

function getPath(o, path) { return path.split('.').reduce((x, k) => (x == null ? x : x[k]), o); }
function setPath(o, path, v) {
  const ks = path.split('.'), last = ks.pop();
  let x = o;
  for (const [i, k] of ks.entries()) { if (x[k] == null) x[k] = /^\d+$/.test(ks[i + 1] ?? last) ? [] : {}; x = x[k]; }
  x[last] = v;
}
function readInput(el) {
  const t = el.dataset.kind;
  if (el.type === 'checkbox') return el.checked;
  if (t === 'num') return el.value === '' ? null : Number(el.value);
  if (t === 'lines') return el.value.split('\n').map(s => s.trim()).filter(Boolean);
  if (t === 'week') return el.value === 'next' || el.value === '' ? 'next' : Number(el.value);
  return el.value;
}

// ---------- Team files (read receipts, votes, answers) ----------

// Reads every team file. One team failing doesn't hide the others; it shows in that team's row.
// A failure is not retried on its own (only by ↻ Refresh or the one-minute refresh), so a network
// problem can't turn into a loop of requests.
async function loadFiles(ctx) {
  if (filesLoading) return;
  filesLoading = true; filesErr = '';
  const teams = ctx.draft.teams;
  const got = await Promise.allSettled(teams.map(async t => {
    const b = await ctx.readRepo(`data/teams/${t.code.toLowerCase()}.json`);
    return b ? JSON.parse(await b.text()) : {};
  }));
  const out = {};
  for (const k in fileErrs) delete fileErrs[k];
  got.forEach((r, i) => {
    const code = teams[i].code;
    if (r.status === 'fulfilled') out[code] = r.value;
    else { out[code] = files?.[code] || {}; fileErrs[code] = r.reason?.message || String(r.reason); }
  });
  const bad = Object.keys(fileErrs).length;
  if (bad === teams.length && teams.length) filesErr = fileErrs[teams[0].code];
  else if (bad) filesErr = `${bad} team file${bad > 1 ? 's' : ''} couldn't be read.`;
  if (!(bad === teams.length && teams.length && !files)) { files = out; filesAt = new Date(); }
  filesLoading = false;
  ctx.refresh();
}
const entry = (code, id) => files?.[code]?.news?.[id] || null;
const audienceOf = (S, p) => S.teams.filter(t => p.audience === 'all' || (Array.isArray(p.audience) && p.audience.includes(t.code)));

// Where each team is up to with a post.
function progress(S, p, code) {
  const e = entry(code, p.id), rev = p.reviews?.[code], due = dueDate(p);
  const submitted = parseStamp(e?.submitted), read = parseStamp(e?.read);
  const out = { e, rev, submitted, read, late: !!(submitted && due && submitted > due), done: true, overdue: false };
  if (p.form) out.done = !!submitted && !(rev?.status === 'rejected' && parseStamp(rev.at) > submitted);
  if (p.ack && !read) out.done = false;
  out.overdue = !out.done && p.status === 'live' && !!due && due < new Date();
  out.needsReview = !!(p.form?.review && submitted && (!rev || parseStamp(rev.at) < submitted));
  return out;
}
// Has any team read, voted or answered? null while that isn't known yet.
const anyResponse = p => (files && !filesErr ? Object.values(files).some(f => f?.news?.[p.id]) : null);
const pollVotes = (p, b) => (files ? Object.values(files).filter(f => f?.news?.[p.id]?.votes?.[b.id] != null).length : null);

// Object URLs for images that aren't served by the site yet: draft images, this session's uploads, and answer images read from the repo.
function src(ctx, path) {
  if (!path || /^https?:|^data:|^blob:/.test(path)) return path;
  if (blobUrls.has(path)) return blobUrls.get(path);
  const b = draftFiles.get(path) || ctx.uploads.get(path);
  if (b) { const u = URL.createObjectURL(b); blobUrls.set(path, u); return u; }
  return path;
}
async function fetchAnswerImage(ctx, path) {
  if (blobUrls.has(path)) return;
  const b = await ctx.readRepo(path).catch(() => null);
  if (b) { blobUrls.set(path, URL.createObjectURL(b)); ctx.refresh(); }
}

// ---------- For the edit-mode home tab ----------

// Select a post, e.g. from a Needs-attention item. view: 'edit' | 'responses'.
export function openPost(id, v = 'edit') { sel = id; view = v; respTeam = null; open.clear(); }

// Things waiting on the admin: submissions to review, overdue replies and deadlines within two days.
// Uses the team files already loaded; with ctx it starts loading them (and ctx.refresh() runs when they arrive).
export function attention(S, ctx = null) {
  if (!files) { if (ctx && !filesLoading && !filesErr) loadFiles(ctx); return []; }
  const out = [], now = new Date();
  for (const p of (S.news || []).filter(x => x.status === 'live')) {
    const aud = audienceOf(S, p), pr = aud.map(t => progress(S, p, t.code)), title = titleOf(p);
    const review = pr.filter(x => x.needsReview).length, left = pr.filter(x => !x.done).length, due = dueDate(p);
    if (review) out.push({ level: 'red', tab: 'news', post: p.id, view: 'responses', text: `${review} submission${review > 1 ? 's' : ''} to review in “${title}”.` });
    if (!(p.form || p.ack) || !due || !left) continue;
    if (due < now) out.push({ level: 'amber', tab: 'news', post: p.id, view: 'responses', text: `${left} team${left > 1 ? 's' : ''} haven't replied to “${title}” (due ${due.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}).` });
    else if (due - now < 2 * DAY) out.push({ level: 'amber', tab: 'news', post: p.id, view: 'responses', text: `“${title}” is due ${due.toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}; ${left} team${left > 1 ? 's' : ''} still to reply.` });
  }
  return out;
}

// ---------- Render ----------

export function newsTab(body, ctx) {
  const S = ctx.draft, esc = ctx.esc;
  if (!drafts) loadDrafts();
  if (!filesReady && !loadDraftFiles.started) { loadDraftFiles.started = true; loadDraftFiles(ctx); }
  adoptOldDrafts(S);
  if (!N) {
    import('./news.js').then(m => { N = m; ctx.refresh(); })
      .catch(() => { N = { missing: true }; ctx.refresh(); });
  }
  const post = posts(S).find(p => p.id === sel);
  if (sel && !post) sel = null;
  if (!previewTeam || !S.teams.some(t => t.code === previewTeam)) previewTeam = S.teams[0]?.code || null;
  if (files === null && !filesLoading && !filesErr && (S.news || []).length) loadFiles(ctx);

  // Keep focus and caret across re-renders (publishing re-renders the tab while you type).
  const a = document.activeElement, keep = a && body.contains(a) && a.dataset.path ? { path: a.dataset.path, s: a.selectionStart, e: a.selectionEnd } : null;
  body.innerHTML = post ? postView(S, post, ctx) : listView(S, ctx);
  if (keep) {
    const el = body.querySelector(`[data-path="${CSS.escape(keep.path)}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch { /* not a text input */ } }
  }
  for (const d of body.querySelectorAll('details.na-card')) d.ontoggle = () => (d.open ? open.add(d.dataset.key) : open.delete(d.dataset.key));
  for (const i of body.querySelectorAll('img.na-ans-img')) i.onerror = () => i.replaceWith(Object.assign(document.createElement('span'), { className: 'ed-hint', textContent: 'No image' }));
  body.oninput = e => onInput(e, ctx);
  body.onchange = e => onChange(e, ctx);
  body.onclick = e => onClick(e, ctx);
  body.onkeydown = e => onKey(e);
  // A finished deadline date turns on the time box and updates the card summary.
  body.onfocusout = e => { if (e.target.type === 'date' && e.target.dataset.path) setTimeout(() => ctx.refresh()); };   // after focus lands, so it's kept
  if (post && view === 'responses' && respTeam) {
    const ans = entry(respTeam, post.id)?.answers || {};
    for (const q of post.form?.questions || []) if (q.type === 'image' && ans[q.id]) fetchAnswerImage(ctx, ans[q.id]);
  }
  // Responses refresh themselves every minute while they're on screen.
  clearInterval(autoTimer); autoTimer = null;
  if (post && view === 'responses') {
    autoTimer = setInterval(() => {
      if (!document.querySelector('[data-na-responses]')) { clearInterval(autoTimer); autoTimer = null; return; }
      if (!document.hidden && !filesLoading) loadFiles(ctx);
    }, 60000);
  }
}

function chip(p) {
  const [cls, t] = { draft: ['tbc', 'Draft'], live: ['done', 'Live'], closed: ['pp', 'Closed'] }[p.status] || ['tbc', p.status];
  return `<span class="fx-chip ${cls}">${t}</span>`;
}
const titleOf = p => p.blocks?.find(b => b.type === 'embed' && b.title)?.title || p.blocks?.find(b => b.type === 'poll')?.question || (p.form ? 'Form' : 'Untitled post');

function summaryLine(S, p, esc) {
  const aud = audienceOf(S, p), bits = [];
  bits.push(p.visibility === 'public' ? 'Public' : 'Managers only');
  bits.push(p.audience === 'all' ? 'all teams' : `${aud.length} team${aud.length === 1 ? '' : 's'}`);
  if (p.form) bits.push(p.form.kind === 'registration' ? 'registration form' : 'form');
  if (p.blocks.some(b => b.type === 'poll')) bits.push('poll');
  const due = dueDate(p);
  if (due) bits.push(`due ${due.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`);
  if (p.sent) bits.push(`sent ${when(p.sent)}`);
  if (p.status !== 'draft' && files && (p.form || p.ack)) {
    const pr = aud.map(t => progress(S, p, t.code)), done = pr.filter(x => x.done).length, late = pr.filter(x => x.overdue).length, rev = pr.filter(x => x.needsReview).length;
    bits.push(`<b>${done}/${aud.length} done</b>${late ? ` · <span class="na-red">${late} overdue</span>` : ''}${rev ? ` · <span class="na-amber">${rev} to review</span>` : ''}`);
  }
  return bits.map(b => (b.startsWith('<') ? b : esc(b))).join(' · ');
}

function listView(S, ctx) {
  const esc = ctx.esc;
  const order = (a, b) => (b.pinned - a.pinned) || (b.sent || b.updated || '').localeCompare(a.sent || a.updated || '');
  const group = (status, title, hint) => {
    const list = posts(S).filter(p => p.status === status).sort(order);
    return list.length ? `<div class="ed-sub"><h4>${title} <span class="ed-hint">${hint}</span></h4><div class="na-list">${list.map(p => `
      <article class="na-item" data-id="${esc(p.id)}">
        <span class="na-bar" style="background:${esc(p.blocks.find(b => b.type === 'embed')?.colour || '#1e88e5')}"></span>
        <div class="na-item-main"><div class="na-item-top">${chip(p)}${p.pinned ? '<span class="fx-chip ready">📌 Pinned</span>' : ''}<b>${esc(titleOf(p))}</b></div>
          <div class="ed-hint">${summaryLine(S, p, esc)}</div></div>
        <div class="na-item-act"><button class="ed-btn small primary" data-act="open">${p.status === 'draft' ? 'Edit' : 'Open'}</button></div>
      </article>`).join('')}</div></div>` : '';
  };
  const tpl = [...Object.entries(PRESETS).map(([k, v]) => `<option value="preset:${k}">${esc(v.name)}</option>`),
    ...(tpls(S).length ? [`<optgroup label="Your templates">${tpls(S).map(t => `<option value="tpl:${esc(t.id)}">${esc(t.name)}</option>`).join('')}</optgroup>`] : [])].join('');
  const pending = files ? posts(S).filter(p => p.status !== 'draft').reduce((n, p) => n + audienceOf(S, p).filter(t => progress(S, p, t.code).needsReview).length, 0) : 0;
  return `<div class="ed-section">
    <div class="fx-top"><div><h3>League news</h3><p class="ed-hint">Posts appear at the top of every manager portal. Public posts also show on the site; managers-only posts show there as a teaser linking to the portal.</p></div>
      <div class="ed-row"><select class="ed-select" id="na-from" aria-label="Start from">${tpl}</select><button class="ed-btn primary" data-act="new">+ New post</button></div></div>
    ${filesErr ? `<p class="ed-err" role="alert">Couldn't load the teams' responses: ${esc(filesErr)} <button class="ed-btn small" data-act="reload">Retry</button></p>` : ''}
    ${pending ? `<p class="na-callout">📝 ${pending} submission${pending > 1 ? 's' : ''} waiting for your review. Open the post and choose <b>Responses</b>.</p>` : ''}
    ${posts(S).length ? '' : '<p class="ed-hint">No posts yet. Pick a starting point above (try <b>Team registration form</b>) and press New post.</p>'}
    ${group('draft', 'Drafts', 'saved on this device only: not published, and not on your other devices, until you send')}${group('live', 'Live', 'showing in the portals')}${group('closed', 'Closed', 'still visible; forms and polls closed')}
    ${tpls(S).length ? `<div class="ed-sub"><h4>Your templates <span class="ed-hint">saved in the league data, which is public</span></h4>${tpls(S).map(t => `<div class="q-row"><span>${esc(t.name)}</span><button class="ed-btn small danger" data-act="del-tpl" data-tpl="${esc(t.id)}">Delete</button></div>`).join('')}</div>` : ''}
  </div>`;
}

// What still stops a post from being sent; shown live next to the Send button.
function readiness(S, p, esc) {
  const problems = check(S, p);
  return problems.length
    ? `<ul class="na-ready bad">${problems.map(x => `<li>✗ ${esc(x)}</li>`).join('')}</ul>`
    : '<p class="na-ready ok">✓ Ready to send</p>';
}

function postView(S, p, ctx) {
  const esc = ctx.esc, live = p.status !== 'draft', aud = audienceOf(S, p), ready = !check(S, p).length;
  const hasPoll = p.blocks.some(b => b.type === 'poll'), responded = anyResponse(p);
  const primary = {
    draft: `<button class="ed-btn small primary" data-act="send"${ready ? '' : ' disabled'}>📣 Send to ${p.audience === 'all' ? 'all teams' : `${aud.length} team${aud.length === 1 ? '' : 's'}`}</button>`,
    live: `<button class="ed-btn small" data-act="close">Close${p.form || hasPoll ? ' form / poll' : ''}</button>`,
    closed: '<button class="ed-btn small primary" data-act="reopen">Reopen</button>',
  }[p.status] || '';
  const more = [
    '<button role="menuitem" data-act="dup">Duplicate</button>',
    '<button role="menuitem" data-act="save-tpl">Save as template</button>',
    p.status === 'live' && responded === false ? '<button role="menuitem" data-act="unsend">Back to draft</button>' : '',
    '<button role="menuitem" class="danger" data-act="delete">Delete…</button>',
  ].join('');
  const tabs = live && (p.form || p.ack || hasPoll)
    ? `<div class="fx-filters">${[['edit', 'Edit post'], ['responses', 'Responses']].map(([k, l]) => `<button class="fx-filter" data-view="${k}" aria-pressed="${view === k}">${l}</button>`).join('')}</div>` : '';
  if (!tabs) view = 'edit';
  return `<div class="ed-section na-post" data-post="${esc(p.id)}">
    <div class="na-head">${chip(p)}<h3>${esc(titleOf(p))}</h3></div>
    <div class="ed-row na-actions"><button class="ed-btn small" data-act="back">← All posts</button>${primary}
      <details class="na-more"><summary class="ed-btn small" aria-label="More actions">⋯</summary><div class="na-menu" role="menu">${more}</div></details></div>
    ${p.status === 'draft' ? `<div id="na-ready">${readiness(S, p, esc)}</div>` : ''}
    ${live ? `<p class="ed-hint">This post is live: edits go out when you press Publish. Changing questions after teams have answered can confuse them.</p>` : ''}
    ${tabs}
    ${view === 'responses' ? responsesView(S, p, ctx) : `
      <div class="fx-filters na-panes">${[['edit', 'Edit'], ['preview', 'Preview']].map(([k, l]) => `<button class="fx-filter" data-pane="${k}" aria-pressed="${pane === k}">${l}</button>`).join('')}</div>
      <div class="na-grid" data-pane="${pane}"><div class="na-editor">${settingsCard(S, p, esc)}${blocksCard(S, p, esc)}${formCard(S, p, esc)}</div>
      <aside class="na-preview">${previewPane(S, p, ctx)}</aside></div>`}
  </div>`;
}

// ---------- Editor cards ----------

const field = (label, input, cls = '') => `<label class="ed-field ${cls}">${label}${input}</label>`;
const txt = (esc, path, v, ph = '', extra = '') => `<input class="ed-input" data-path="${path}" value="${esc(v ?? '')}" placeholder="${esc(ph)}" ${extra}>`;
const area = (esc, path, v, ph = '', rows = 4) => `<textarea class="ed-input na-area" rows="${rows}" data-path="${path}" placeholder="${esc(ph)}">${esc(v ?? '')}</textarea>`;
const chk = (path, v, label) => `<label class="na-check"><input type="checkbox" data-path="${path}"${v ? ' checked' : ''}> ${label}</label>`;
const img = (esc, path, v, label) => field(label, `<span class="na-img">${txt(esc, path, v, 'https://… or upload')}<label class="ed-btn small">Upload<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-img="${path}" hidden></label>${v ? `<button class="ed-btn small" data-act="img-clear" data-path="${path}" aria-label="Remove image" title="Remove image">✕</button>` : ''}</span>`);
// A collapsible editor card. Its move / remove tools sit beside the summary, not inside it (buttons in a <summary> toggle it).
const card = (key, title, sub, inner, tools = '') => `<div class="na-cardw"><details class="na-card" data-key="${key}"${open.has(key) ? ' open' : ''}><summary><b>${title}</b><span class="ed-hint">${sub}</span></summary><div class="na-card-body">${inner}</div></details>${tools}</div>`;
const mover = (kind, i, n, what) => `<span class="na-tools">${i > 0 ? `<button class="ed-btn small" data-act="${kind}-up" data-i="${i}" aria-label="Move ${what} up" title="Move up">↑</button>` : ''}${i < n - 1 ? `<button class="ed-btn small" data-act="${kind}-down" data-i="${i}" aria-label="Move ${what} down" title="Move down">↓</button>` : ''}<button class="ed-btn small danger" data-act="${kind}-del" data-i="${i}" aria-label="Remove ${what}" title="Remove">✕</button></span>`;

function settingsCard(S, p, esc) {
  const aud = p.audience === 'all', list = Array.isArray(p.audience) ? p.audience : [];
  return card('settings', 'Who sees it and when', `${p.visibility === 'public' ? 'Public' : 'Managers only'} · ${aud ? 'all teams' : `${list.length} team${list.length === 1 ? '' : 's'}`}${p.due ? ` · due ${esc(p.due.date)} ${esc(p.due.time || '')}` : ''}`, `
    <div class="na-seg" role="radiogroup" aria-label="Visibility">
      <button role="radio" data-act="vis" data-v="public" aria-checked="${p.visibility === 'public'}" tabindex="${p.visibility === 'public' ? 0 : -1}"><b>🌐 Public</b><small>Whole post on the public site too</small></button>
      <button role="radio" data-act="vis" data-v="managers" aria-checked="${p.visibility !== 'public'}" tabindex="${p.visibility !== 'public' ? 0 : -1}"><b>🔒 Managers only</b><small>Public site shows a teaser: "View more information in your manager portal"</small></button></div>
    <div class="ed-field">Which portals
      <div class="na-teams"><label class="na-check"><input type="checkbox" data-act="aud-all"${aud ? ' checked' : ''}> All teams</label>
      ${S.teams.map(t => `<label class="na-check${aud ? ' dim' : ''}"><input type="checkbox" data-act="aud-team" data-code="${esc(t.code)}"${aud || list.includes(t.code) ? ' checked' : ''}${aud ? ' disabled' : ''}> ${esc(t.name)}</label>`).join('')}</div></div>
    <div class="na-row">${field('Deadline (optional)', `<input class="ed-input" type="date" data-path="due.date" value="${esc(p.due?.date || '')}">`)}
      ${field('Time', `<input class="ed-input" type="time" data-path="due.time" value="${esc(p.due?.time || '18:00')}"${p.due?.date ? '' : ' disabled'}>`)}</div>
    ${chk('ack', p.ack, 'Ask managers to tap <b>Got it</b> (read receipt)')}
    ${chk('pinned', p.pinned, 'Pin to the top of the news')}`);
}

function blocksCard(S, p, esc) {
  const n = p.blocks.length;
  const inner = p.blocks.map((b, i) => blockEditor(S, p, b, i, n, esc)).join('')
    + `<div class="ed-row na-add"><span class="ed-hint">Add:</span>${BLOCKS.map(([k, l]) => `<button class="ed-btn small" data-act="add-block" data-type="${k}">+ ${l}</button>`).join('')}</div>`;
  return `<div class="na-group"><h4>Post content</h4>${inner}</div>`;
}

function blockEditor(S, p, b, i, n, esc) {
  const P = `blocks.${i}`, key = keyOf(b);
  if (b.type === 'embed') {
    const fields = (b.fields || []).map((f, j) => `<div class="na-sub">
        <div class="na-row">${field('Field name', txt(esc, `${P}.fields.${j}.name`, f.name))}${chk(`${P}.fields.${j}.inline`, f.inline, 'Inline')}${mover(`field-${i}`, j, b.fields.length, 'field')}</div>
        ${field('Value', area(esc, `${P}.fields.${j}.value`, f.value, '', 2))}</div>`).join('');
    const buttons = (b.buttons || []).map((x, j) => `<div class="na-row na-sub">${field('Label', txt(esc, `${P}.buttons.${j}.label`, x.label))}${field('Link', txt(esc, `${P}.buttons.${j}.url`, x.url, 'https://… or manager.html'))}
        ${field('Style', `<select class="ed-select" data-path="${P}.buttons.${j}.style">${['primary', 'secondary', 'link'].map(s => `<option${x.style === s ? ' selected' : ''}>${s}</option>`).join('')}</select>`)}${mover(`button-${i}`, j, b.buttons.length, 'button')}</div>`).join('');
    return card(key, `Embed ${i + 1}`, esc(b.title || b.description?.slice(0, 40) || 'empty'), `
      <div class="na-row">${field('Colour', `<input type="color" class="na-colour" data-path="${P}.colour" value="${esc(b.colour || '#1e88e5')}">`, 'narrow')}${field('Author', txt(esc, `${P}.author.name`, b.author?.name, 'vLeague'))}</div>
      <div class="na-row">${img(esc, `${P}.author.icon`, b.author?.icon, 'Author icon')}${field('Author link', txt(esc, `${P}.author.url`, b.author?.url, 'https://…'))}</div>
      ${field('Title', txt(esc, `${P}.title`, b.title, 'Big bold heading'))}
      ${field('Title link', txt(esc, `${P}.url`, b.url, 'https://… (optional)'))}
      ${field('Description', area(esc, `${P}.description`, b.description, '**bold** *italic* __underline__ ~~strike~~ ||spoiler|| [link](https://…) > quote - list', 6))}
      <p class="ed-hint">Placeholders: <code>{team}</code> <code>{manager}</code> <code>{due}</code> are filled in for each team.</p>
      <div class="na-group"><h5>Fields</h5>${fields}<button class="ed-btn small" data-act="add-field" data-i="${i}">+ Field</button></div>
      <div class="na-row">${img(esc, `${P}.thumbnail`, b.thumbnail, 'Thumbnail (top right)')}${img(esc, `${P}.image`, b.image, 'Large image')}</div>
      <div class="na-row">${field('Footer', txt(esc, `${P}.footer.text`, b.footer?.text))}${img(esc, `${P}.footer.icon`, b.footer?.icon, 'Footer icon')}</div>
      ${chk(`${P}.timestamp`, b.timestamp, 'Show the send time in the footer')}
      <div class="na-group"><h5>Link buttons</h5>${buttons}<button class="ed-btn small" data-act="add-button" data-i="${i}">+ Button</button></div>`, mover('block', i, n, 'block'));
  }
  if (b.type === 'table') return card(key, 'League table', 'live, updates itself', `<div class="na-row">${field('Heading', txt(esc, `${P}.title`, b.title))}
    ${field('Teams shown', `<input class="ed-input" type="number" min="0" data-kind="num" data-path="${P}.rows" value="${esc(b.rows ?? 0)}">`, 'narrow')}</div><p class="ed-hint">0 shows every team. Columns: Pos, Team, P, GD, Pts.</p>`, mover('block', i, n, 'block'));
  if (b.type === 'fixtures') {
    const weeks = [...new Set(S.fixtures.map(f => f.week).filter(w => w != null))].sort((x, y) => x - y);
    return card(key, 'Fixtures / results', b.week === 'next' ? 'next week' : `week ${esc(b.week)}`, `<div class="na-row">${field('Heading', txt(esc, `${P}.title`, b.title, 'e.g. This week’s matches'))}
      ${field('Week', `<select class="ed-select" data-kind="week" data-path="${P}.week"><option value="next"${b.week === 'next' ? ' selected' : ''}>Next week (updates itself)</option>${weeks.map(w => `<option value="${w}"${b.week === w ? ' selected' : ''}>Week ${w}</option>`).join('')}</select>`)}</div>
      <p class="ed-hint">Shows kick-off times, then scores once each match has been played.</p>`, mover('block', i, n, 'block'));
  }
  if (b.type === 'team') return card(key, 'Team spotlight', esc(S.teams.find(t => t.code === b.team)?.name || ''), `<div class="na-row">${field('Heading', txt(esc, `${P}.title`, b.title, 'e.g. Team of the week'))}
    ${field('Team', `<select class="ed-select" data-path="${P}.team">${S.teams.map(t => `<option value="${esc(t.code)}"${b.team === t.code ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`)}</div>
    <p class="ed-hint">Logo, colours, recent form and next match.</p>`, mover('block', i, n, 'block'));
  if (b.type === 'poll') {
    // Votes are stored as the option's position, so once anyone may have voted the options can't change.
    const votes = p.status === 'draft' ? 0 : pollVotes(p, b), locked = p.status !== 'draft' && votes !== 0;
    return card(key, 'Poll', esc(b.question || 'no question yet'), `${field('Question', txt(esc, `${P}.question`, b.question))}
    ${field('Options (one per line)', `<textarea class="ed-input na-area" rows="4" data-kind="lines" data-path="${P}.options"${locked ? ' readonly aria-describedby="na-lock"' : ''}>${esc((b.options || []).join('\n'))}</textarea>`)}
    ${locked ? `<p class="ed-hint" id="na-lock">🔒 ${votes == null ? 'Checking for votes… Options stay locked until the teams’ responses load.' : `${votes} team${votes > 1 ? 's have' : ' has'} voted, so the options are locked (changing them would change what those votes mean).`}</p>` : ''}
    ${field('Managers see results', `<select class="ed-select" data-path="${P}.results">${[['after_vote', 'After they vote'], ['after_close', 'When the poll closes'], ['never', 'Never (only you)']].map(([v, l]) => `<option value="${v}"${b.results === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
    <p class="ed-hint">One vote per team, final. The public site only shows totals after you close the post.</p>`, mover('block', i, n, 'block'));
  }
  return '';
}

function formCard(S, p, esc) {
  if (!p.form) return `<div class="na-group"><h4>Form</h4><p class="ed-hint">Add a form to collect answers from every team: registrations, availability, feedback…</p>
    <div class="ed-row"><button class="ed-btn small" data-act="add-form" data-kind="custom">+ Add a form</button><button class="ed-btn small" data-act="add-form" data-kind="registration">+ Registration form</button></div></div>`;
  const f = p.form, n = f.questions.length;
  const qs = f.questions.map((q, i) => {
    const P = `form.questions.${i}`, mapOk = TEAM_FIELDS.filter(([k]) => !k || MAP_TYPES[k].includes(q.type));
    return card(`q:${q.id}`, `${i + 1}. ${esc(q.label || 'Untitled question')}`, `${esc(QUESTION_TYPES.find(([k]) => k === q.type)?.[1] || q.type)}${q.required ? ' · required' : ''}${q.map ? ` · → ${esc(TEAM_FIELDS.find(([k]) => k === q.map)?.[1])}` : ''}`, `
      <div class="na-row">${field('Question', txt(esc, `${P}.label`, q.label))}
        ${field('Type', `<select class="ed-select" data-path="${P}.type">${QUESTION_TYPES.map(([k, l]) => `<option value="${k}"${q.type === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`, 'narrow')}</div>
      ${field('Help text', txt(esc, `${P}.help`, q.help, 'Shown under the question (optional)'))}
      ${OPTION_TYPES.has(q.type) ? field('Options (one per line)', `<textarea class="ed-input na-area" rows="4" data-kind="lines" data-path="${P}.options">${esc((q.options || []).join('\n'))}</textarea>`) : ''}
      ${q.type === 'number' ? `<div class="na-row">${field('Min', `<input class="ed-input" type="number" data-kind="num" data-path="${P}.min" value="${esc(q.min ?? '')}">`, 'narrow')}${field('Max', `<input class="ed-input" type="number" data-kind="num" data-path="${P}.max" value="${esc(q.max ?? '')}">`, 'narrow')}</div>` : ''}
      ${['short', 'long'].includes(q.type) ? field('Max length', `<input class="ed-input" type="number" min="1" data-kind="num" data-path="${P}.maxlen" value="${esc(q.maxlen ?? '')}" placeholder="${q.type === 'long' ? 1500 : 200}">`, 'narrow') : ''}
      <div class="na-row">${chk(`${P}.required`, q.required, 'Required')}
        ${mapOk.length > 1 ? field('Updates the team’s', `<select class="ed-select" data-path="${P}.map">${mapOk.map(([k, l]) => `<option value="${k}"${(q.map || '') === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`, 'narrow') : ''}</div>
      ${q.map ? '<p class="ed-hint">Pre-filled with the team’s current value. Approving the submission updates the team.</p>' : ''}`, mover('q', i, n, 'question'));
  }).join('');
  return `<div class="na-group"><h4>Form <span class="ed-hint">${f.kind === 'registration' ? 'registration: changes need your approval' : 'custom'}</span></h4>
    ${field('Intro above the questions', area(esc, 'form.intro', f.intro, 'Optional', 2))}
    <div class="na-row">${field('Submit button', txt(esc, 'form.submit', f.submit, 'Submit'))}</div>
    ${chk('form.edit_after_submit', f.edit_after_submit, 'Managers can change their answers while the post is live')}
    ${f.kind === 'registration' ? '' : chk('form.review', f.review, 'I review each submission (approve / ask to redo)')}
    ${qs}
    <div class="ed-row"><button class="ed-btn small" data-act="add-q">+ Question</button><button class="ed-btn small danger" data-act="del-form">Remove form</button></div></div>`;
}

function previewPane(S, p, ctx) {
  const esc = ctx.esc;
  const head = `<div class="na-prev-head"><div class="fx-filters">${[['preview', 'Manager portal'], ['public', 'Public site']].map(([k, l]) => `<button class="fx-filter" data-pmode="${k}" aria-pressed="${previewMode === k}">${l}</button>`).join('')}</div>
    ${previewMode === 'preview' ? `<select class="ed-select" data-pteam aria-label="Preview as team">${S.teams.map(t => `<option value="${esc(t.code)}"${t.code === previewTeam ? ' selected' : ''}>As ${esc(t.name)}</option>`).join('')}</select>` : ''}</div>`;
  return `${head}<div class="na-prev-body" id="na-prev">${previewHtml(S, p, ctx)}</div>`;
}
function previewHtml(S, p, ctx) {
  if (!N) return '<p class="ed-hint">Loading preview…</p>';
  if (N.missing) return '<p class="ed-hint">The preview appears once the shared news renderer (js/news.js) is on the site.</p>';
  try {
    return N.renderPost({ ...p, sent: p.sent || stamp() }, S,
      { mode: previewMode, team: previewTeam, teamFile: files?.[previewTeam] || {}, teamFiles: files || {}, now: new Date(), src: path => src(ctx, path) });
  } catch (e) { return `<p class="ed-err">Preview failed: ${ctx.esc(e.message)}</p>`; }
}
// Typing updates the preview and the send checklist without re-rendering the editor.
function updatePreview(ctx) {
  const p = current(ctx);
  if (!p) return;
  const box = document.getElementById('na-prev');
  if (box) box.innerHTML = previewHtml(ctx.draft, p, ctx);
  const ready = document.getElementById('na-ready');
  if (ready) {
    ready.innerHTML = readiness(ctx.draft, p, ctx.esc);
    const send = document.querySelector('[data-act="send"]');
    if (send) send.disabled = check(ctx.draft, p).length > 0;
  }
}

// ---------- Responses ----------

function responsesView(S, p, ctx) {
  const esc = ctx.esc, aud = audienceOf(S, p), polls = p.blocks.filter(b => b.type === 'poll');
  const head = `<div class="ed-row" data-na-responses><button class="ed-btn small" data-act="reload">↻ Refresh responses</button>
    <span class="ed-hint">${filesLoading ? 'Loading…' : filesAt ? `Updated ${filesAt.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })} · refreshes every minute` : ''}</span>
    ${p.form ? '<button class="ed-btn small" data-act="csv">Download answers (CSV)</button>' : ''}</div>
    ${filesErr ? `<p class="ed-err" role="alert">${esc(filesErr)}</p>` : ''}`;
  if (!files) return head + (filesErr ? '' : '<p class="ed-hint">Loading the teams’ responses…</p>');
  const rows = aud.map(t => {
    const pr = progress(S, p, t.code), cells = [];
    if (p.ack) cells.push(pr.read ? `<span class="na-ok">✓ ${esc(when(pr.e.read))}</span>` : '<span class="ed-hint">Not yet</span>');
    if (p.form) {
      cells.push(pr.submitted ? `<span class="na-ok">✓ ${esc(when(pr.e.submitted))}</span>${pr.late ? ' <span class="fx-chip warn">Late</span>' : ''}` : pr.overdue ? '<span class="na-red">Overdue</span>' : '<span class="ed-hint">Not yet</span>');
      if (p.form.review) cells.push(pr.needsReview ? '<span class="fx-chip ready">To review</span>' : pr.rev?.status === 'applied' ? '<span class="fx-chip done">Approved</span>' : pr.rev?.status === 'rejected' ? '<span class="fx-chip warn">Asked to redo</span>' : '–');
    }
    for (const b of polls) { const v = pr.e?.votes?.[b.id]; cells.push(v != null ? esc(b.options[v] ?? `#${v}`) : '<span class="ed-hint">–</span>'); }
    const err = fileErrs[t.code] ? `<br><span class="na-red" title="${esc(fileErrs[t.code])}">⚠ Couldn't read this team's file</span>` : '';
    return `<tr class="${respTeam === t.code ? 'on' : ''}"><td><span class="na-teamcell">${logo(t, 22)}${esc(t.name)}</span>${err}</td>${cells.map(c => `<td>${c}</td>`).join('')}
      <td>${p.form && pr.submitted ? `<button class="ed-btn small${respTeam === t.code ? ' primary' : ''}" data-act="answers" data-code="${esc(t.code)}" aria-expanded="${respTeam === t.code}">Answers</button>` : ''}</td></tr>`;
  }).join('');
  const heads = ['Team', ...(p.ack ? ['Got it'] : []), ...(p.form ? ['Submitted'] : []), ...(p.form?.review ? ['Review'] : []), ...polls.map(b => `Vote: ${esc(b.question || 'poll')}`), ''];
  const pollHtml = polls.map(b => {
    const counts = (b.options || []).map(() => 0);
    let total = 0;
    for (const t of aud) { const v = entry(t.code, p.id)?.votes?.[b.id]; if (v != null && counts[v] != null) { counts[v]++; total++; } }
    return `<div class="ed-sub"><h4>📊 ${esc(b.question || 'Poll')} <span class="ed-hint">${total}/${aud.length} voted</span></h4>${(b.options || []).map((o, i) => {
      const pct = total ? Math.round(counts[i] / total * 100) : 0;
      return `<div class="na-bar-row"><span>${esc(o)}</span><span class="na-meter" role="img" aria-label="${pct}%"><i style="width:${pct}%"></i></span><b>${counts[i]}</b></div>`;
    }).join('')}</div>`;
  }).join('');
  return `${head}<div style="overflow-x:auto"><table class="na-table"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    ${pollHtml}${p.form && respTeam ? answersCard(S, p, respTeam, ctx) : ''}`;
}

function currentValue(S, code, map) {
  if (N?.teamValue) return N.teamValue(S, code, map);
  const t = S.teams.find(x => x.code === code) || {};
  if (map === 'team.logo') return `assets/teams/${code.toLowerCase()}.png`;
  if (map === 'team.logo_alt') return `assets/teams/${code.toLowerCase()}-alt.png`;
  return t[map?.slice(5)] ?? '';
}

function answersCard(S, p, code, ctx) {
  const esc = ctx.esc, t = S.teams.find(x => x.code === code), e = entry(code, p.id);
  if (!e?.submitted) return '';
  const pr = progress(S, p, code), ans = e.answers || {}, squad = new Map(S.players.map(pl => [String(pl.id), pl.name]));
  const show = (q, v) => {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '<span class="ed-hint">No answer</span>';
    if (q.type === 'image') return `<img class="na-ans-img" src="${esc(src(ctx, v))}" alt="Submitted ${esc(q.label)}">`;
    if (q.type === 'colour') return `<span class="na-swatch" style="background:${esc(v)}"></span> ${esc(v)}`;
    if (q.type === 'checkbox') return v ? 'Yes' : 'No';
    if (q.type === 'player') return esc(squad.get(String(v)) || v);
    if (Array.isArray(v)) return v.map(esc).join(', ');
    return esc(v).replace(/\n/g, '<br>');
  };
  const mapped = p.form.questions.some(q => q.map);
  const rows = p.form.questions.map(q => {
    const v = ans[q.id];
    const cur = q.map ? currentValue(S, code, q.map) : null;
    const same = q.map && q.type !== 'image' && String(cur ?? '') === String(v ?? '');
    return `<tr><th>${esc(q.label)}</th>${q.map ? `<td class="na-was">${q.type === 'image' ? `<img class="na-ans-img" src="${esc(src(ctx, cur))}" alt="Current ${esc(q.label)}">` : show(q, cur)}</td><td class="${same ? '' : 'na-new'}">${show(q, v)}${same ? ' <span class="ed-hint">(no change)</span>' : ''}</td>` : mapped ? `<td class="na-was"></td><td>${show(q, v)}</td>` : `<td colspan="2">${show(q, v)}</td>`}</tr>`;
  }).join('');
  // Once approved, Approve only comes back when they resubmit (approving again would undo later edits in the Teams tab).
  const canApprove = !(pr.rev?.status === 'applied' && !pr.needsReview);
  const review = p.form.review ? `<div class="ed-row">
      ${pr.rev ? `<span class="ed-hint">${pr.rev.status === 'applied' ? '✓ Approved' : 'Asked to redo'} ${esc(when(pr.rev.at))}${pr.rev.note ? `: “${esc(pr.rev.note)}”` : ''}${pr.needsReview ? '. They have resubmitted since.' : ''}</span>` : ''}
      ${canApprove ? `<button class="ed-btn small primary" data-act="approve" data-code="${esc(code)}">${mapped ? '✓ Approve and update the team…' : '✓ Approve'}</button>` : ''}
      <button class="ed-btn small danger" data-act="reject" data-code="${esc(code)}">Ask them to redo…</button></div>` : '';
  return `<div class="ed-sub na-answers"><h4><span class="na-teamcell">${logo(t, 26)}${esc(t?.name || code)}</span> <span class="ed-hint">submitted ${esc(when(e.submitted))}${pr.late ? ' (late)' : ''}</span></h4>
    <table class="na-ans"><thead><tr><th></th>${mapped ? '<th>Now</th><th>Submitted</th>' : '<th colspan="2">Answer</th>'}</tr></thead><tbody>${rows}</tbody></table>${review}</div>`;
}

// What approving a registration would change: [{ label, from, to, set(team), file }] plus answers it has to skip.
// Logos are read and converted to PNG here, so applying the plan afterwards is instant (and undoable).
async function planApproval(ctx, p, code) {
  const S = ctx.draft, t = S.teams.find(x => x.code === code), ans = entry(code, p.id)?.answers || {};
  if (!t) throw new Error('That team no longer exists.');
  const plan = [], skipped = [];
  for (const q of p.form.questions) {
    const v = ans[q.id];
    if (!q.map || v == null || v === '') continue;
    if (q.map === 'team.logo' || q.map === 'team.logo_alt') {
      if (v === currentValue(S, code, q.map)) continue;   // kept their current logo
      const blob = await ctx.readRepo(v);
      if (!blob) throw new Error(`Couldn't find the uploaded image ${v}.`);
      const out = `assets/teams/${code.toLowerCase()}${q.map === 'team.logo_alt' ? '-alt' : ''}.png`;
      plan.push({ label: q.map === 'team.logo' ? 'Logo' : 'Watermark logo', from: 'current', to: 'new image', file: [out, await toPng(blob)] });
    } else {
      const k = q.map.slice(5), val = String(v).trim(), label = TEAM_FIELDS.find(([x]) => x === q.map)[1];
      if (k.startsWith('colour') && !/^#[0-9a-f]{6}$/i.test(val)) { skipped.push(`${label}: “${val}” isn't a colour like #1a2b3c`); continue; }
      if (t[k] !== val) plan.push({ label, from: t[k] ?? '', to: val, set: team => { team[k] = val; } });
    }
  }
  return { plan, skipped };
}
async function toPng(blob) {
  // Uploads are already at most 512 px, so a PNG can be used as it is (no canvas needed).
  const head = new DataView(await blob.slice(0, 24).arrayBuffer());
  if (head.byteLength === 24 && head.getUint32(0) === 0x89504e47 && head.getUint32(16) <= 512 && head.getUint32(20) <= 512) return new Blob([blob], { type: 'image/png' });
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Couldn’t convert the logo.'))), 'image/png'));
}

function csv(S, p) {
  const qs = p.form.questions, polls = p.blocks.filter(b => b.type === 'poll'), squad = new Map(S.players.map(pl => [String(pl.id), pl.name]));
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const iso = s => (s ? `${s}Z` : '');   // stamps are UTC
  const rows = [['Team', 'Submitted (UTC)', 'Late', 'Review', ...(p.ack ? ['Got it (UTC)'] : []), ...polls.map(b => `Vote: ${b.question}`), ...qs.map(q => q.label)]];
  for (const t of audienceOf(S, p)) {
    const pr = progress(S, p, t.code), a = pr.e?.answers || {};
    rows.push([t.name, iso(pr.e?.submitted), pr.late ? 'yes' : '', pr.rev?.status || '', ...(p.ack ? [iso(pr.e?.read)] : []),
      ...polls.map(b => { const v = pr.e?.votes?.[b.id]; return v == null ? '' : b.options[v] ?? `#${v}`; }),
      ...qs.map(q => { const v = a[q.id]; return q.type === 'player' ? squad.get(String(v)) || v : Array.isArray(v) ? v.join('; ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v; })]);
  }
  const url = URL.createObjectURL(new Blob([rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${titleOf(p).replace(/[^\w -]+/g, '').trim() || 'form'} answers.csv` });
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Events ----------

function current(ctx) { return posts(ctx.draft).find(p => p.id === sel); }

// A post changed: drafts are saved on this device, live posts go out when you press Publish.
function saved(ctx, p) {
  if (!p) return;
  p.updated = stamp();
  if (p.status === 'draft') saveDrafts(); else ctx.touch();
}

// Remove something from a post, with Undo. Live posts use ctx.change (Undo also holds the publish);
// drafts keep a copy of the post on this device.
function removal(ctx, p, label, mutate) {
  if (p.status === 'draft') {
    const snap = clone(p);
    mutate(p); saved(ctx, p); ctx.refresh();
    toast(label, { kind: 'ok', undo: () => {
      const i = drafts.findIndex(x => x.id === snap.id);
      if (i >= 0) drafts[i] = snap; else drafts.push(snap);
      saveDrafts(); ctx.refresh();
    } });
    return;
  }
  const id = p.id, run = () => { const q = (ctx.draft.news || []).find(x => x.id === id); if (q) { mutate(q); q.updated = stamp(); } };
  if (ctx.change) ctx.change(label, run);
  else { run(); ctx.refresh(); toast(label, { kind: 'ok' }); }
}

function onInput(e, ctx) {
  const el = e.target, path = el.dataset.path, p = current(ctx);
  if (!path || !p || el.type === 'checkbox' || el.tagName === 'SELECT' || el.readOnly) return;
  setPath(p, path, readInput(el));
  saved(ctx, p);
  updatePreview(ctx);
}

// Arrow keys move between the visibility options, like radio buttons.
function onKey(e) {
  const r = e.target.closest?.('[role="radio"]');
  if (!r || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const all = [...r.parentElement.querySelectorAll('[role="radio"]')], i = all.indexOf(r);
  const next = all[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? all.length - 1 : 1)) % all.length];
  next.click();
  setTimeout(() => document.querySelector(`[role="radio"][data-v="${next.dataset.v}"]`)?.focus());
}

function onChange(e, ctx) {
  const el = e.target, p = current(ctx);
  if (el.matches('[data-pteam]')) { previewTeam = el.value; return updatePreview(ctx); }
  if (el.dataset.img && p) {
    const file = el.files?.[0];
    if (!file) return;
    if (file.size > 3e6) { toast('That image is over 3 MB. Please use a smaller one.', { kind: 'err' }); el.value = ''; return; }
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const path = `assets/news/${p.id}-${Date.now().toString(36)}.${ext}`, old = getPath(p, el.dataset.img);
    setPath(p, el.dataset.img, path);
    if (p.status === 'draft') { putDraftFile(path, file); if (old) dropDraftFiles([old]); }
    else { ctx.uploads.set(path, file); if (old && ctx.uploads.has(old) && !pathsInPosts(ctx, old)) ctx.uploads.delete(old); }
    saved(ctx, p);
    return ctx.refresh();
  }
  if (!p) return;
  if (el.dataset.act === 'aud-all') { p.audience = el.checked ? 'all' : []; saved(ctx, p); return ctx.refresh(); }
  if (el.dataset.act === 'aud-team') {
    const set = new Set(Array.isArray(p.audience) ? p.audience : []);
    el.checked ? set.add(el.dataset.code) : set.delete(el.dataset.code);
    p.audience = ctx.draft.teams.map(t => t.code).filter(c => set.has(c));
    saved(ctx, p);
    return ctx.refresh();
  }
  const path = el.dataset.path;
  if (!path || el.readOnly) return;
  setPath(p, path, readInput(el));
  if (path === 'due.date') p.due = el.value ? { date: el.value, time: p.due?.time || '18:00' } : null;
  if (/^form\.questions\.\d+\.type$/.test(path)) {   // keep the team link only if it still fits the type
    const q = getPath(p, path.replace(/\.type$/, ''));
    if (q.map && !MAP_TYPES[q.map].includes(q.type)) q.map = null;
    if (OPTION_TYPES.has(q.type) && !(q.options || []).length) q.options = ['Option 1', 'Option 2'];
  }
  if (/\.map$/.test(path) && !el.value) setPath(p, path, null);
  saved(ctx, p);
  // Selects, ticks and dates change what the editor shows; text only needs the preview.
  // Date boxes report a change for every digit typed, so they redraw when you leave the box (onBlur).
  if (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'color') ctx.refresh();
  else updatePreview(ctx);
}
// Is a repo path still used by any sent post (so an unpublished upload must stay)?
const pathsInPosts = (ctx, path) => JSON.stringify(ctx.draft.news || []).includes(`"${path}"`);

function move(list, i, d) { const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; }

async function onClick(e, ctx) {
  const S = ctx.draft;
  const pm = e.target.closest('[data-pmode]');
  if (pm) { previewMode = pm.dataset.pmode; return ctx.refresh(); }
  const pn = e.target.closest('[data-pane]');
  if (pn && pn.tagName === 'BUTTON') {
    pane = pn.dataset.pane;
    body(e).querySelector('.na-grid')?.setAttribute('data-pane', pane);
    for (const x of body(e).querySelectorAll('.na-panes [data-pane]')) x.setAttribute('aria-pressed', String(x.dataset.pane === pane));
    return updatePreview(ctx);
  }
  const vw = e.target.closest('[data-view]');
  if (vw) { view = vw.dataset.view; if (view === 'responses' && !files && !filesLoading) { filesErr = ''; loadFiles(ctx); } return ctx.refresh(); }
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'INPUT') return;
  b.closest('details.na-more')?.removeAttribute('open');
  const act = b.dataset.act, p = current(ctx), i = Number(b.dataset.i);
  const done = (text, kind = 'ok') => { if (p) saved(ctx, p); ctx.refresh(); if (text) toast(text, { kind }); };
  try {
    switch (act) {
      case 'new': {
        const v = document.getElementById('na-from').value, [kind, id] = v.split(':');
        const t = tpls(S).find(x => x.id === id);
        const from = kind === 'preset' ? PRESETS[id].post() : t ? fromTemplate(t) : {};
        const n = newPost(S, from);
        drafts.push(n); saveDrafts(); sel = n.id; view = 'edit'; pane = 'edit'; open.clear(); open.add('settings');
        n.blocks.forEach(bl => open.add(keyOf(bl)));
        return done();
      }
      case 'open': sel = b.closest('[data-id]').dataset.id; view = 'edit'; respTeam = null; open.clear(); return ctx.refresh();
      case 'back': sel = null; return ctx.refresh();
      case 'del-tpl': {
        const t = tpls(S).find(x => x.id === b.dataset.tpl), label = `Template “${t?.name}” deleted`;
        const run = () => { ctx.draft.news_templates = tpls(ctx.draft).filter(x => x.id !== b.dataset.tpl); };
        if (ctx.change) return ctx.change(label, run);
        run(); return done(label);
      }
      case 'vis': p.visibility = b.dataset.v; return done();
      case 'send': {
        const problems = check(S, p);
        if (problems.length) return updatePreview(ctx);
        const aud = audienceOf(S, p);
        if (!await ask({ title: `Send “${titleOf(p)}”?`, ok: 'Send',
          text: `It goes to ${aud.length} team portal${aud.length === 1 ? '' : 's'}${p.visibility === 'public' ? ' and the public site' : ' (with a teaser on the public site)'}. It goes live when you press Publish.` })) return;
        const used = pathsIn(p);
        drafts = drafts.filter(x => x !== p); saveDrafts();
        p.status = 'live'; p.sent ||= stamp(); p.updated = stamp();
        for (const path of used) ctx.uploads.set(path, draftFiles.get(path));
        dropDraftFiles(used);
        (S.news ||= []).push(p);
        ctx.refresh();
        return toast('Sent. Press Publish to put it live.', { kind: 'ok' });
      }
      case 'close': return removal(ctx, p, `Closed “${titleOf(p)}”: no more answers or votes`, q => { q.status = 'closed'; });
      case 'reopen': p.status = 'live'; return done('Reopened.');
      case 'unsend': {
        if (anyResponse(p) !== false) return toast('Teams may have responded already, so this post can’t go back to a draft.', { kind: 'err' });
        if (!await ask({ title: 'Back to draft?', text: 'It disappears from the portals and the public site, and the draft is kept on this device only.', ok: 'Back to draft' })) return;
        S.news = S.news.filter(x => x !== p);
        p.status = 'draft'; p.sent = null;
        drafts.push(p);
        return done('Back to draft, on this device.');
      }
      case 'pin': p.pinned = !p.pinned; return done();
      case 'dup': {
        const n = newPost(S, freshIds({ ...clone(p), status: 'draft', sent: null, reviews: {} }));
        n.id = uid('n');
        const dropped = dropPastDue(n);
        // A copy of a live post points at images already on the site; a copy of a draft shares its draft images.
        drafts.push(n); saveDrafts(); sel = n.id; view = 'edit';
        return done(`Copied as a new draft${dropped ? '. Its deadline had passed, so it was cleared' : ''}.`);
      }
      case 'save-tpl': {
        const name = await askText({ title: 'Save as template', label: 'Template name', value: titleOf(p), required: true, ok: 'Save template',
          text: 'Templates are saved in the league data, which is public. A deadline is kept as “so many days after you start the post”.' });
        if (!name) return;
        const { id, status, sent, updated, reviews, due, ...rest } = clone(p);
        const d = dueDate(p), days = d ? Math.max(1, Math.round((d - new Date()) / DAY)) : null;
        (S.news_templates ||= []).push({ id: uid('t'), name: name.slice(0, 60), post: rest, ...(d ? { due_days: days, due_time: due.time || '18:00' } : {}) });
        ctx.refresh();
        return toast(`Saved as the template “${name.slice(0, 60)}”. Pick it under New post.`, { kind: 'ok' });
      }
      case 'delete': {
        if (p.status === 'draft') {
          const snap = p;
          drafts = drafts.filter(x => x !== p); saveDrafts(); sel = null; ctx.refresh();
          return toast('Draft deleted', { kind: 'ok', undo: () => { drafts.push(snap); saveDrafts(); ctx.refresh(); } });
        }
        const answered = anyResponse(p);
        if (answered !== false && !await ask({ title: 'Delete this post?', danger: true, ok: 'Delete post',
          text: answered ? 'Teams have already responded to it. Their answers stay in their team files, but you won’t see them here any more.' : 'The teams’ responses haven’t loaded, so some teams may already have answered it.' })) return;
        sel = null;
        const id = p.id, run = () => { ctx.draft.news = (ctx.draft.news || []).filter(x => x.id !== id); };
        if (ctx.change) return ctx.change(`Post “${titleOf(p)}” deleted`, run);
        run(); return done('Post deleted.');
      }
      case 'img-clear': {
        const path = b.dataset.path, old = getPath(p, path);
        return removal(ctx, p, 'Image removed', q => { setPath(q, path, ''); if (q.status === 'draft' && old) setTimeout(() => dropDraftFiles([old]), 10000); });
      }
      case 'add-block': { const nb = block(b.dataset.type)(S); p.blocks.push(nb); open.add(keyOf(nb)); return done(); }
      case 'block-up': move(p.blocks, i, -1); return done();
      case 'block-down': move(p.blocks, i, 1); return done();
      case 'block-del': return removal(ctx, p, `${BLOCKS.find(([k]) => k === p.blocks[i]?.type)?.[1] || 'Block'} removed`, q => q.blocks.splice(i, 1));
      case 'add-field': (p.blocks[i].fields ||= []).push({ name: 'Field', value: '', inline: true }); return done();
      case 'add-button': (p.blocks[i].buttons ||= []).push({ label: 'Open', url: '', style: 'primary' }); return done();
      case 'add-form': {
        p.form = b.dataset.kind === 'registration' ? PRESETS.registration.post().form : PRESETS.form.post().form;
        return done();
      }
      case 'del-form': return removal(ctx, p, 'Form removed', q => { q.form = null; });
      case 'add-q': { const q = question({ label: '' }); p.form.questions.push(q); open.add(`q:${q.id}`); return done(); }
      case 'q-up': move(p.form.questions, i, -1); return done();
      case 'q-down': move(p.form.questions, i, 1); return done();
      case 'q-del': return removal(ctx, p, `Question “${p.form.questions[i]?.label || 'Untitled'}” removed`, q => q.form.questions.splice(i, 1));
      case 'reload': filesErr = ''; loadFiles(ctx); return ctx.refresh();
      case 'answers': respTeam = respTeam === b.dataset.code ? null : b.dataset.code; return ctx.refresh();
      case 'csv': return csv(S, p);
      case 'approve': {
        const code = b.dataset.code, team = S.teams.find(x => x.code === code);
        b.disabled = true; b.textContent = 'Checking…';
        let res;
        try { res = await planApproval(ctx, p, code); } finally { b.disabled = false; b.textContent = '✓ Approve and update the team…'; }
        const { plan, skipped } = res, esc = ctx.esc;
        const html = `${plan.length ? `<ul class="na-diff">${plan.map(c => `<li><b>${esc(c.label)}</b>: ${c.file ? 'new image' : `${esc(c.from || '(empty)')} → <b>${esc(c.to)}</b>`}</li>`).join('')}</ul>` : '<p>Nothing about the team changes.</p>'}
          ${skipped.length ? `<p class="na-red">Not applied:</p><ul class="na-diff">${skipped.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}`;
        if (!await ask({ title: `Approve ${team?.name || code}'s submission?`, html, ok: plan.length ? 'Approve and update' : 'Approve' })) return;
        const id = p.id, run = () => {
          const t = ctx.draft.teams.find(x => x.code === code), q = (ctx.draft.news || []).find(x => x.id === id);
          for (const c of plan) {
            if (c.set && t) c.set(t);
            if (c.file) { ctx.uploads.set(...c.file); blobUrls.delete(c.file[0]); }
          }
          if (q) (q.reviews ||= {})[code] = { status: 'applied', at: stamp(), note: '' };
        };
        const label = `Approved ${team?.name || code}${plan.length ? `: ${plan.map(c => c.label.toLowerCase()).join(', ')} updated` : ''}`;
        if (ctx.change) return ctx.change(label, run);
        run(); return done(label);
      }
      case 'reject': {
        const code = b.dataset.code, team = S.teams.find(x => x.code === code);
        const note = await askText({ title: `Ask ${team?.name || code} to redo it`, text: 'They see your note in their portal and can resubmit.', label: 'What should they change?', multiline: true, required: true, ok: 'Send note' });
        if (note == null) return;
        (p.reviews ||= {})[code] = { status: 'rejected', at: stamp(), note: note.slice(0, 300) };
        return done('Note sent. They can resubmit from their portal.');
      }
    }
    const m = act.match(/^(field|button)-(\d+)-(up|down|del)$/);
    if (m) {
      const k = m[1] === 'field' ? 'fields' : 'buttons', bi = Number(m[2]);
      if (m[3] === 'del') return removal(ctx, p, `${m[1] === 'field' ? 'Field' : 'Button'} removed`, q => q.blocks[bi][k].splice(i, 1));
      move(p.blocks[bi][k], i, m[3] === 'up' ? -1 : 1);
      return done();
    }
  } catch (err) { done(err.message, 'err'); }
}
const body = e => e.currentTarget || document;

// Anything that would make a post broken or confusing for managers.
function check(S, p) {
  const out = [];
  if (!p.blocks.length && !p.form) out.push('Add some content first.');
  if (Array.isArray(p.audience) && !p.audience.length) out.push('Pick at least one team.');
  for (const b of p.blocks) {
    if (b.type === 'embed' && !b.title && !b.description && !b.image && !(b.fields || []).length) out.push('An embed is empty.');
    if (b.type === 'poll' && (!b.question || (b.options || []).filter(Boolean).length < 2)) out.push('A poll needs a question and at least two options.');
  }
  for (const q of p.form?.questions || []) {
    if (!q.label) out.push('A form question has no text.');
    if (OPTION_TYPES.has(q.type) && (q.options || []).length < 2) out.push(`“${q.label || 'A question'}” needs at least two options.`);
  }
  if (p.form && !p.form.questions.length) out.push('The form has no questions.');
  const due = dueDate(p);
  if (due && due < new Date()) out.push('The deadline is in the past.');
  return [...new Set(out)];
}
