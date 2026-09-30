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

async function ping() {
  if (document.hidden) return;
  try {
    const res = await fetch(url(), { cache: 'no-store' });
    const out = await res.json();
    publish(out.ok && Number.isFinite(out.site) ? { site: out.site, matches: out.matches || {} } : null);
  } catch { publish(null); }   // relay not set up for counting yet, or offline
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
