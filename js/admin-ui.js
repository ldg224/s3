// Shared edit-mode UI: toasts (with Undo), confirm / text dialogs and an info dialog with copy.
// Replaces alert(), confirm() and prompt() across the admin tabs. No DOM outside document.body.

import { esc } from './ui.js';

// ---------- Toasts ----------

let tray;
function trayEl() {
  if (!tray || !tray.isConnected) {
    tray = document.createElement('div');
    tray.className = 'ed-toasts';
    tray.setAttribute('role', 'status');
    tray.setAttribute('aria-live', 'polite');
    document.body.appendChild(tray);
  }
  return tray;
}

// toast('Fixture deleted', { kind: 'ok' | 'err' | 'info', undo: fn, ms, onClose })
// With undo, the toast shows an Undo button; onClose runs once when it goes (timed out, undone or dismissed).
export function toast(text, { kind = 'info', undo = null, ms = undo ? 8000 : kind === 'err' ? 9000 : 4000, onClose = null } = {}) {
  const t = document.createElement('div');
  t.className = `ed-toast ${kind}`;
  t.innerHTML = `<span>${esc(text)}</span>${undo ? '<button class="ed-btn small" data-undo>Undo</button>' : ''}<button class="ed-toast-x" aria-label="Dismiss">✕</button>`;
  let closed = false, timer;
  const close = () => {
    if (closed) return;
    closed = true; clearTimeout(timer);
    t.classList.add('out');
    setTimeout(() => t.remove(), 200);
    onClose?.();
  };
  t.querySelector('.ed-toast-x').onclick = close;
  if (undo) t.querySelector('[data-undo]').onclick = () => { undo(); close(); toast('Undone.', { ms: 2500 }); };
  // Pause the countdown while the pointer or focus is on the toast.
  const arm = () => { clearTimeout(timer); timer = setTimeout(close, ms); };
  t.addEventListener('mouseenter', () => clearTimeout(timer));
  t.addEventListener('mouseleave', arm);
  t.addEventListener('focusin', () => clearTimeout(timer));
  t.addEventListener('focusout', arm);
  const box = trayEl();
  box.appendChild(t);
  while (box.children.length > 4) box.firstElementChild.remove();
  arm();
  return { close };
}

// ---------- Dialogs ----------

// A modal dialog with Escape to cancel, focus kept inside, and focus returned afterwards.
// build(box, done) fills the box and calls done(value); cancelling resolves with `cancelValue`.
function dialog(html, build, cancelValue) {
  return new Promise(resolve => {
    const back = document.activeElement;
    const m = document.createElement('div');
    m.className = 'ed-modal';
    m.innerHTML = `<div class="ed-box" role="dialog" aria-modal="true" aria-labelledby="ed-dlg-t">${html}</div>`;
    const box = m.firstElementChild;
    let finished = false;
    const done = v => {
      if (finished) return;
      finished = true;
      document.removeEventListener('keydown', key, true);
      m.remove();
      back?.focus?.();
      resolve(v);
    };
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(cancelValue); }
      if (e.key === 'Tab') {
        const f = [...box.querySelectorAll('button, input, textarea, select, a[href]')].filter(x => !x.disabled);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    m.addEventListener('mousedown', e => { if (e.target === m) done(cancelValue); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(m);
    build(box, done);
  });
}

// await ask({ title, text, html, ok: 'Delete', cancel: 'Cancel', danger: true }) -> true / false
// `html` is trusted markup shown under the text (escape anything user-supplied yourself).
export function ask({ title, text = '', html = '', ok = 'OK', cancel = 'Cancel', danger = false }) {
  return dialog(`<h2 id="ed-dlg-t">${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}${html ? `<div class="ed-info">${html}</div>` : ''}
    <div class="ed-row ed-dlg-actions"><button class="ed-btn" data-no>${esc(cancel)}</button><button class="ed-btn ${danger ? 'danger solid' : 'primary'}" data-yes>${esc(ok)}</button></div>`,
  (box, done) => {
    box.querySelector('[data-no]').onclick = () => done(false);
    box.querySelector('[data-yes]').onclick = () => done(true);
    (danger ? box.querySelector('[data-no]') : box.querySelector('[data-yes]')).focus();
  }, false);
}

// await askText({ title, text, label, value, placeholder, required, multiline, ok }) -> string, or null if cancelled
export function askText({ title, text = '', label = '', value = '', placeholder = '', required = false, multiline = false, ok = 'OK' }) {
  const field = multiline
    ? `<textarea class="ed-input na-area" rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : `<input class="ed-input" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
  return dialog(`<h2 id="ed-dlg-t">${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}
    <label class="ed-field">${esc(label)}${field}</label><div class="ed-err"></div>
    <div class="ed-row ed-dlg-actions"><button class="ed-btn" data-no>Cancel</button><button class="ed-btn primary" data-yes>${esc(ok)}</button></div>`,
  (box, done) => {
    const input = box.querySelector('input, textarea'), err = box.querySelector('.ed-err');
    const go = () => {
      const v = input.value.trim();
      if (required && !v) { err.textContent = 'This is required.'; input.focus(); return; }
      done(v);
    };
    box.querySelector('[data-no]').onclick = () => done(null);
    box.querySelector('[data-yes]').onclick = go;
    if (!multiline) input.onkeydown = e => { if (e.key === 'Enter') go(); };
    input.focus();
  }, null);
}

// await info({ title, html, copy }) -> shows trusted html; `copy` adds a Copy button for that text.
export function info({ title, html = '', copy = null, ok = 'Done' }) {
  return dialog(`<h2 id="ed-dlg-t">${esc(title)}</h2><div class="ed-info">${html}</div>
    <div class="ed-row ed-dlg-actions">${copy ? '<button class="ed-btn" data-copy>Copy</button>' : ''}<button class="ed-btn primary" data-yes>${esc(ok)}</button></div>`,
  (box, done) => {
    box.querySelector('[data-yes]').onclick = () => done(true);
    const c = box.querySelector('[data-copy]');
    if (c) c.onclick = async () => {
      try { await navigator.clipboard.writeText(copy); c.textContent = 'Copied ✓'; }
      catch { c.textContent = 'Copy failed; select the text'; }
    };
    box.querySelector('[data-yes]').focus();
  }, true);
}
