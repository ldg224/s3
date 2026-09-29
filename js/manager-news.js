// Manager Hub: League news. The News tab, the "to do" banner shown on every tab, the unread
// badge, and the actions a manager can take on a post: "Got it", poll votes, forms and image
// uploads. Posts and rules come from js/news.js; changes go through the relay's 'news' and
// 'upload' actions (tools/manager-relay.gs), one post at a time.

import { esc } from './ui.js';
import { postsFor, outstanding, renderPost, readForm, checkAnswers, dueLabel, UPLOAD_TYPES, MAX_UPLOAD_BYTES, MAX_IMAGE_SIDE } from './news.js';
import { relaySave } from './managers.js';

// ctx: { season, me, file (the team file, kept current by setNews), teamFiles, setNews(news, raw), openPost(id) }

const REASONS = {
  form: 'Fill in the form',
  resubmit: 'Change your answers and submit again',
  ack: 'Tap “Got it”',
  poll: 'Vote in the poll',
};

const titleOf = post => (post.blocks || []).find(b => b.type === 'embed' && b.title)?.title || 'League office update';

// Seen posts (just for the unread badge; read receipts are only for posts that ask for one).
const seenKey = team => `hcl-news-seen-${team}`;
function seen(team) { try { return new Set(JSON.parse(localStorage.getItem(seenKey(team)) || '[]')); } catch { return new Set(); } }
// Posts that were new when this page first showed them stay flagged New until the page reloads.
const newThisVisit = new Set();
function markSeen(team, ids) { try { localStorage.setItem(seenKey(team), JSON.stringify([...new Set([...seen(team), ...ids])].slice(-300))); } catch { /* private mode */ } }

// Number for the News tab: things to do, plus posts this device hasn't shown yet.
export function badgeCount(ctx) {
  const todo = outstanding(ctx.season, ctx.me.team, ctx.file);
  const ids = new Set(todo.map(o => o.post.id)), s = seen(ctx.me.team);
  for (const p of postsFor(ctx.season, ctx.me.team)) if (!s.has(p.id)) ids.add(p.id);
  return ids.size;
}

// The can't-miss list of outstanding items, shown above the tabs on every tab.
export function bannerHtml(ctx) {
  const todo = outstanding(ctx.season, ctx.me.team, ctx.file);
  if (!todo.length) return '';
  const now = new Date(), anyLate = todo.some(o => o.overdue);
  return `<section class="nwb${anyLate ? ' late' : ''}" aria-label="League office: things to do">
    <div class="nwb-head"><span class="nwb-icon">📣</span><b>${todo.length === 1 ? '1 thing' : `${todo.length} things`} to do for the league office</b></div>
    <div class="nwb-list">${todo.map(o => {
      const d = o.due ? dueLabel(o.due, now) : null;
      return `<button class="nwb-row${o.overdue ? ' overdue' : ''}" data-open-post="${esc(o.post.id)}">
        <span class="nwb-title">${esc(titleOf(o.post))}</span>
        <span class="nwb-why">${o.reasons.map(r => esc(REASONS[r])).join(' · ')}</span>
        ${d ? `<span class="nw-chip due${d.overdue ? ' overdue' : ''}" data-due="${o.due.getTime()}">⏰ ${esc(d.text)}</span>` : ''}<span class="nwb-go">›</span></button>`;
    }).join('')}</div></section>`;
}

// Keep every due chip's countdown current.
export function tickDue(root = document) {
  const now = new Date();
  root.querySelectorAll('[data-due]').forEach(el => {
    const d = dueLabel(new Date(+el.dataset.due), now);
    el.textContent = `⏰ ${d.text}`;
    el.classList.toggle('overdue', d.overdue);
    el.closest('.nwb-row')?.classList.toggle('overdue', d.overdue);
  });
}

// Images uploaded in this session, shown from memory until the live site serves them.
const localImages = new Map();
const src = u => localImages.get(u) || u;

export function newsPane(pane, ctx) {
  const { season, me } = ctx, team = me.team;
  const posts = postsFor(season, team), before = seen(team);
  for (const p of posts) if (!before.has(p.id)) newThisVisit.add(p.id);
  const todo = outstanding(season, team, ctx.file), todoIds = new Set(todo.map(o => o.post.id));
  pane.innerHTML = `<div class="stack" style="gap:16px">
    <section class="card nw-intro"><h2 class="card-title" style="margin:0">League news</h2>
      <p class="muted" style="margin:0;font-size:.85rem">Announcements, forms and polls from the league office.${todo.length ? ` <b style="color:var(--text)">${todo.length} waiting for you.</b>` : ' You’re all caught up.'}</p></section>
    <div class="nw-list">${posts.map(p => renderPost(p, season, { mode: 'portal', team, teamFile: ctx.file, teamFiles: { ...ctx.teamFiles, [team]: ctx.file }, src })).join('')
      || '<section class="card"><p class="empty">No news yet. Posts from the league office will appear here.</p></section>'}</div></div>`;
  // Flag posts this device hasn't shown before, and ones still waiting for an answer.
  for (const el of pane.querySelectorAll('.nw-post')) {
    const id = el.dataset.post, meta = el.querySelector('.nw-meta');
    if (!meta) continue;
    if (todoIds.has(id)) el.classList.add('todo');
    if (newThisVisit.has(id)) meta.insertAdjacentHTML('beforeend', '<span class="nw-chip new">New</span>');
  }
  markSeen(team, posts.map(p => p.id));

  pane.onclick = async e => {
    const ack = e.target.closest('[data-ack]'), vote = e.target.closest('[data-vote]');
    if (ack) {
      await act(ack, ctx, { op: 'read', post: ack.dataset.ack }, 'Saving…');
    } else if (vote) {
      const post = posts.find(p => p.id === vote.closest('[data-post]').dataset.post);
      const poll = post?.blocks.find(b => b.type === 'poll' && b.id === vote.dataset.poll);
      const choice = poll?.options?.[+vote.dataset.option];
      if (!choice || !confirm(`Vote “${choice}”? Each team gets one vote and it can’t be changed.`)) return;
      await act(vote, ctx, { op: 'vote', post: post.id, poll: poll.id, option: +vote.dataset.option }, 'Voting…');
    }
  };
  pane.onsubmit = async e => {
    const form = e.target.closest('form.nw-form');
    if (!form) return;
    e.preventDefault();
    const post = posts.find(p => p.id === form.dataset.form);
    if (!post) return;
    if (form.querySelector('[data-uploading]')) return formMsg(form, 'Wait for the image to finish uploading.', false);
    const { answers } = readForm(form, post), errs = checkAnswers(post, answers, season, team);
    form.querySelectorAll('.nw-q').forEach(q => {
      const msg = errs[q.dataset.q], box = q.querySelector('.nw-qerr');
      q.classList.toggle('bad', !!msg);
      if (box) { box.hidden = !msg; box.textContent = msg || ''; }
    });
    if (Object.keys(errs).length) {
      formMsg(form, 'Check the answers marked in red.', false);
      form.querySelector('.nw-q.bad')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const btn = form.querySelector('button[type=submit]');
    await act(btn, ctx, { op: 'submit', post: post.id, answers }, 'Submitting…', form);
  };
  pane.onchange = async e => {
    const input = e.target.closest('input[type=file][data-upload]');
    if (input?.files?.[0]) await upload(input, ctx);
    const colour = e.target.closest('.nw-colour input[type=color]');
    if (colour) colour.nextElementSibling.textContent = colour.value;
  };
}

function formMsg(form, text, ok) {
  const m = form.querySelector('.nw-formmsg');
  if (m) { m.textContent = text; m.className = `nw-formmsg ${ok ? 'ok' : 'bad'}`; }
}

// Send one news action to the relay, then show the updated post.
async function act(btn, ctx, req, busy, form = null) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = busy;
  try {
    const out = await relaySave(ctx.season, { action: 'news', team: ctx.me.team, email: ctx.me.email, pin: ctx.me.pin, ...req });
    ctx.setNews(out.file.news || {}, out.file);
    ctx.openPost(req.post, true);
  } catch (e) {
    btn.disabled = false; btn.textContent = label;
    if (form) formMsg(form, e.message, false);
    else alert(e.message);
  }
}

// ---------- Image uploads ----------

const dataUrl = blob => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('The image couldn’t be read.')); r.readAsDataURL(blob); });
const toBlob = (canvas, type, q) => new Promise(resolve => canvas.toBlob(resolve, type, q));

// Shrink to at most MAX_IMAGE_SIDE px. Keeps PNG (transparent logos) when it fits, else WebP, then JPEG.
export async function resizeImage(file) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('That file isn’t an image this browser can open. Use a PNG, JPG or WebP.'); }
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale)); canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const tries = file.type === 'image/jpeg' ? [['image/jpeg', 0.9], ['image/jpeg', 0.75]] : [['image/png'], ['image/webp', 0.9], ['image/webp', 0.75], ['image/jpeg', 0.8]];
  for (const [type, q] of tries) {
    const blob = await toBlob(canvas, type, q);
    if (blob && UPLOAD_TYPES.includes(blob.type) && blob.size <= MAX_UPLOAD_BYTES) return blob;
  }
  throw new Error('That image is too detailed to upload. Try a simpler or smaller one.');
}

async function upload(input, ctx) {
  const box = input.closest('.nw-upload'), msg = box.querySelector('.nw-upmsg'), hidden = box.querySelector('input[type=hidden]');
  const form = input.closest('form.nw-form'), qid = input.dataset.upload;
  box.dataset.uploading = '1';
  msg.textContent = 'Resizing…'; msg.className = 'nw-muted nw-small nw-upmsg';
  try {
    const blob = await resizeImage(input.files[0]);
    msg.textContent = 'Uploading…';
    const data = (await dataUrl(blob)).split(',')[1];
    const out = await relaySave(ctx.season, { action: 'upload', team: ctx.me.team, email: ctx.me.email, pin: ctx.me.pin, post: form.dataset.form, question: qid, data });
    const url = URL.createObjectURL(blob);
    localImages.set(out.path, url);
    hidden.value = out.path;
    const old = box.querySelector('.nw-upimg');
    old.outerHTML = `<img class="nw-upimg" src="${esc(url)}" alt="">`;
    msg.textContent = '✓ Uploaded. Press the button below to send your answers.'; msg.className = 'nw-small nw-upmsg ok';
  } catch (e) {
    msg.textContent = e.message; msg.className = 'nw-small nw-upmsg bad';
  } finally {
    delete box.dataset.uploading;
    input.value = '';
  }
}
