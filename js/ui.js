// Small rendering helpers shared by every page.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Sheet values go through this before being put into HTML.
export const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ESCAPES[ch]);

export function initials(name) {
  const words = String(name || '?').replace(/\b(FC|United|City)\b/gi, '').trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
}

// Team logo, falling back to a coloured initials badge if the image is missing.
export function teamBadge(team, size = 40) {
  const img = team.logo
    ? `<img src="${esc(team.logo)}" alt="" width="${size}" height="${size}" loading="lazy" onerror="this.remove()">`
    : '';
  return `<span class="badge" style="--team:${esc(team.colour)};--size:${size}px" aria-hidden="true">`
    + `<span class="badge-initials">${esc(team.unknown ? initials(team.name) : team.code)}</span>${img}</span>`;
}

const dateFmt = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' });

export const formatDate = d => (d ? dateFmt.format(d) : 'Date TBA');
export const formatTime = d => (d ? timeFmt.format(d) : '');

export function countdownText(target, now = new Date()) {
  const ms = target - now;
  if (ms <= 0) return 'Kick-off!';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

export const STATE_LABELS = {
  upcoming: 'Upcoming',
  live: 'Live',
  result: 'Full time',
  awaiting: 'Result pending',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
  tba: 'TBA',
};
