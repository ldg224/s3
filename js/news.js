// League news: posts written in edit mode, shown in the manager portals and on the public site.
// Pure rendering and rules (no DOM access at import time). Spec and data shapes: docs/NEWS.md.
//
// renderPost() returns an HTML string. Interactive bits carry data attributes for the page to
// wire up: [data-ack] "Got it", [data-vote][data-poll][data-option] poll votes, a
// <form class="nw-form" data-form="<post id>"> with [data-q="<question id>"] fields
// (image questions: <input type="file" data-upload>), and [data-due] countdowns (ms since epoch)
// that dueLabel() can refresh.

import { kickoff, ladder, finished, teamForm, resultFor, status, shownScore, byKickoff } from './data.js';
import { esc, logo, safeColour, fmtDate, fmtTime, parseStamp, matchUrl } from './ui.js';

export const BLOCK_TYPES = {
  embed: 'Embed',
  table: 'Mini table',
  fixtures: 'Fixtures',
  team: 'Team card',
  poll: 'Poll',
};

export const QUESTION_TYPES = {
  short: 'Short answer',
  long: 'Paragraph',
  number: 'Number',
  choice: 'Multiple choice',
  multi: 'Checkboxes',
  dropdown: 'Dropdown',
  checkbox: 'Yes / no tick box',
  colour: 'Colour',
  image: 'Image upload',
  date: 'Date',
  player: 'Player from the squad',
};

// Team fields a question can map to (registration forms). `type` = the question type it needs.
export const TEAM_FIELDS = {
  'team.name': { label: 'Team name', type: 'short' },
  'team.manager': { label: 'Manager name', type: 'short' },
  'team.colour': { label: 'Main colour', type: 'colour' },
  'team.colour2': { label: 'Second colour', type: 'colour' },
  'team.logo': { label: 'Logo', type: 'image' },
  'team.logo_alt': { label: 'Watermark logo (for highlights)', type: 'image' },
};

// A team's current value for a `map` field. Logos are their repo paths.
export function teamValue(season, code, map) {
  const t = (season.teams || []).find(x => x.code === code);
  if (!t || !TEAM_FIELDS[map]) return null;
  const k = map.slice(5);
  if (k === 'logo') return `assets/teams/${code.toLowerCase()}.png`;
  if (k === 'logo_alt') return `assets/teams/${code.toLowerCase()}-alt.png`;
  return t[k] ?? null;
}

export const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_UPLOAD_BYTES = 400 * 1024;
export const MAX_IMAGE_SIDE = 512;

// ---------------------------------------------------------------- posts and deadlines

const inAudience = (post, team) => !post.audience || post.audience === 'all' || (Array.isArray(post.audience) && post.audience.includes(team));
const shown = post => post.status === 'live' || post.status === 'closed';
const sentAt = post => parseStamp(post.sent)?.getTime() || 0;
const newestFirst = (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || sentAt(b) - sentAt(a);

// Live and closed posts for a team's portal: pinned first, then newest sent.
export const postsFor = (season, team) => (season.news || []).filter(p => shown(p) && inAudience(p, team)).sort(newestFirst);

// Live and closed posts for the public site (managers-only ones render as a teaser).
export const publicPosts = season => (season.news || []).filter(shown).sort(newestFirst);

// The deadline as a Date (local wall-clock, like kick-offs). No time = end of that day.
export const dueAt = post => (post?.due?.date ? kickoff({ date: post.due.date, time: post.due.time || '23:59' }) : null);

const polls = post => (post.blocks || []).filter(b => b.type === 'poll' && b.id);

// This team's entry in its team file for a post.
const entryOf = (teamFile, post) => teamFile?.news?.[post.id] || {};

// A rejected review the team hasn't answered with a newer submission.
function needsResubmit(post, team, entry) {
  const r = post.reviews?.[team];
  if (r?.status !== 'rejected') return false;
  const at = parseStamp(r.at), sub = parseStamp(entry.submitted);
  return !sub || !at || at > sub;
}

// What this team still has to do: [{ post, reasons, due, overdue }], most urgent first.
// Only live posts count. reasons: 'form' | 'resubmit' | 'ack' | 'poll'.
export function outstanding(season, team, teamFile, now = new Date()) {
  const out = [];
  for (const post of postsFor(season, team)) {
    if (post.status !== 'live') continue;
    const e = entryOf(teamFile, post), reasons = [];
    if (needsResubmit(post, team, e)) reasons.push('resubmit');
    else if (post.form?.questions?.length && !e.submitted) reasons.push('form');
    if (post.ack && !e.read) reasons.push('ack');
    if (polls(post).some(p => e.votes?.[p.id] == null)) reasons.push('poll');
    if (!reasons.length) continue;
    const due = dueAt(post);
    out.push({ post, reasons, due, overdue: !!due && now > due });
  }
  const t = x => x.due?.getTime() ?? Infinity;
  return out.sort((a, b) => b.overdue - a.overdue || t(a) - t(b) || newestFirst(a.post, b.post));
}

// "Due in 2 days", "Due in 3h 20m", "Overdue by 1 day" (and whether it's overdue).
export function dueLabel(due, now = new Date()) {
  if (!due) return { text: '', overdue: false };
  const ms = due - now, abs = Math.abs(ms), m = Math.round(abs / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  const span = d >= 2 ? `${d} days` : d === 1 ? `1 day${h % 24 ? ` ${h % 24}h` : ''}` : h ? `${h}h${m % 60 ? ` ${m % 60}m` : ''}` : `${Math.max(1, m)} min`;
  return ms >= 0 ? { text: `Due in ${span}`, overdue: false } : { text: `Overdue by ${span}`, overdue: true };
}

const whenText = d => (d ? `${fmtDate(d)}, ${fmtTime(d)}` : '');
export const dueText = post => whenText(dueAt(post));

// Whether the public site shows any poll totals (it only does once a poll has closed), i.e.
// whether it's worth loading every team's file for pollTally().
export const publicTalliesShown = posts => posts.some(p => p.status === 'closed' && p.visibility !== 'managers'
  && (p.blocks || []).some(b => b.type === 'poll' && b.results !== 'never'));

// Poll totals from every team's file: { counts: [n per option], total, mine }.
export function pollTally(poll, teamFiles = {}, team = null, postId = null) {
  const counts = (poll.options || []).map(() => 0);
  let total = 0, mine = null;
  for (const [code, f] of Object.entries(teamFiles || {})) {
    const v = postId ? f?.news?.[postId]?.votes?.[poll.id] : null;
    if (Number.isInteger(v) && v >= 0 && v < counts.length) { counts[v]++; total++; if (code === team) mine = v; }
  }
  return { counts, total, mine };
}

// ---------------------------------------------------------------- markdown

// Only http(s) links, or a page on this site.
const safeLink = u => (/^https?:\/\/[^\s"'<>]+$/i.test(u) || /^[\w-]+\.html(?:[?#][^\s"'<>]*)?$/i.test(u) ? u : null);
// Images: https URLs, or files in this repo (assets/…, data/uploads/…).
const safeImage = u => (typeof u === 'string' && (/^https:\/\/[^\s"'<>]+$/i.test(u) || /^(assets|data)\/[\w./-]+$/.test(u)) ? u : null);

function inline(s) {
  // s is already escaped. Code spans first, so their contents stay literal.
  const code = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { code.push(c); return `\u0000${code.length - 1}\u0000`; });
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const u = safeLink(url.replace(/&amp;/g, '&'));
    return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${text}</a>` : m;
  });
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+?)__/g, '<u>$1</u>')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+?)~~/g, '<s>$1</s>')
    .replace(/\|\|([^|\n]+?)\|\|/g, '<span class="nw-spoiler" tabindex="0" title="Spoiler: tap to reveal">$1</span>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${code[i]}</code>`);
}

// Discord-flavoured markdown to safe HTML. vars fill {team}, {manager} and {due}.
export function markdown(text, vars = {}) {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\{(team|manager|due)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  const lines = esc(raw).split('\n'), out = [];
  let para = [], list = null, quote = [];
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<ul>${list.map(li => `<li>${inline(li)}</li>`).join('')}</ul>`); list = null; };
  const flushQuote = () => { if (quote.length) out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`); quote = []; };
  const flush = () => { flushPara(); flushList(); flushQuote(); };
  for (const line of lines) {
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.+)$/))) { flush(); out.push(`<h${m[1].length + 2} class="nw-h">${inline(m[2])}</h${m[1].length + 2}>`); }
    else if ((m = line.match(/^&gt;\s?(.*)$/))) { flushPara(); flushList(); quote.push(m[1]); }
    else if ((m = line.match(/^\s*[-*]\s+(.+)$/))) { flushPara(); flushQuote(); (list ||= []).push(m[1]); }
    else if (!line.trim()) flush();
    else { flushList(); flushQuote(); para.push(line); }
  }
  flush();
  return out.join('');
}

// ---------------------------------------------------------------- rendering

const img = (u, src, attrs = '') => { const s = safeImage(u); return s ? `<img src="${esc(src(s))}" alt="" loading="lazy" ${attrs}>` : ''; };
const team = (season, code) => season.teams.find(t => t.code === code);

function varsFor(season, post, opts) {
  const t = opts.mode !== 'public' && opts.team ? team(season, opts.team) : null;
  return { team: t?.name || 'your team', manager: t?.manager || 'manager', due: dueText(post) || 'the deadline' };
}

function embedBlock(b, post, season, opts, vars) {
  const src = opts.src, colour = safeColour(b.colour || '#5865f2');
  const titleUrl = safeLink(b.url || '');
  const title = b.title ? (titleUrl ? `<a class="nw-title" href="${esc(titleUrl)}" target="_blank" rel="noopener noreferrer">${inline(esc(b.title))}</a>` : `<div class="nw-title">${inline(esc(b.title))}</div>`) : '';
  const authorUrl = safeLink(b.author?.url || '');
  const authorName = b.author?.name ? (authorUrl ? `<a href="${esc(authorUrl)}" target="_blank" rel="noopener noreferrer">${esc(b.author.name)}</a>` : esc(b.author.name)) : '';
  const author = authorName ? `<div class="nw-author">${img(b.author.icon, src, 'class="nw-icon"')}<span>${authorName}</span></div>` : '';
  const fields = (b.fields || []).filter(f => f.name || f.value).map(f => `<div class="nw-field${f.inline ? ' inline' : ''}"><div class="nw-fname">${inline(esc(f.name || ''))}</div><div class="nw-fvalue">${markdown(f.value, vars)}</div></div>`).join('');
  const stamp = b.timestamp ? parseStamp(post.sent) : null;
  const footerBits = [b.footer?.text ? esc(b.footer.text) : '', stamp ? esc(whenText(stamp)) : ''].filter(Boolean).join(' • ');
  const footer = footerBits ? `<div class="nw-footer">${img(b.footer?.icon, src, 'class="nw-icon"')}<span>${footerBits}</span></div>` : '';
  const buttons = (b.buttons || []).map(x => ({ ...x, u: safeLink(x.url || '') })).filter(x => x.label && x.u)
    .map(x => `<a class="nw-btn ${['primary', 'secondary', 'link'].includes(x.style) ? x.style : 'secondary'}" href="${esc(x.u)}" target="_blank" rel="noopener noreferrer">${esc(x.label)}${x.style === 'link' ? ' ↗' : ''}</a>`).join('');
  const thumb = img(b.thumbnail, src, 'class="nw-thumb"');
  return `<div class="nw-embed" style="--ec:${esc(colour)}">
    <div class="nw-embed-grid"><div class="nw-embed-main">${author}${title}${b.description ? `<div class="nw-desc">${markdown(b.description, vars)}</div>` : ''}${fields ? `<div class="nw-fields">${fields}</div>` : ''}</div>${thumb}</div>
    ${img(b.image, src, 'class="nw-image"')}${footer}${buttons ? `<div class="nw-buttons">${buttons}</div>` : ''}</div>`;
}

function tableBlock(b, season, opts) {
  const rows = ladder(season, finished(season, opts.now)).filter(r => !b.rows || r.rank <= b.rows);
  const body = rows.map(r => `<tr class="${r.team.code === opts.team && opts.mode !== 'public' ? 'me' : ''}"><td>${r.rank}</td><td><span class="nw-tm">${logo(r.team, 20)}<span>${esc(r.team.name)}</span></span></td><td>${r.p}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td><b>${r.pts}</b></td></tr>`).join('');
  return `<div class="nw-box"><div class="nw-box-title">${esc(b.title || 'League table')}</div>
    <table class="nw-table"><thead><tr><th>#</th><th>Team</th><th>P</th><th>GD</th><th>Pts</th></tr></thead><tbody>${body || '<tr><td colspan="5" class="nw-muted">No teams yet</td></tr>'}</tbody></table>
    <a class="nw-more" href="table.html">Full table ›</a></div>`;
}

function fixturesBlock(b, season, opts) {
  const now = opts.now, regular = season.fixtures.filter(f => f.home && f.away);
  let week = b.week;
  if (week === 'next' || week == null || week === '') week = [...regular].sort(byKickoff).find(f => kickoff(f) && kickoff(f) > now)?.week;
  const list = regular.filter(f => week != null && String(f.week) === String(week)).sort(byKickoff);
  const T = Object.fromEntries(season.teams.map(t => [t.code, t])), side = c => T[c] || { code: c, name: c };
  const rows = list.map(f => {
    const st = status(f, season, now), sc = shownScore(f, season, now), k = kickoff(f);
    const mid = sc ? `<b>${sc.home}–${sc.away}</b>${st === 'live' ? '<small class="nw-live">LIVE</small>' : ''}` : st === 'postponed' ? '<small>P–P</small>' : `<span>${k ? esc(fmtTime(k)) : 'TBC'}</span><small>${k ? esc(fmtDate(k)) : ''}</small>`;
    const mine = opts.mode !== 'public' && (f.home === opts.team || f.away === opts.team);
    return `<a class="nw-fx${mine ? ' me' : ''}" href="${matchUrl(f)}"><span class="h">${esc(side(f.home).name)}${logo(side(f.home), 22)}</span><span class="m">${mid}</span><span class="a">${logo(side(f.away), 22)}${esc(side(f.away).name)}</span></a>`;
  }).join('');
  const heading = b.title || (week != null ? `Week ${week} fixtures` : 'Fixtures');
  return `<div class="nw-box"><div class="nw-box-title">${esc(heading)}</div>${rows || '<p class="nw-muted">No fixtures to show.</p>'}</div>`;
}

function teamBlock(b, season, opts) {
  const t = team(season, b.team);
  if (!t) return `<div class="nw-box"><p class="nw-muted">Team ${esc(b.team || '')} not found.</p></div>`;
  const now = opts.now, row = ladder(season, finished(season, now)).find(r => r.team.code === t.code);
  const form = teamForm(season, t.code, now).map(f => resultFor(f, t.code));
  const next = season.fixtures.filter(f => (f.home === t.code || f.away === t.code) && f.home && f.away && status(f, season, now) === 'upcoming').sort(byKickoff)[0];
  const opp = next && team(season, next.home === t.code ? next.away : next.home);
  const ord = n => n + (['st', 'nd', 'rd'][((n + 90) % 100 - 10) % 10 - 1] || 'th');
  return `<div class="nw-box nw-teamcard" style="--tc:${esc(safeColour(t.colour))}">
    ${b.title ? `<div class="nw-box-title">${esc(b.title)}</div>` : ''}
    <div class="nw-teamhead">${logo(t, 48)}<div><b>${esc(t.name)}</b><span>${t.manager ? `Manager ${esc(t.manager)}` : 'No manager listed'}</span></div></div>
    <div class="nw-stats"><div><b>${row?.p ? ord(row.rank) : '–'}</b><span>Position</span></div><div><b>${row?.pts ?? 0}</b><span>Points</span></div><div><b>${row ? `${row.w}-${row.d}-${row.l}` : '0-0-0'}</b><span>W-D-L</span></div>
      <div><b class="nw-form-dots">${form.map(o => `<i class="${o}">${o}</i>`).join('') || '–'}</b><span>Form</span></div></div>
    ${next ? `<a class="nw-more" href="${matchUrl(next)}">Next: ${next.home === t.code ? 'v' : '@'} ${esc(opp?.name || '')} · ${esc(whenText(kickoff(next)))} ›</a>` : ''}</div>`;
}

function pollBlock(b, post, season, opts, entry) {
  const opt = (b.options || []).filter(o => String(o).trim());
  const closed = post.status === 'closed';
  const mine = entry.votes?.[b.id];
  const voted = Number.isInteger(mine);
  const canVote = opts.mode !== 'public' && !closed && !voted && (opts.mode === 'preview' || !!opts.team);
  const showTotals = b.results === 'never' ? false
    : opts.mode === 'public' || b.results === 'after_close' ? closed
    : closed || voted || opts.mode === 'preview';
  const tally = showTotals ? pollTally(b, opts.teamFiles, opts.team, post.id) : null;
  const rows = opt.map((o, i) => {
    const pct = tally?.total ? Math.round(tally.counts[i] / tally.total * 100) : 0;
    const isMine = voted && mine === i && opts.mode !== 'public';
    if (canVote) return `<button class="nw-opt" type="button" data-vote data-poll="${esc(b.id)}" data-option="${i}"${opts.mode === 'preview' ? ' disabled' : ''}><span class="nw-radio"></span>${esc(o)}</button>`;
    return `<div class="nw-opt result${isMine ? ' mine' : ''}">${tally ? `<span class="nw-bar" style="width:${pct}%"></span>` : ''}<span class="nw-otext">${esc(o)}${isMine ? ' <span class="nw-you">Your vote</span>' : ''}</span>${tally ? `<span class="nw-pct">${pct}% · ${tally.counts[i]}</span>` : ''}</div>`;
  }).join('');
  const note = canVote ? 'One vote per team. Votes are final.'
    : !tally ? (b.results === 'never' ? 'Results aren’t shared.' : closed ? '' : opts.mode === 'public' ? 'Results are shown when the poll closes.' : voted ? 'Results are shown when the poll closes.' : '')
    : `${tally.total} team${tally.total === 1 ? '' : 's'} voted${closed ? ' · Poll closed' : ''}`;
  return `<div class="nw-box nw-poll" data-poll-box="${esc(b.id)}"><div class="nw-box-title">📊 Poll</div><div class="nw-question">${inline(esc(b.question || ''))}</div>
    <div class="nw-opts">${rows}</div>${note ? `<p class="nw-muted nw-small">${esc(note)}</p>` : ''}</div>`;
}

// The value a question starts with: the saved answer, else the team's current value for a mapped field.
function startValue(q, entry, season, code) {
  if (entry.answers && q.id in entry.answers) return entry.answers[q.id];
  if (code && q.map && TEAM_FIELDS[q.map]) return teamValue(season, code, q.map);
  return q.type === 'multi' ? [] : q.type === 'checkbox' ? false : null;
}

function questionHtml(q, value, season, opts, disabled) {
  const dis = disabled ? ' disabled' : '', req = q.required ? ' required' : '';
  const name = `q-${esc(q.id)}`;
  const opts2 = (q.options || []).filter(o => String(o).trim());
  let input;
  switch (q.type) {
    case 'long': input = `<textarea class="nw-input" name="${name}" rows="4" maxlength="${q.maxlen || 2000}"${req}${dis}>${esc(value ?? '')}</textarea>`; break;
    case 'number': input = `<input class="nw-input" type="number" name="${name}" value="${esc(value ?? '')}"${q.min != null ? ` min="${esc(q.min)}"` : ''}${q.max != null ? ` max="${esc(q.max)}"` : ''} step="any"${req}${dis}>`; break;
    case 'choice': input = `<div class="nw-choices">${opts2.map(o => `<label class="nw-check"><input type="radio" name="${name}" value="${esc(o)}"${value === o ? ' checked' : ''}${req}${dis}><span>${esc(o)}</span></label>`).join('')}</div>`; break;
    case 'multi': input = `<div class="nw-choices">${opts2.map(o => `<label class="nw-check"><input type="checkbox" name="${name}" value="${esc(o)}"${Array.isArray(value) && value.includes(o) ? ' checked' : ''}${dis}><span>${esc(o)}</span></label>`).join('')}</div>`; break;
    case 'dropdown': input = `<select class="nw-input" name="${name}"${req}${dis}><option value="">Choose…</option>${opts2.map(o => `<option${value === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`; break;
    case 'checkbox': input = `<label class="nw-check"><input type="checkbox" name="${name}"${value === true ? ' checked' : ''}${dis}><span>Yes</span></label>`; break;
    case 'colour': {
      const c = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#8fff06';
      input = `<span class="nw-colour"><input type="color" name="${name}" value="${esc(c)}"${dis}><code>${esc(value ? c : 'not set')}</code></span>`; break;
    }
    case 'image': {
      const shownImg = value ? img(value, opts.src, 'class="nw-upimg"') : '';
      input = `<div class="nw-upload">${shownImg || '<span class="nw-upimg empty">No image yet</span>'}
        <label class="nw-btn secondary${disabled ? ' disabled' : ''}">${value ? 'Change image' : 'Choose image'}<input type="file" accept="image/png,image/jpeg,image/webp" data-upload="${esc(q.id)}" hidden${dis}></label>
        <input type="hidden" name="${name}" value="${esc(value || '')}"><span class="nw-muted nw-small nw-upmsg">PNG, JPG or WebP. Resized to ${MAX_IMAGE_SIDE}px.</span></div>`; break;
    }
    case 'date': input = `<input class="nw-input" type="date" name="${name}" value="${esc(value || '')}"${req}${dis}>`; break;
    case 'player': {
      const squad = (season.players || []).filter(p => p.team === opts.team).sort((a, b) => a.name.localeCompare(b.name));
      input = `<select class="nw-input" name="${name}"${req}${dis}><option value="">Choose a player…</option>${squad.map(p => `<option value="${esc(p.id)}"${String(value) === String(p.id) ? ' selected' : ''}>${esc(p.name)} (${esc(p.position)})</option>`).join('')}</select>`; break;
    }
    default: input = `<input class="nw-input" type="text" name="${name}" value="${esc(value ?? '')}" maxlength="${q.maxlen || 200}"${req}${dis}>`;
  }
  return `<div class="nw-q" data-q="${esc(q.id)}" data-type="${esc(q.type)}"><div class="nw-qlabel">${esc(q.label || 'Question')}${q.required ? '<span class="nw-req" title="Required">*</span>' : ''}</div>
    ${q.help ? `<div class="nw-help">${markdown(q.help, varsFor(season, {}, opts))}</div>` : ''}${input}<div class="nw-qerr" hidden></div></div>`;
}

// A read-only answer, for a submitted form that can't be edited any more.
function answerText(q, v, season) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '<span class="nw-muted">No answer</span>';
  if (q.type === 'checkbox') return v ? 'Yes' : 'No';
  if (q.type === 'multi') return esc(v.join(', '));
  if (q.type === 'colour') return `<span class="nw-swatch" style="background:${esc(safeColour(v))}"></span><code>${esc(v)}</code>`;
  if (q.type === 'player') return esc(season.players.find(p => String(p.id) === String(v))?.name || v);
  if (q.type === 'long') return esc(v).replace(/\n/g, '<br>');
  return esc(v);
}

function formBlock(post, season, opts, entry, vars) {
  const f = post.form;
  if (!f?.questions?.length) return '';
  if (opts.mode === 'public') return `<div class="nw-box nw-formnote">📝 Managers answer this in their <a href="manager.html#news/${encodeURIComponent(post.id)}">manager portal</a>.</div>`;
  const code = opts.team, live = post.status !== 'closed', review = code ? post.reviews?.[code] : null;
  const submitted = parseStamp(entry.submitted), due = dueAt(post);
  const late = submitted && due && submitted > due;
  const resubmit = code && needsResubmit(post, code, entry);
  const editable = opts.mode === 'preview' || (live && (!submitted || f.edit_after_submit || resubmit));
  let banner = '';
  if (review?.status === 'applied') banner = `<div class="nw-state ok">✓ Approved${review.note ? `: ${esc(review.note)}` : ''}</div>`;
  else if (resubmit) banner = `<div class="nw-state bad">✗ The league office asked you to change this and submit again${review.note ? `: <b>${esc(review.note)}</b>` : '.'}</div>`;
  else if (submitted) banner = `<div class="nw-state ok">✓ Submitted ${esc(whenText(submitted))}${late ? ' <span class="nw-late">late</span>' : ''}${f.review ? ' · waiting for the league office to review' : ''}</div>`;
  else if (!live) banner = '<div class="nw-state">This form is closed.</div>';
  const intro = f.intro ? `<div class="nw-desc">${markdown(f.intro, vars)}</div>` : '';
  if (!editable) {
    return `<div class="nw-box nw-formbox"><div class="nw-box-title">📝 ${f.kind === 'registration' ? 'Registration' : 'Form'}</div>${banner}${intro}
      <dl class="nw-answers">${f.questions.map(q => `<dt>${esc(q.label)}</dt><dd>${q.type === 'image' && entry.answers?.[q.id] ? img(entry.answers[q.id], opts.src, 'class="nw-upimg"') : answerText(q, entry.answers?.[q.id], season)}</dd>`).join('')}</dl></div>`;
  }
  const disabled = opts.mode === 'preview';
  const label = submitted ? (resubmit ? 'Submit again' : 'Update answers') : (f.submit || 'Submit');
  return `<div class="nw-box nw-formbox"><div class="nw-box-title">📝 ${f.kind === 'registration' ? 'Registration' : 'Form'}</div>${banner}${intro}
    <form class="nw-form" data-form="${esc(post.id)}" novalidate>${f.questions.map(q => questionHtml(q, startValue(q, entry, season, code), season, opts, disabled)).join('')}
      <div class="nw-formfoot"><button class="nw-btn primary" type="submit"${disabled ? ' disabled' : ''}>${esc(label)}</button><span class="nw-formmsg"></span></div></form></div>`;
}

function teaser(post, opts) {
  const e = (post.blocks || []).find(b => b.type === 'embed') || {};
  const link = `manager.html#news/${encodeURIComponent(post.id)}`;
  return `<article class="nw-post teaser" id="news-${esc(post.id)}" data-post="${esc(post.id)}">
    ${metaRow(post, opts)}
    <div class="nw-embed" style="--ec:${esc(safeColour(e.colour || '#5865f2'))}">
      ${e.author?.name ? `<div class="nw-author">${img(e.author.icon, opts.src, 'class="nw-icon"')}<span>${esc(e.author.name)}</span></div>` : ''}
      <div class="nw-title">${inline(esc(e.title || 'League office update'))}</div>
      <p class="nw-teasertext">🔒 For team managers. <a href="${link}">View more information in your manager portal ›</a></p></div></article>`;
}

function metaRow(post, opts) {
  const sent = parseStamp(post.sent), due = dueAt(post), now = opts.now;
  const chips = [];
  if (post.pinned) chips.push('<span class="nw-chip pin">📌 Pinned</span>');
  if (post.status === 'draft') chips.push('<span class="nw-chip">Draft</span>');
  if (post.status === 'closed') chips.push('<span class="nw-chip">Closed</span>');
  if (post.visibility === 'managers' && opts.mode !== 'public') chips.push('<span class="nw-chip">🔒 Managers only</span>');
  if (due && opts.mode !== 'public' && post.status !== 'closed') {
    const d = dueLabel(due, now);
    chips.push(`<span class="nw-chip due${d.overdue ? ' overdue' : ''}" data-due="${due.getTime()}" title="Due ${esc(whenText(due))}">⏰ ${esc(d.text)}</span>`);
  }
  return `<div class="nw-meta"><span class="nw-when">${sent ? esc(whenText(sent)) : 'Not sent yet'}</span>${chips.join('')}</div>`;
}

function ackRow(post, opts, entry) {
  if (!post.ack || opts.mode === 'public') return '';
  const read = parseStamp(entry.read);
  if (read) return `<div class="nw-ack done">✓ Got it · ${esc(whenText(read))}</div>`;
  if (post.status === 'closed') return '';
  return `<div class="nw-ack"><button class="nw-btn primary" type="button" data-ack="${esc(post.id)}"${opts.mode === 'preview' ? ' disabled' : ''}>👍 Got it</button><span class="nw-muted nw-small">Tap to let the league office know you’ve read this.</span></div>`;
}

// One post as HTML. opts: { mode: 'preview' | 'portal' | 'public', team, teamFile, teamFiles,
// now, src }. teamFiles (every team's file, by code) is only needed for poll totals.
export function renderPost(post, season, opts = {}) {
  const o = { mode: 'portal', team: null, teamFile: null, teamFiles: null, now: new Date(), src: u => u, ...opts };
  if (o.mode === 'public' && post.visibility === 'managers') return teaser(post, o);
  const entry = o.mode === 'public' ? {} : entryOf(o.teamFile, post);
  const vars = varsFor(season, post, o);
  const blocks = (post.blocks || []).map(b => {
    try {
      if (b.type === 'embed') return embedBlock(b, post, season, o, vars);
      if (b.type === 'table') return tableBlock(b, season, o);
      if (b.type === 'fixtures') return fixturesBlock(b, season, o);
      if (b.type === 'team') return teamBlock(b, season, o);
      if (b.type === 'poll') return pollBlock(b, post, season, o, entry);
    } catch (e) { return `<div class="nw-box nw-muted">This part couldn’t be shown (${esc(e.message)}).</div>`; }
    return '';
  }).join('');
  return `<article class="nw-post${post.pinned ? ' pinned' : ''}" id="news-${esc(post.id)}" data-post="${esc(post.id)}">
    ${metaRow(post, o)}${blocks || '<p class="nw-muted">Empty post.</p>'}${formBlock(post, season, o, entry, vars)}${ackRow(post, o, entry)}</article>`;
}

// ---------------------------------------------------------------- answers

// Read a rendered form's answers: { answers: { qid: value } }. Call from a page, with the form element.
export function readForm(formEl, post) {
  const answers = {};
  for (const q of post.form?.questions || []) {
    const name = `q-${q.id}`, els = [...formEl.querySelectorAll(`[name="${CSS.escape(name)}"]`)];
    if (!els.length) continue;
    if (q.type === 'multi') answers[q.id] = els.filter(e => e.checked).map(e => e.value);
    else if (q.type === 'choice') answers[q.id] = els.find(e => e.checked)?.value ?? null;
    else if (q.type === 'checkbox') answers[q.id] = !!els[0].checked;
    else if (q.type === 'number') answers[q.id] = els[0].value === '' ? null : Number(els[0].value);
    else answers[q.id] = els[0].value === '' ? null : els[0].value;
  }
  return { answers };
}

// Check answers against the questions (same rules as the relay). Returns { qid: message }.
export function checkAnswers(post, answers, season, code) {
  const errs = {};
  for (const q of post.form?.questions || []) {
    const v = answers[q.id], empty = v == null || v === '' || v === false || (Array.isArray(v) && !v.length);
    if (empty) { if (q.required) errs[q.id] = 'Please answer this.'; continue; }
    const opts = (q.options || []).filter(o => String(o).trim());
    if (['short', 'long'].includes(q.type) && String(v).length > (q.maxlen || (q.type === 'long' ? 2000 : 200))) errs[q.id] = `Keep it under ${q.maxlen || (q.type === 'long' ? 2000 : 200)} characters.`;
    if (q.type === 'number') {
      if (!Number.isFinite(v)) errs[q.id] = 'Enter a number.';
      else if (q.min != null && v < q.min) errs[q.id] = `The lowest allowed is ${q.min}.`;
      else if (q.max != null && v > q.max) errs[q.id] = `The highest allowed is ${q.max}.`;
    }
    if ((q.type === 'choice' || q.type === 'dropdown') && !opts.includes(v)) errs[q.id] = 'Pick one of the options.';
    if (q.type === 'multi' && v.some(x => !opts.includes(x))) errs[q.id] = 'Pick from the options.';
    if (q.type === 'colour' && !/^#[0-9a-f]{6}$/i.test(v)) errs[q.id] = 'Pick a colour.';
    if (q.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errs[q.id] = 'Pick a date.';
    // An image is a fresh upload, or (for a mapped logo) the team's current logo left unchanged.
    if (q.type === 'image' && !/^data\/uploads\/[a-z0-9]+\/[\w.-]+\.(png|jpg|webp)$/.test(v) && v !== teamValue(season, code, q.map)) errs[q.id] = 'Upload an image.';
    if (q.type === 'player' && !(season.players || []).some(p => String(p.id) === String(v) && p.team === code)) errs[q.id] = 'Pick a player from your squad.';
  }
  return errs;
}
