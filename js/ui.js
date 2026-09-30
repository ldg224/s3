// Shared rendering helpers.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
export const $ = s => document.querySelector(s);

export const safeColour = c => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c || '') ? c : '#475569');
export const logoPath = (code, alt = false) => `assets/teams/${String(code).toLowerCase()}${alt ? '-alt' : ''}.png`;

// Team logo on a transparent background. The coloured initials badge only appears if the image is missing.
export function logo(team, size = 38) {
  const code = team?.code || '?';
  return `<span style="--s:${size}px;--c:${esc(safeColour(team?.colour))};position:relative;display:inline-grid;place-items:center;width:${size}px;height:${size}px;flex:none">`
    + `<img class="logo" src="${esc(logoPath(code))}" alt="" style="width:100%;height:100%" onerror="this.nextElementSibling.hidden=false;this.remove()">`
    + `<span class="logo-fallback" style="width:100%;height:100%" hidden>${esc(code.slice(0, 3))}</span></span>`;
}

const dfmt = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
const tfmt = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' });
export const fmtDate = d => (d ? dfmt.format(d) : 'Date TBA');
export const fmtTime = d => (d ? tfmt.format(d) : 'TBA');
// 'Today', 'Tomorrow', 'Yesterday' or a short date.
export function dayLabel(d, now = new Date()) {
  if (!d) return 'Date TBA';
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400000);
  return { 0: 'Today', 1: 'Tomorrow', [-1]: 'Yesterday' }[diff] || fmtDate(d);
}

export function countdown(target, now = new Date()) {
  const ms = target - now;
  if (ms <= 0) return 'Kicking off';
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return 'Kick-off in ' + [d && `${d}d`, (d || h) && `${h}h`, `${m % 60}m`].filter(Boolean).join(' ');
}

export const STATUS = {
  upcoming: { label: 'Upcoming', colour: 'var(--upcoming)' },
  live: { label: 'Live', colour: 'var(--live)' },
  ft: { label: 'Full time', colour: 'var(--final)' },
  awaiting: { label: 'Result pending', colour: 'var(--draw)' },
  tba: { label: 'Unconfirmed', colour: 'var(--loss)' },
  postponed: { label: 'Postponed', colour: 'var(--loss)' },
};
export function statusPill(st) {
  const s = STATUS[st] || STATUS.tba;
  return `<span class="pill pill-${STATUS[st] ? st : 'tba'}" style="--pc:${s.colour}">${st === 'live' ? '<span class="pulse"></span>' : ''}${s.label}</span>`;
}

// Saved timestamps are UTC without a zone ("2026-09-29T07:26:48"); read them as UTC.
export const parseStamp = s => (s ? new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`) : null);

// A team colour made light enough to read as text on the dark background.
export function textColour(hex) {
  const c = safeColour(hex).slice(1);
  const n = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
  let [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255];
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum >= 0.42) return safeColour(hex);
  const t = Math.min(0.75, (0.5 - lum) / (1 - lum) + 0.15);   // blend towards white
  [r, g, b] = [r, g, b].map(v => Math.round(v + (255 - v) * t));
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// Text colour with enough contrast on a team colour.
export function onColour(hex) {
  const c = safeColour(hex).slice(1);
  const n = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
  return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) >= 128 ? '#0f1115' : '#ffffff';
}

export function matchUrl(fx) { return `match.html?id=${encodeURIComponent(fx.id)}`; }
