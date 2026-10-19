/* Shared UI helpers: safe element builder, icons, modals, toasts. */
window.MP = window.MP || {};

(function () {
  /* h('div', {class: 'x', onclick: fn}, child, 'text', [more]) – text is always inserted as text, never as HTML. */
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v; // only used with static, trusted markup (icons)
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }

  const ICONS = {
    star: '<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path fill="#f6c94f" stroke="#a8721a" stroke-width="1.2" stroke-linejoin="round" d="M12 1.8l3.05 6.6 7.2.8-5.35 4.9 1.5 7.1L12 17.6l-6.4 3.6 1.5-7.1L1.75 9.2l7.2-.8z"/></svg>',
    starPlain: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#f6c94f" stroke="#a8721a" stroke-width="1.2" stroke-linejoin="round" d="M12 1.8l3.05 6.6 7.2.8-5.35 4.9 1.5 7.1L12 17.6l-6.4 3.6 1.5-7.1L1.75 9.2l7.2-.8z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    soundOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12"/></svg>',
    soundOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 10.5V7.5a4 4 0 018 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>'
  };
  function icon(name) {
    const span = document.createElement('span');
    span.innerHTML = ICONS[name];
    return span.firstChild;
  }
  function starText(n) { return [icon('star'), ' ', String(n)]; }

  /* ---------- toasts ---------- */
  function toast(msg, kind, ms) {
    const root = document.getElementById('toasts');
    const t = h('div', { class: 'toast ' + (kind || ''), role: kind === 'error' ? 'alert' : 'status' }, msg);
    root.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || (kind === 'error' ? 6000 : 2600));
  }

  /* ---------- modal ---------- */
  let openModals = [];
  function modal(content, opts) {
    opts = opts || {};
    const box = h('div', { class: 'modal ' + (opts.className || ''), role: 'dialog', 'aria-modal': 'true' }, content);
    const backdrop = h('div', { class: 'modal-backdrop' }, box);
    const prevFocus = document.activeElement;
    function close() {
      if (!backdrop.isConnected) return;
      backdrop.remove();
      openModals = openModals.filter(function (m) { return m !== api; });
      document.removeEventListener('keydown', onKey);
      if (opts.onClose) opts.onClose();
      if (prevFocus && prevFocus.focus && prevFocus.isConnected) prevFocus.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape' && opts.dismissible !== false && openModals[openModals.length - 1] === api) close();
    }
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop && opts.dismissible !== false) close();
    });
    document.addEventListener('keydown', onKey);
    document.getElementById('modalRoot').appendChild(backdrop);
    const api = { el: box, close: close };
    openModals.push(api);
    const focusable = box.querySelector('[autofocus]') || box.querySelector('button, input, select, textarea');
    if (focusable) setTimeout(function () { focusable.focus(); }, 30);
    return api;
  }
  function closeAllModals() { openModals.slice().forEach(function (m) { m.close(); }); }

  /*
   * Confirmation dialog for teacher actions. If `typeToConfirm` is given, the user must type it
   * exactly before the action button becomes active.
   */
  function confirmDialog(o) {
    return new Promise(function (resolve) {
      let done = false;
      const okBtn = h('button', { class: 'tbtn ' + (o.danger ? 'danger solid' : 'primary'), type: 'button' }, o.okText || 'OK');
      const cancel = h('button', { class: 'tbtn', type: 'button' }, o.cancelText || 'Cancel');
      let input = null;
      if (o.typeToConfirm) {
        input = h('input', { class: 'input', type: 'text', autocomplete: 'off', 'aria-label': 'Confirmation text' });
        okBtn.disabled = true;
        input.addEventListener('input', function () { okBtn.disabled = input.value.trim() !== o.typeToConfirm; });
      }
      const body = h('div', null,
        h('h2', null, o.title),
        (Array.isArray(o.message) ? o.message : [o.message]).map(function (m) { return h('p', null, m); }),
        o.typeToConfirm ? h('div', { class: 'field' }, h('label', null, 'Type ', h('b', null, o.typeToConfirm), ' to confirm:'), input) : null,
        h('div', { class: 'actions' }, cancel, okBtn));
      const m = modal(body, { onClose: function () { if (!done) { done = true; resolve(false); } } });
      cancel.onclick = function () { m.close(); };
      okBtn.onclick = function () { if (okBtn.disabled) return; done = true; m.close(); resolve(true); };
      if (input) setTimeout(function () { input.focus(); }, 40);
    });
  }

  /* Prevents an async action from running twice while it is still in progress (double taps). */
  function once(fn) {
    let busy = false;
    return async function () {
      if (busy) return;
      busy = true;
      try { return await fn.apply(this, arguments); } finally { busy = false; }
    };
  }

  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (_) { return iso; }
  }
  function fmtDateTime(iso) {
    try { return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_) { return iso; }
  }

  /* True when the page runs inside the claude.ai artifact viewer (published web version). */
  const hosted = !!(window.claude && typeof window.claude.use === 'function');

  /*
   * Saves a file. Locally: a normal browser download. Published: the viewer's download
   * confirmation (the frame cannot download by itself). Rejects with {code} when the file was
   * not saved, e.g. 'declined' when the viewer said no, so callers never report a false success.
   */
  async function download(filename, text, type) {
    if (hosted) {
      const downloads = await window.claude.use('downloads');
      if (!downloads) throw { code: 'unavailable', message: 'Downloads are not available here.' };
      return downloads.save({ filename: filename, data: text });
    }
    const blob = new Blob([text], { type: type || 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    return { status: 'saved' };
  }

  function cardFrame(card, extra) {
    return h('div', { class: 'mcard ' + (extra || '') }, h('img', { src: card.src, alt: card.name, draggable: 'false' }));
  }

  /* Small star burst at an element, purely decorative. */
  function floatStars(target, count) {
    if (document.documentElement.classList.contains('reduce-motion')) return;
    const r = target.getBoundingClientRect();
    for (let i = 0; i < Math.min(count || 3, 6); i++) {
      const s = h('div', { class: 'float-star', html: ICONS.starPlain });
      s.style.left = (r.left + r.width / 2 - 27 + (i - (count - 1) / 2) * 36) + 'px';
      s.style.top = (r.top + r.height / 2 - 27) + 'px';
      s.style.animationDelay = (i * 0.08) + 's';
      document.body.appendChild(s);
      setTimeout(function () { s.remove(); }, 1400);
    }
  }

  function burst(container, n) {
    const b = h('div', { class: 'burst', 'aria-hidden': 'true' });
    for (let i = 0; i < (n || 14); i++) {
      const a = (Math.PI * 2 * i) / (n || 14);
      const d = 160 + Math.random() * 140;
      const s = h('i');
      s.style.setProperty('--dx', Math.cos(a) * d + 'px');
      s.style.setProperty('--dy', Math.sin(a) * d + 'px');
      s.style.animationDelay = (Math.random() * 0.15) + 's';
      b.appendChild(s);
    }
    container.appendChild(b);
    setTimeout(function () { b.remove(); }, 1600);
  }

  MP.ui = { hosted, h, icon, ICONS, starText, toast, modal, closeAllModals, confirmDialog, once, fmtDate, fmtDateTime, download, cardFrame, floatStars, burst };
})();
