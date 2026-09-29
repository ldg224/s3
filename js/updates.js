// "The league has been updated" popup for everyone viewing the site.
// Checks the live season file every minute (and whenever the tab comes back into view);
// when its `updated` stamp changes, a banner slides in at the top with a Refresh button.
// The editor who made the change doesn't see it: edit mode updates their page directly.

import { SEASON_FILE } from './config.js';

const EVERY = 60 * 1000;
const LINES = [
  'Fresh from the league office. Take a look!',
  'Something’s changed. Don’t miss it!',
  'New league news is in. Catch up now!',
];
let known = null, shown = false;

async function latestStamp() {
  const res = await fetch(`${SEASON_FILE}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return (await res.json()).updated || null;
}

function show() {
  if (shown) return;
  shown = true;
  const bar = document.createElement('div');
  bar.className = 'update-toast';
  bar.setAttribute('role', 'status');
  bar.innerHTML = `<span class="update-icon" aria-hidden="true">🎉</span>
    <span class="update-text"><b>The league has just been updated!</b><span>${LINES[Math.floor(Math.random() * LINES.length)]}</span></span>
    <button type="button" class="update-btn">Refresh</button>
    <button type="button" class="update-close" aria-label="Dismiss">×</button>`;
  bar.querySelector('.update-btn').onclick = () => location.reload();
  bar.querySelector('.update-close').onclick = () => { bar.classList.remove('in'); setTimeout(() => bar.remove(), 300); };
  document.body.appendChild(bar);
  requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.add('in')));
}

async function check() {
  if (shown || document.hidden) return;
  try {
    const stamp = await latestStamp();
    if (!stamp) return;
    if (known === null) { known = stamp; return; }
    // Edit mode records the stamps it publishes from this page, so the editor isn't nagged.
    if (stamp !== known && !window.hclPublished?.has(stamp)) show();
    known = stamp;
  } catch { /* offline: try again next time */ }
}

check();
setInterval(check, EVERY);
document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
