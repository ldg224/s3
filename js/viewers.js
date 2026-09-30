// Live viewer counts. Every public page checks in with the manager relay (the Google Apps Script in
// tools/manager-relay.gs, action "ping") every 30 seconds while the tab is in view. The relay keeps
// who checked in during the last 75 seconds and answers with { site, matches: { <fixture id>: n } }.
// Pages listen for the 'viewers' event (detail = those counts, or null when unavailable); the
// latest counts are also in window.hclViewers. Edit mode isn't counted.

import { loadSeason } from './data.js';

const EVERY = 30 * 1000;
let relay = null, timer = null, id = null;

function viewerId() {
  try {
    let v = sessionStorage.getItem('hcl-viewer');
    if (!v) { v = Math.random().toString(36).slice(2, 12); sessionStorage.setItem('hcl-viewer', v); }
    return v;
  } catch { return Math.random().toString(36).slice(2, 12); }
}
// The match this tab is watching (match page only).
const matchId = () => (/match\.html$/.test(location.pathname) ? new URLSearchParams(location.search).get('id') || '' : '');
const url = extra => `${relay}?action=ping&id=${encodeURIComponent(id)}&m=${encodeURIComponent(matchId())}${extra || ''}`;

function publish(counts) {
  window.hclViewers = counts;
  window.dispatchEvent(new CustomEvent('viewers', { detail: counts }));
}

// Apps Script now and then answers with a Google "Page not found" page instead of the script's
// reply, so a failed ping is retried a couple of times, and the last good counts stay up until
// pings have been failing for two minutes.
let lastGood = 0;
async function ping() {
  if (document.hidden) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url(), { cache: 'no-store' });
      const out = await res.json();
      if (out.ok && Number.isFinite(out.site)) { lastGood = Date.now(); return publish({ site: out.site, matches: out.matches || {} }); }
      if (out.ok) break;   // an older relay without viewer counts: don't keep asking
    } catch { /* Google's error page, or offline */ }
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
  }
  if (Date.now() - lastGood > 2 * 60 * 1000) publish(null);
}

export async function startViewers() {
  if (relay !== null || document.body?.classList.contains('admin-page') || /admin\.html$/.test(location.pathname)) return;
  relay = '';
  try { relay = (await loadSeason()).manager_relay || ''; } catch { return; }
  if (!/^https:\/\/script\.google\.com\//.test(relay)) return;
  id = viewerId();
  ping();
  timer = setInterval(ping, EVERY);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) navigator.sendBeacon?.(url('&leave=1'));   // stop counting this tab straight away
    else ping();
  });
  window.addEventListener('pagehide', () => navigator.sendBeacon?.(url('&leave=1')));
}

// "👁 12 watching" (or '' while counts are unavailable).
export function viewerBadge(n, label = 'watching') {
  return Number.isFinite(n) && n > 0 ? `<span class="viewers" title="People on this right now"><span class="viewers-eye" aria-hidden="true">👁</span> ${n} ${label}</span>` : '';
}
