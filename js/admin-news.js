// Edit mode "News" tab: write Discohook-style posts with live blocks and forms, send them to the
// manager portals, and track who has read, voted and submitted. Format: docs/NEWS.md.
// admin.js calls newsTab(body, ctx) on every render; ctx = { draft (getter), refresh, touch, esc, uploads, readRepo }.
// Typing only updates the draft and the preview (ctx.touch); structural edits call ctx.refresh().
// The post renderer is js/news.js, shared with the manager portal and the public site.

import { kickoff, teamMap } from './data.js';
import { logo, parseStamp } from './ui.js';

let N = null;                 // js/news.js once loaded
let sel = null;               // selected post id (null = list)
let view = 'edit';            // 'edit' | 'responses'
let previewMode = 'preview';  // 'preview' (portal look) | 'public'
let previewTeam = null;
let respTeam = null;          // team whose answers are open in Responses
let msg = null;               // { ok, text } shown once
const open = new Set();       // expanded editor cards, by key
let files = null, filesAt = null, filesErr = '', filesLoading = false;   // team code -> team file (straight from the repo)
const blobUrls = new Map();   // repo path -> object URL (uploads not on the site yet, answer images)

const stamp = () => new Date().toISOString().slice(0, 19);   // UTC, like season.updated
const uid = p => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const clone = o => structuredClone(o);
const when = s => { const d = parseStamp(s); return d ? d.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''; };
const posts = S => S.news || [], tpls = S => S.news_templates || [];
const dueDate = p => (p.due?.date ? kickoff(p.due) : null);

const QUESTION_TYPES = [['short', 'Short answer'], ['long', 'Paragraph'], ['number', 'Number'], ['choice', 'Multiple choice'], ['multi', 'Checkboxes'],
  ['dropdown', 'Dropdown'], ['checkbox', 'Yes / no tick'], ['colour', 'Colour'], ['image', 'Image upload'], ['date', 'Date'], ['player', 'Player from their squad']];
const TEAM_FIELDS = [['', 'Not linked'], ['team.name', 'Team name'], ['team.manager', 'Manager name'], ['team.colour', 'Main colour'],
  ['team.colour2', 'Second colour'], ['team.logo', 'Team logo'], ['team.logo_alt', 'Watermark logo']];
const MAP_TYPES = { 'team.name': ['short'], 'team.manager': ['short'], 'team.colour': ['colour'], 'team.colour2': ['colour'], 'team.logo': ['image'], 'team.logo_alt': ['image'] };
const OPTION_TYPES = new Set(['choice', 'multi', 'dropdown']);
const BLOCKS = [['embed', 'Embed'], ['table', 'League table'], ['fixtures', 'Fixtures / results'], ['team', 'Team spotlight'], ['poll', 'Poll']];

// ---------- New posts and templates ----------

const embed = (o = {}) => ({ type: 'embed', colour: '#5865f2', author: { name: 'HCL Admin', icon: 'assets/league/logo.png', url: '' }, title: '', url: '', description: '',
  fields: [], thumbnail: '', image: '', footer: { text: 'Heineken C League', icon: '' }, timestamp: true, buttons: [], ...o });
const block = type => ({
  embed: () => embed(),
  table: () => ({ type: 'table', title: 'League table', rows: 0 }),
  fixtures: () => ({ type: 'fixtures', week: 'next', title: '' }),
  team: S => ({ type: 'team', team: S.teams[0]?.code || '', title: '' }),
  poll: () => ({ type: 'poll', id: uid('p'), question: 'Which kick-off time suits your team best?', options: ['12:00 pm', '4:00 pm', '6:00 pm'], results: 'after_vote' }),
})[type];
const question = (o = {}) => ({ id: uid('q'), type: 'short', label: '', help: '', required: false, options: [], min: null, max: null, maxlen: null, map: null, ...o });

const PRESETS = {
  announcement: { name: 'Announcement', post: () => ({ blocks: [embed({ title: 'League announcement', description: 'Write your announcement here.' })] }) },
  registration: {
    name: 'Team registration form',
    post: () => ({
      visibility: 'managers', ack: false,
      due: { date: new Date(Date.now() + 7 * 864e5).toLocaleDateString('en-CA'), time: '18:00' },
      blocks: [embed({ colour: '#f5c518', title: 'Season 3 team registration',
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
  matchday: { name: 'Matchday preview', post: () => ({ visibility: 'public', blocks: [embed({ colour: '#22c55e', title: 'Matchday preview', description: 'This week’s fixtures. Good luck to every team!' }), block('fixtures')()] }) },
  table: { name: 'Table update', post: () => ({ visibility: 'public', blocks: [embed({ colour: '#38bdf8', title: 'Where the table stands', description: '' }), block('table')()] }) },
  poll: { name: 'Poll', post: () => ({ blocks: [embed({ colour: '#a855f7', title: 'Have your say', description: 'One vote per team. Votes are final.' }), block('poll')()] }) },
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

async function loadFiles(ctx) {
  if (filesLoading) return;
  filesLoading = true; filesErr = '';
  try {
    const out = {};
    await Promise.all(ctx.draft.teams.map(async t => {
      const b = await ctx.readRepo(`data/teams/${t.code.toLowerCase()}.json`);
      out[t.code] = b ? JSON.parse(await b.text()) : {};
    }));
    files = out; filesAt = new Date();
  } catch (e) { filesErr = e.message; }
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

// Object URLs for images that aren't served by the site yet: this session's uploads, and answer images read from the repo.
function src(ctx, path) {
  if (!path || /^https?:|^data:|^blob:/.test(path)) return path;
  if (blobUrls.has(path)) return blobUrls.get(path);
  const b = ctx.uploads.get(path);
  if (b) { const u = URL.createObjectURL(b); blobUrls.set(path, u); return u; }
  return path;
}
async function fetchAnswerImage(ctx, path) {
  if (blobUrls.has(path)) return;
  const b = await ctx.readRepo(path).catch(() => null);
  if (b) { blobUrls.set(path, URL.createObjectURL(b)); ctx.refresh(); }
}

// ---------- Render ----------

export function newsTab(body, ctx) {
  const S = ctx.draft, esc = ctx.esc;
  if (!N) {
    import('./news.js').then(m => { N = m; ctx.refresh(); })
      .catch(() => { N = { missing: true }; ctx.refresh(); });
  }
  const post = posts(S).find(p => p.id === sel);
  if (sel && !post) sel = null;
  if (!previewTeam || !S.teams.some(t => t.code === previewTeam)) previewTeam = S.teams[0]?.code || null;
  if (files === null && !filesLoading && posts(S).some(p => p.status !== 'draft')) loadFiles(ctx);

  // Keep focus and caret across re-renders (an auto-publish re-renders the tab while you type).
  const a = document.activeElement, keep = a && body.contains(a) && a.dataset.path ? { path: a.dataset.path, s: a.selectionStart, e: a.selectionEnd } : null;
  body.innerHTML = `${msg ? `<p class="${msg.ok ? 'ed-ok' : 'ed-err'}">${esc(msg.text)}</p>` : ''}${post ? postView(S, post, ctx) : listView(S, ctx)}`;
  msg = null;
  if (keep) {
    const el = body.querySelector(`[data-path="${CSS.escape(keep.path)}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch { /* not a text input */ } }
  }
  body.oninput = e => onInput(e, ctx);
  body.onchange = e => onChange(e, ctx);
  body.onclick = e => onClick(e, ctx);
  if (post && view === 'responses' && respTeam) {
    const ans = entry(respTeam, post.id)?.answers || {};
    for (const q of post.form?.questions || []) if (q.type === 'image' && ans[q.id]) fetchAnswerImage(ctx, ans[q.id]);
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
        <span class="na-bar" style="background:${esc(p.blocks.find(b => b.type === 'embed')?.colour || '#5865f2')}"></span>
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
    ${pending ? `<p class="na-callout">📝 ${pending} submission${pending > 1 ? 's' : ''} waiting for your review. Open the post and choose <b>Responses</b>.</p>` : ''}
    ${posts(S).length ? '' : '<p class="ed-hint">No posts yet. Pick a starting point above (try <b>Team registration form</b>) and press New post.</p>'}
    ${group('draft', 'Drafts', 'only you can see these')}${group('live', 'Live', 'showing in the portals')}${group('closed', 'Closed', 'still visible; forms and polls closed')}
    ${tpls(S).length ? `<div class="ed-sub"><h4>Your templates</h4>${tpls(S).map(t => `<div class="q-row"><span>${esc(t.name)}</span><button class="ed-btn small danger" data-act="del-tpl" data-tpl="${esc(t.id)}">Delete</button></div>`).join('')}</div>` : ''}
    ${filesErr ? `<p class="ed-err">Couldn't load the teams' responses: ${esc(filesErr)}</p>` : ''}
  </div>`;
}

function postView(S, p, ctx) {
  const esc = ctx.esc, live = p.status !== 'draft';
  const actions = [
    `<button class="ed-btn small" data-act="back">← All posts</button>`,
    p.status === 'draft' ? `<button class="ed-btn small primary" data-act="send">📣 Send to ${p.audience === 'all' ? 'all teams' : `${audienceOf(S, p).length} team(s)`}</button>` : '',
    p.status === 'live' ? `<button class="ed-btn small" data-act="close">Close${p.form || p.blocks.some(b => b.type === 'poll') ? ' form / poll' : ''}</button>` : '',
    p.status === 'closed' ? `<button class="ed-btn small primary" data-act="reopen">Reopen</button>` : '',
    `<button class="ed-btn small" data-act="pin">${p.pinned ? 'Unpin' : '📌 Pin'}</button>`,
    `<button class="ed-btn small" data-act="dup">Duplicate</button>`,
    `<button class="ed-btn small" data-act="save-tpl">Save as template</button>`,
    p.status === 'live' && !anyResponse(p) ? `<button class="ed-btn small" data-act="unsend">Back to draft</button>` : '',
    `<button class="ed-btn small danger" data-act="delete">Delete</button>`,
  ].join('');
  const tabs = live && (p.form || p.ack || p.blocks.some(b => b.type === 'poll'))
    ? `<div class="fx-filters">${[['edit', 'Edit post'], ['responses', 'Responses']].map(([k, l]) => `<button class="fx-filter" data-view="${k}" aria-pressed="${view === k}">${l}</button>`).join('')}</div>` : '';
  if (!tabs) view = 'edit';
  return `<div class="ed-section na-post" data-post="${esc(p.id)}">
    <div class="na-head">${chip(p)}<h3>${esc(titleOf(p))}</h3></div>
    <div class="ed-row">${actions}</div>
    ${live ? `<p class="ed-hint">This post is live: edits go out with the next publish. Changing questions after teams have answered can confuse them.</p>` : ''}
    ${tabs}
    ${view === 'responses' ? responsesView(S, p, ctx) : `<div class="na-grid"><div class="na-editor">${settingsCard(S, p, esc)}${blocksCard(S, p, esc)}${formCard(S, p, esc)}</div>
      <aside class="na-preview">${previewPane(S, p, ctx)}</aside></div>`}
  </div>`;
}
const anyResponse = p => !!files && Object.values(files).some(f => f?.news?.[p.id]);

// ---------- Editor cards ----------

const field = (label, input, cls = '') => `<label class="ed-field ${cls}">${label}${input}</label>`;
const txt = (esc, path, v, ph = '', extra = '') => `<input class="ed-input" data-path="${path}" value="${esc(v ?? '')}" placeholder="${esc(ph)}" ${extra}>`;
const area = (esc, path, v, ph = '', rows = 4) => `<textarea class="ed-input na-area" rows="${rows}" data-path="${path}" placeholder="${esc(ph)}">${esc(v ?? '')}</textarea>`;
const chk = (path, v, label) => `<label class="na-check"><input type="checkbox" data-path="${path}"${v ? ' checked' : ''}> ${label}</label>`;
const img = (esc, path, v, label) => field(label, `<span class="na-img">${txt(esc, path, v, 'https://… or upload')}<label class="ed-btn small">Upload<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-img="${path}" hidden></label></span>`);
const card = (key, title, sub, inner, tools = '') => `<details class="na-card" data-key="${key}"${open.has(key) ? ' open' : ''}><summary><b>${title}</b><span class="ed-hint">${sub}</span>${tools}</summary><div class="na-card-body">${inner}</div></details>`;
const mover = (kind, i, n) => `<span class="na-tools">${i > 0 ? `<button class="ed-btn small" data-act="${kind}-up" data-i="${i}" title="Move up">↑</button>` : ''}${i < n - 1 ? `<button class="ed-btn small" data-act="${kind}-down" data-i="${i}" title="Move down">↓</button>` : ''}<button class="ed-btn small danger" data-act="${kind}-del" data-i="${i}" title="Remove">✕</button></span>`;

function settingsCard(S, p, esc) {
  const aud = p.audience === 'all';
  return card('settings', 'Who sees it and when', `${p.visibility === 'public' ? 'Public' : 'Managers only'} · ${aud ? 'all teams' : `${(p.audience || []).length} teams`}${p.due ? ` · due ${esc(p.due.date)} ${esc(p.due.time || '')}` : ''}`, `
    <div class="na-seg" role="radiogroup" aria-label="Visibility">
      <button data-act="vis" data-v="public" aria-pressed="${p.visibility === 'public'}"><b>🌐 Public</b><small>Whole post on the public site too</small></button>
      <button data-act="vis" data-v="managers" aria-pressed="${p.visibility !== 'public'}"><b>🔒 Managers only</b><small>Public site shows a teaser: "View more information in your manager portal"</small></button></div>
    <div class="ed-field">Which portals
      <div class="na-teams"><label class="na-check"><input type="checkbox" data-act="aud-all"${aud ? ' checked' : ''}> All teams</label>
      ${S.teams.map(t => `<label class="na-check${aud ? ' dim' : ''}"><input type="checkbox" data-act="aud-team" data-code="${esc(t.code)}"${aud || p.audience.includes(t.code) ? ' checked' : ''}${aud ? ' disabled' : ''}> ${esc(t.name)}</label>`).join('')}</div></div>
    <div class="na-row">${field('Deadline (optional)', `<input class="ed-input" type="date" data-path="due.date" value="${esc(p.due?.date || '')}">`)}
      ${field('Time', `<input class="ed-input" type="time" data-path="due.time" value="${esc(p.due?.time || '18:00')}"${p.due?.date ? '' : ' disabled'}>`)}</div>
    ${chk('ack', p.ack, 'Ask managers to tap <b>Got it</b> (read receipt)')}
    ${chk('pinned', p.pinned, 'Pin to the top of the news')}`);
}

function blocksCard(S, p, esc) {
  const n = p.blocks.length;
  const inner = p.blocks.map((b, i) => blockEditor(S, b, i, n, esc)).join('')
    + `<div class="ed-row na-add"><span class="ed-hint">Add:</span>${BLOCKS.map(([k, l]) => `<button class="ed-btn small" data-act="add-block" data-type="${k}">+ ${l}</button>`).join('')}</div>`;
  return `<div class="na-group"><h4>Post content</h4>${inner}</div>`;
}

function blockEditor(S, b, i, n, esc) {
  const P = `blocks.${i}`, key = `b:${i}:${b.type}`;
  if (b.type === 'embed') {
    const fields = (b.fields || []).map((f, j) => `<div class="na-sub">
        <div class="na-row">${field('Field name', txt(esc, `${P}.fields.${j}.name`, f.name))}${chk(`${P}.fields.${j}.inline`, f.inline, 'Inline')}${mover(`field-${i}`, j, b.fields.length)}</div>
        ${field('Value', area(esc, `${P}.fields.${j}.value`, f.value, '', 2))}</div>`).join('');
    const buttons = (b.buttons || []).map((x, j) => `<div class="na-row na-sub">${field('Label', txt(esc, `${P}.buttons.${j}.label`, x.label))}${field('Link', txt(esc, `${P}.buttons.${j}.url`, x.url, 'https://… or manager.html'))}
        ${field('Style', `<select class="ed-select" data-path="${P}.buttons.${j}.style">${['primary', 'secondary', 'link'].map(s => `<option${x.style === s ? ' selected' : ''}>${s}</option>`).join('')}</select>`)}${mover(`button-${i}`, j, b.buttons.length)}</div>`).join('');
    return card(key, `Embed ${i + 1}`, esc(b.title || b.description?.slice(0, 40) || 'empty'), `
      <div class="na-row">${field('Colour', `<input type="color" class="na-colour" data-path="${P}.colour" value="${esc(b.colour || '#5865f2')}">`, 'narrow')}${field('Author', txt(esc, `${P}.author.name`, b.author?.name, 'HCL Admin'))}</div>
      <div class="na-row">${img(esc, `${P}.author.icon`, b.author?.icon, 'Author icon')}${field('Author link', txt(esc, `${P}.author.url`, b.author?.url, 'https://…'))}</div>
      ${field('Title', txt(esc, `${P}.title`, b.title, 'Big bold heading'))}
      ${field('Title link', txt(esc, `${P}.url`, b.url, 'https://… (optional)'))}
      ${field('Description', area(esc, `${P}.description`, b.description, '**bold** *italic* __underline__ ~~strike~~ ||spoiler|| [link](https://…) > quote - list', 6))}
      <p class="ed-hint">Placeholders: <code>{team}</code> <code>{manager}</code> <code>{due}</code> are filled in for each team.</p>
      <div class="na-group"><h5>Fields</h5>${fields}<button class="ed-btn small" data-act="add-field" data-i="${i}">+ Field</button></div>
      <div class="na-row">${img(esc, `${P}.thumbnail`, b.thumbnail, 'Thumbnail (top right)')}${img(esc, `${P}.image`, b.image, 'Large image')}</div>
      <div class="na-row">${field('Footer', txt(esc, `${P}.footer.text`, b.footer?.text))}${img(esc, `${P}.footer.icon`, b.footer?.icon, 'Footer icon')}</div>
      ${chk(`${P}.timestamp`, b.timestamp, 'Show the send time in the footer')}
      <div class="na-group"><h5>Link buttons</h5>${buttons}<button class="ed-btn small" data-act="add-button" data-i="${i}">+ Button</button></div>`, mover('block', i, n));
  }
  if (b.type === 'table') return card(key, 'League table', 'live, updates itself', `<div class="na-row">${field('Heading', txt(esc, `${P}.title`, b.title))}
    ${field('Teams shown', `<input class="ed-input" type="number" min="0" data-kind="num" data-path="${P}.rows" value="${esc(b.rows ?? 0)}">`, 'narrow')}</div><p class="ed-hint">0 shows every team. Columns: Pos, Team, P, GD, Pts.</p>`, mover('block', i, n));
  if (b.type === 'fixtures') {
    const weeks = [...new Set(S.fixtures.map(f => f.week).filter(w => w != null))].sort((x, y) => x - y);
    return card(key, 'Fixtures / results', b.week === 'next' ? 'next week' : `week ${esc(b.week)}`, `<div class="na-row">${field('Heading', txt(esc, `${P}.title`, b.title, 'e.g. This week’s matches'))}
      ${field('Week', `<select class="ed-select" data-kind="week" data-path="${P}.week"><option value="next"${b.week === 'next' ? ' selected' : ''}>Next week (updates itself)</option>${weeks.map(w => `<option value="${w}"${b.week === w ? ' selected' : ''}>Week ${w}</option>`).join('')}</select>`)}</div>
      <p class="ed-hint">Shows kick-off times, then scores once each match has been played.</p>`, mover('block', i, n));
  }
  if (b.type === 'team') return card(key, 'Team spotlight', esc(S.teams.find(t => t.code === b.team)?.name || ''), `<div class="na-row">${field('Heading', txt(esc, `${P}.title`, b.title, 'e.g. Team of the week'))}
    ${field('Team', `<select class="ed-select" data-path="${P}.team">${S.teams.map(t => `<option value="${esc(t.code)}"${b.team === t.code ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`)}</div>
    <p class="ed-hint">Logo, colours, recent form and next match.</p>`, mover('block', i, n));
  if (b.type === 'poll') return card(key, 'Poll', esc(b.question || 'no question yet'), `${field('Question', txt(esc, `${P}.question`, b.question))}
    ${field('Options (one per line)', `<textarea class="ed-input na-area" rows="4" data-kind="lines" data-path="${P}.options">${esc((b.options || []).join('\n'))}</textarea>`)}
    ${field('Managers see results', `<select class="ed-select" data-path="${P}.results">${[['after_vote', 'After they vote'], ['after_close', 'When the poll closes'], ['never', 'Never (only you)']].map(([v, l]) => `<option value="${v}"${b.results === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
    <p class="ed-hint">One vote per team, final. The public site only shows totals after you close the post.</p>`, mover('block', i, n));
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
      ${q.map ? '<p class="ed-hint">Pre-filled with the team’s current value. Approving the submission updates the team.</p>' : ''}`, mover('q', i, n));
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
function updatePreview(ctx) {
  const box = document.getElementById('na-prev'), p = posts(ctx.draft).find(x => x.id === sel);
  if (box && p) box.innerHTML = previewHtml(ctx.draft, p, ctx);
}

// ---------- Responses ----------

function responsesView(S, p, ctx) {
  const esc = ctx.esc, aud = audienceOf(S, p), polls = p.blocks.filter(b => b.type === 'poll');
  const head = `<div class="ed-row"><button class="ed-btn small" data-act="reload">↻ Refresh responses</button>
    <span class="ed-hint">${filesLoading ? 'Loading…' : filesAt ? `Loaded ${filesAt.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}` : ''}</span>
    ${p.form ? '<button class="ed-btn small" data-act="csv">Download answers (CSV)</button>' : ''}</div>
    ${filesErr ? `<p class="ed-err">${esc(filesErr)}</p>` : ''}`;
  if (!files) return head + '<p class="ed-hint">Loading the teams’ responses…</p>';
  const rows = aud.map(t => {
    const pr = progress(S, p, t.code), cells = [];
    if (p.ack) cells.push(pr.read ? `<span class="na-ok">✓ ${esc(when(pr.e.read))}</span>` : '<span class="ed-hint">Not yet</span>');
    if (p.form) {
      cells.push(pr.submitted ? `<span class="na-ok">✓ ${esc(when(pr.e.submitted))}</span>${pr.late ? ' <span class="fx-chip warn">Late</span>' : ''}` : pr.overdue ? '<span class="na-red">Overdue</span>' : '<span class="ed-hint">Not yet</span>');
      if (p.form.review) cells.push(pr.needsReview ? '<span class="fx-chip ready">To review</span>' : pr.rev?.status === 'applied' ? '<span class="fx-chip done">Approved</span>' : pr.rev?.status === 'rejected' ? '<span class="fx-chip warn">Asked to redo</span>' : '–');
    }
    for (const b of polls) { const v = pr.e?.votes?.[b.id]; cells.push(v != null ? esc(b.options[v] ?? `#${v}`) : '<span class="ed-hint">–</span>'); }
    return `<tr class="${respTeam === t.code ? 'on' : ''}"><td><span class="na-teamcell">${logo(t, 22)}${esc(t.name)}</span></td>${cells.map(c => `<td>${c}</td>`).join('')}
      <td>${p.form && pr.submitted ? `<button class="ed-btn small${respTeam === t.code ? ' primary' : ''}" data-act="answers" data-code="${esc(t.code)}">Answers</button>` : ''}</td></tr>`;
  }).join('');
  const heads = ['Team', ...(p.ack ? ['Got it'] : []), ...(p.form ? ['Submitted'] : []), ...(p.form?.review ? ['Review'] : []), ...polls.map(b => `Vote: ${esc(b.question || 'poll')}`), ''];
  const pollHtml = polls.map(b => {
    const counts = (b.options || []).map(() => 0);
    let total = 0;
    for (const t of aud) { const v = entry(t.code, p.id)?.votes?.[b.id]; if (v != null && counts[v] != null) { counts[v]++; total++; } }
    return `<div class="ed-sub"><h4>📊 ${esc(b.question || 'Poll')} <span class="ed-hint">${total}/${aud.length} voted</span></h4>${(b.options || []).map((o, i) => {
      const pct = total ? Math.round(counts[i] / total * 100) : 0;
      return `<div class="na-bar-row"><span>${esc(o)}</span><span class="na-meter"><i style="width:${pct}%"></i></span><b>${counts[i]}</b></div>`;
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
    if (q.type === 'image') return `<img class="na-ans-img" src="${esc(src(ctx, v))}" alt="">`;
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
    return `<tr><th>${esc(q.label)}</th>${q.map ? `<td class="na-was">${q.type === 'image' ? `<img class="na-ans-img" src="${esc(src(ctx, cur))}" alt="" onerror="this.replaceWith('none')">` : show(q, cur)}</td><td class="${same ? '' : 'na-new'}">${show(q, v)}${same ? ' <span class="ed-hint">(no change)</span>' : ''}</td>` : mapped ? `<td class="na-was"></td><td>${show(q, v)}</td>` : `<td colspan="2">${show(q, v)}</td>`}</tr>`;
  }).join('');
  const review = p.form.review ? `<div class="ed-row">
      ${pr.rev ? `<span class="ed-hint">${pr.rev.status === 'applied' ? 'Approved' : 'Asked to redo'} ${esc(when(pr.rev.at))}${pr.rev.note ? `: “${esc(pr.rev.note)}”` : ''}${pr.needsReview ? '. They have resubmitted since.' : ''}</span>` : ''}
      <button class="ed-btn small primary" data-act="approve" data-code="${esc(code)}">${mapped ? '✓ Approve and update the team' : '✓ Approve'}</button>
      <button class="ed-btn small danger" data-act="reject" data-code="${esc(code)}">Ask them to redo…</button></div>` : '';
  return `<div class="ed-sub na-answers"><h4><span class="na-teamcell">${logo(t, 26)}${esc(t?.name || code)}</span> <span class="ed-hint">submitted ${esc(when(e.submitted))}${pr.late ? ' (late)' : ''}</span></h4>
    <table class="na-ans"><thead><tr><th></th>${mapped ? '<th>Now</th><th>Submitted</th>' : '<th colspan="2">Answer</th>'}</tr></thead><tbody>${rows}</tbody></table>${review}</div>`;
}

// Approving a registration writes the linked answers to the team. Logos are converted to PNG.
async function approve(ctx, p, code) {
  const S = ctx.draft, t = S.teams.find(x => x.code === code), ans = entry(code, p.id)?.answers || {};
  if (!t) throw new Error('That team no longer exists.');
  const changes = [];
  for (const q of p.form.questions) {
    const v = ans[q.id];
    if (!q.map || v == null || v === '') continue;
    if (q.map === 'team.logo' || q.map === 'team.logo_alt') {
      if (v === currentValue(S, code, q.map)) continue;   // kept their current logo
      const blob = await ctx.readRepo(v);
      if (!blob) throw new Error(`Couldn't find the uploaded image ${v}.`);
      const out = `assets/teams/${code.toLowerCase()}${q.map === 'team.logo_alt' ? '-alt' : ''}.png`;
      ctx.uploads.set(out, await toPng(blob));
      blobUrls.delete(out);
      changes.push(q.map === 'team.logo' ? 'logo' : 'watermark logo');
    } else {
      const k = q.map.slice(5), val = String(v).trim();
      if (k.startsWith('colour') && !/^#[0-9a-f]{6}$/i.test(val)) continue;
      if (t[k] !== val) { t[k] = val; changes.push(k === 'colour2' ? 'second colour' : k); }
    }
  }
  (p.reviews ||= {})[code] = { status: 'applied', at: stamp(), note: '' };
  return changes;
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
  const qs = p.form.questions, squad = new Map(S.players.map(pl => [String(pl.id), pl.name]));
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Team', 'Submitted', 'Late', 'Review', ...qs.map(q => q.label)]];
  for (const t of audienceOf(S, p)) {
    const pr = progress(S, p, t.code), a = pr.e?.answers || {};
    rows.push([t.name, pr.submitted ? when(pr.e.submitted) : '', pr.late ? 'yes' : '', pr.rev?.status || '',
      ...qs.map(q => { const v = a[q.id]; return q.type === 'player' ? squad.get(String(v)) || v : Array.isArray(v) ? v.join('; ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v; })]);
  }
  const url = URL.createObjectURL(new Blob([rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${titleOf(p).replace(/[^\w -]+/g, '').trim() || 'form'} answers.csv` });
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Events ----------

function current(ctx) { return posts(ctx.draft).find(p => p.id === sel); }

function onInput(e, ctx) {
  const el = e.target, path = el.dataset.path, p = current(ctx);
  if (!path || !p || el.type === 'checkbox' || el.tagName === 'SELECT') return;
  setPath(p, path, readInput(el));
  p.updated = stamp();
  ctx.touch();
  updatePreview(ctx);
}

function onChange(e, ctx) {
  const el = e.target, p = current(ctx);
  if (el.matches('[data-pteam]')) { previewTeam = el.value; return updatePreview(ctx); }
  if (el.dataset.img && p) {
    const file = el.files?.[0];
    if (!file) return;
    if (file.size > 3e6) { msg = { ok: false, text: 'That image is over 3 MB. Please use a smaller one.' }; return ctx.refresh(); }
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const path = `assets/news/${p.id}-${Date.now().toString(36)}.${ext}`;
    ctx.uploads.set(path, file);
    setPath(p, el.dataset.img, path);
    return ctx.refresh();
  }
  if (!p) return;
  if (el.dataset.act === 'aud-all') { p.audience = el.checked ? 'all' : ctx.draft.teams.map(t => t.code); return ctx.refresh(); }
  if (el.dataset.act === 'aud-team') {
    const set = new Set(Array.isArray(p.audience) ? p.audience : []);
    el.checked ? set.add(el.dataset.code) : set.delete(el.dataset.code);
    p.audience = ctx.draft.teams.map(t => t.code).filter(c => set.has(c));
    return ctx.refresh();
  }
  const path = el.dataset.path;
  if (!path) return;
  setPath(p, path, readInput(el));
  if (path === 'due.date') p.due = el.value ? { date: el.value, time: p.due?.time || '18:00' } : null;
  if (/^form\.questions\.\d+\.type$/.test(path)) {   // keep the team link only if it still fits the type
    const q = getPath(p, path.replace(/\.type$/, ''));
    if (q.map && !MAP_TYPES[q.map].includes(q.type)) q.map = null;
    if (OPTION_TYPES.has(q.type) && !(q.options || []).length) q.options = ['Option 1', 'Option 2'];
  }
  if (/\.map$/.test(path) && !el.value) setPath(p, path, null);
  p.updated = stamp();
  // Selects, ticks and dates change what the editor shows; text only needs the preview.
  if (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date' || el.type === 'color') ctx.refresh();
  else { ctx.touch(); updatePreview(ctx); }
}

function move(list, i, d) { const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; }

async function onClick(e, ctx) {
  const S = ctx.draft;
  const sum = e.target.closest('details.na-card > summary');
  if (sum && !e.target.closest('button')) {   // remember which cards are open across re-renders
    const d = sum.parentElement;
    setTimeout(() => (d.open ? open.add(d.dataset.key) : open.delete(d.dataset.key)));
    return;
  }
  const pm = e.target.closest('[data-pmode]');
  if (pm) { previewMode = pm.dataset.pmode; return ctx.refresh(); }
  const vw = e.target.closest('[data-view]');
  if (vw) { view = vw.dataset.view; if (view === 'responses' && !files) loadFiles(ctx); return ctx.refresh(); }
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'INPUT') return;
  if (b.closest('summary')) e.preventDefault();
  const act = b.dataset.act, p = current(ctx), i = Number(b.dataset.i);
  const done = (text, ok = true) => { if (text) msg = { ok, text }; if (p) p.updated = stamp(); ctx.refresh(); };
  try {
    switch (act) {
      case 'new': {
        const v = document.getElementById('na-from').value, [kind, id] = v.split(':');
        const from = kind === 'preset' ? PRESETS[id].post() : freshIds(clone(tpls(S).find(t => t.id === id)?.post || {}));
        const n = newPost(S, from);
        (S.news ||= []).push(n); sel = n.id; view = 'edit'; open.clear(); open.add('settings');
        n.blocks.forEach((bl, k) => open.add(`b:${k}:${bl.type}`));
        return done();
      }
      case 'open': sel = b.closest('[data-id]').dataset.id; view = 'edit'; respTeam = null; open.clear(); return done();
      case 'back': sel = null; return done();
      case 'del-tpl': if (confirm('Delete this template?')) S.news_templates = tpls(S).filter(t => t.id !== b.dataset.tpl); return done();
      case 'vis': p.visibility = b.dataset.v; return done();
      case 'send': {
        const problems = check(S, p);
        if (problems.length) return done(`Can't send yet: ${problems.join(' ')}`, false);
        const aud = audienceOf(S, p);
        if (!confirm(`Send “${titleOf(p)}” to ${aud.length} team portal${aud.length === 1 ? '' : 's'}${p.visibility === 'public' ? ' and the public site' : ' (teaser on the public site)'}? It goes live with the next publish, in a few seconds.`)) return;
        p.status = 'live'; p.sent ||= stamp();
        return done('Sent. It goes live when this publish finishes.');
      }
      case 'close': p.status = 'closed'; return done('Closed: still visible, but no more answers or votes.');
      case 'reopen': p.status = 'live'; return done('Reopened.');
      case 'unsend': if (confirm('Take this post back to a draft? It disappears from the portals.')) { p.status = 'draft'; p.sent = null; } return done();
      case 'pin': p.pinned = !p.pinned; return done();
      case 'dup': {
        const n = newPost(S, freshIds({ ...clone(p), id: undefined, status: 'draft', sent: null, reviews: {} }));
        n.id = uid('n'); (S.news ||= []).push(n); sel = n.id; view = 'edit';
        return done('Copied as a new draft.');
      }
      case 'save-tpl': {
        const name = prompt('Template name', titleOf(p));
        if (!name) return;
        const { id, status, sent, updated, reviews, ...rest } = clone(p);
        (S.news_templates ||= []).push({ id: uid('t'), name: name.slice(0, 60), post: rest });
        return done(`Saved as the template “${name}”. Pick it under New post.`);
      }
      case 'delete': {
        const answered = p.status !== 'draft' && anyResponse(p);
        if (!confirm(answered ? 'Teams have already responded to this post. Delete it and hide their responses?' : 'Delete this post?')) return;
        S.news = posts(S).filter(x => x !== p); sel = null;
        return done('Post deleted.');
      }
      case 'add-block': p.blocks.push(block(b.dataset.type)(S)); open.add(`b:${p.blocks.length - 1}:${b.dataset.type}`); return done();
      case 'block-up': move(p.blocks, i, -1); return done();
      case 'block-down': move(p.blocks, i, 1); return done();
      case 'block-del': if (confirm('Remove this block?')) p.blocks.splice(i, 1); return done();
      case 'add-field': (p.blocks[i].fields ||= []).push({ name: 'Field', value: '', inline: true }); return done();
      case 'add-button': (p.blocks[i].buttons ||= []).push({ label: 'Open', url: '', style: 'primary' }); return done();
      case 'add-form': {
        p.form = b.dataset.kind === 'registration' ? PRESETS.registration.post().form : PRESETS.form.post().form;
        return done();
      }
      case 'del-form': if (confirm('Remove the form and its questions?')) p.form = null; return done();
      case 'add-q': { const q = question({ label: '' }); p.form.questions.push(q); open.add(`q:${q.id}`); return done(); }
      case 'q-up': move(p.form.questions, i, -1); return done();
      case 'q-down': move(p.form.questions, i, 1); return done();
      case 'q-del': if (confirm('Remove this question?')) p.form.questions.splice(i, 1); return done();
      case 'reload': files = null; loadFiles(ctx); return done();
      case 'answers': respTeam = respTeam === b.dataset.code ? null : b.dataset.code; return done();
      case 'csv': return csv(S, p);
      case 'approve': {
        b.disabled = true; b.textContent = 'Applying…';
        const changes = await approve(ctx, p, b.dataset.code);
        return done(`Approved. ${changes.length ? `Updated the team’s ${changes.join(', ')}.` : 'Nothing about the team changed.'} It goes live with the next publish.`);
      }
      case 'reject': {
        const note = prompt('What should they change? (shown to the manager)');
        if (note == null) return;
        (p.reviews ||= {})[b.dataset.code] = { status: 'rejected', at: stamp(), note: note.slice(0, 300) };
        return done('They’ll see your note in their portal and can resubmit.');
      }
    }
    const m = act.match(/^(field|button)-(\d+)-(up|down|del)$/);
    if (m) {
      const list = p.blocks[Number(m[2])][m[1] === 'field' ? 'fields' : 'buttons'];
      if (m[3] === 'del') list.splice(i, 1); else move(list, i, m[3] === 'up' ? -1 : 1);
      return done();
    }
  } catch (err) { done(err.message, false); }
}

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
