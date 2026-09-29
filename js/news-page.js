// Public League news page (news.html): every live and closed post, newest first (pinned on top).
// Managers-only posts show as a teaser that links to the manager portal. news.html#news-<id>
// scrolls to a post.

import { loadSeason } from './data.js';
import { $, esc, parseStamp } from './ui.js';
import { publicPosts, renderPost, publicTalliesShown } from './news.js';
import { loadTeamFiles } from './managers.js';

let S, teamFiles = {};

function render() {
  const posts = publicPosts(S);
  $('#news-list').innerHTML = posts.map(p => renderPost(p, S, { mode: 'public', teamFiles })).join('')
    || '<section class="card"><p class="empty">No news yet. League announcements will appear here.</p></section>';
  $('#news-count').textContent = posts.length ? `${posts.length} post${posts.length > 1 ? 's' : ''}` : '';
}

function showLinked(smooth = true) {
  const id = location.hash.match(/^#news-(.+)$/)?.[1];
  const el = id && document.getElementById(`news-${decodeURIComponent(id)}`);
  if (!el) return;
  el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

async function init() {
  try { S = await loadSeason(); } catch (e) { $('#news-list').innerHTML = `<p class="empty">Couldn't load the league news. ${esc(e.message)}</p>`; return; }
  $('#season-label').textContent = `Season ${S.season}`;
  $('#updated').textContent = S.updated ? `· Updated ${parseStamp(S.updated).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}` : '';
  render();
  showLinked(false);
  // Poll totals only show publicly once a poll has closed, so only then load every team's file.
  if (publicTalliesShown(publicPosts(S))) { teamFiles = await loadTeamFiles(S); render(); showLinked(false); }
  window.addEventListener('hashchange', () => showLinked());
  window.addEventListener('season-changed', e => { S = e.detail; render(); });
}

init();
