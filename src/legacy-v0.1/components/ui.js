/* UI primitives: notices/toasts, modals, context menus, tooltips, fuzzy modal. */
import { h, clear, icon, bus } from '../lib/dom.js';
import { fuzzyRank, highlight } from '../lib/fuzzy.js';

/* --------------------------------------------------------------- notices */
export function notice(msg, opts = {}) {
  const el = h('div', { class: 'notice ' + (opts.type || '') }, h('span', {}, msg));
  let timer = null;
  const dismiss = () => { clearTimeout(timer); el.remove(); };
  if (opts.actions && opts.actions.length) {
    el.append(h('div', { class: 'notice-actions' },
      opts.actions.map(a => h('button', { onclick: () => { a.run?.(); dismiss(); } }, a.label))));
  }
  document.getElementById('notices').append(el);
  el.addEventListener('click', (e) => { if (e.target === el) dismiss(); });
  timer = setTimeout(dismiss, opts.timeout || (opts.actions ? 10000 : 3600));
  return dismiss;
}

/* ---------------------------------------------------------------- modal */
export function modal({ title, iconName, body, footer, onClose, width }) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const box = h('div', { class: 'modal', style: width ? { minWidth: width + 'px' } : {} },
    h('div', { class: 'modal-header' }, iconName ? icon(iconName) : null, h('span', {}, title)),
    h('div', { class: 'modal-body' }, body),
    footer ? h('div', { class: 'modal-footer' }, footer) : null,
  );
  backdrop.append(box);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  const close = () => { backdrop.remove(); onClose?.(); };
  document.getElementById('overlays').append(backdrop);
  return { el: backdrop, close, box };
}

export function confirmModal(title, message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title,
      body: h('p', { style: { margin: '4px 0', lineHeight: '1.55' } }, message),
      footer: [
        h('button', { onclick: () => { done = true; m.close(); resolve(false); } }, 'Cancel'),
        h('button', { class: danger ? 'danger' : 'primary', onclick: () => { done = true; m.close(); resolve(true); } }, okLabel),
      ],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

/* --------------------------------------------------------- context menu */
let openMenu = null;
export function contextMenu(x, y, items) {
  closeMenu();
  const menu = h('div', { class: 'ctx-menu' });
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { menu.append(h('div', { class: 'menu-sep' })); continue; }
    const row = h('div', { class: 'menu-item' + (it.danger ? ' danger' : '') },
      it.icon ? icon(it.icon) : h('span', { style: { width: '16px' } }),
      h('span', {}, it.label),
      it.kbd ? h('span', { class: 'kbd' }, it.kbd) : null,
    );
    row.addEventListener('click', () => { closeMenu(); it.run?.(); });
    menu.append(row);
  }
  document.getElementById('overlays').append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
  openMenu = menu;
  setTimeout(() => {
    window.addEventListener('mousedown', onDocDown, { once: true });
  });
}
function onDocDown(e) {
  if (openMenu && !openMenu.contains(e.target)) closeMenu();
  else if (openMenu) window.addEventListener('mousedown', onDocDown, { once: true });
}
export function closeMenu() {
  if (openMenu) { openMenu.remove(); openMenu = null; }
  window.removeEventListener('mousedown', onDocDown);
}

/* --------------------------------------------------------------- tooltip */
export function attachTooltip(el, text) {
  el.addEventListener('mouseenter', () => {
    const tip = document.getElementById('tooltip');
    tip.textContent = text;
    tip.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    tip.style.left = Math.min(r.left, window.innerWidth - 360) + 'px';
    tip.style.top = (r.bottom + 6) + 'px';
  });
  el.addEventListener('mouseleave', () => document.getElementById('tooltip').classList.add('hidden'));
}

/* ---------------------------------------------------------- fuzzy modal */
/* ------------------------------------------------------------------ */
let openFuzzy = null; // at most one fuzzy modal at a time

export function fuzzyModal({ placeholder = 'Type…', items, emptyText = 'No matches', onRun, onInput, footerHints = true, iconOf }) {
  if (openFuzzy) openFuzzy.close();
  let list = items.map(it => ({ item: it, score: 0, positions: [] }));
  let selected = 0;

  const input = h('input', { type: 'text', placeholder, autocomplete: 'off', spellcheck: 'false' });
  const listBox = h('div', { class: 'fuzzy-list' });
  const box = h('div', { class: 'modal fuzzy-box', style: { minWidth: '0', overflow: 'hidden' } },
    h('div', { style: { padding: '10px 12px 6px' } }, input),
    listBox,
  );
  const backdrop = h('div', { class: 'modal-backdrop' });
  backdrop.style.paddingTop = '10vh';
  backdrop.append(box);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });

  const hints = footerHints ? h('div', { class: 'row', style: { padding: '8px 14px', fontSize: '0.8em', color: 'var(--text-faint)', borderTop: '1px solid var(--border-soft)' } },
    h('span', { class: 'kbd' }, '↑↓'), h('span', {}, 'navigate'), h('span', { class: 'kbd' }, '↵'), h('span', {}, 'open'),
    h('span', { class: 'kbd' }, 'Ctrl+↵'), h('span', {}, 'open in new tab'), h('span', { class: 'kbd' }, 'Esc'), h('span', {}, 'dismiss')) : null;
  if (hints) box.append(hints);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    backdrop.remove();
    if (openFuzzy && openFuzzy.close === close) openFuzzy = null;
    onInput?.(null);
  }
  openFuzzy = { close };

  function render() {
    clear(listBox);
    if (!list.length) {
      listBox.append(h('div', { class: 'fuzzy-empty' }, emptyText));
      onInput?.(input.value, list, listBox);
      return;
    }
    const max = Math.min(list.length, 40);
    if (selected >= max) selected = max - 1;
    for (let i = 0; i < max; i++) {
      const { item, positions } = list[i];
      const row = h('div', { class: 'fuzzy-item' + (i === selected ? ' selected' : '') },
        iconOf ? iconOf(item) : (item.icon ? icon(item.icon) : null),
        h('div', { class: 'fuzzy-main' },
          h('span', { class: 'fuzzy-title', html: highlight(item.text, positions) }),
          item.sub ? h('span', { class: 'fuzzy-sub' }, item.sub) : null),
        item.right ? h('span', { class: 'fuzzy-right' }, item.right) : null,
      );
      // NOTE: no DOM re-render on hover — only class toggling, so clicks stay reliable
      row.addEventListener('mousemove', () => {
        if (selected !== i) {
          const prev = listBox.children[selected];
          if (prev) prev.classList.remove('selected');
          selected = i;
          row.classList.add('selected');
          row.scrollIntoView({ block: 'nearest' });
        }
      });
      row.addEventListener('mousedown', (e) => { e.preventDefault(); });
      row.addEventListener('click', (e) => { selected = i; run({ ctrlKey: e.ctrlKey || e.metaKey }); });
      listBox.append(row);
    }
    listBox.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
    onInput?.(input.value, list, listBox);
  }

  function run(e) {
    const entry = list[selected];
    if (!entry) return;
    const keepOpen = onRun?.(entry.item, { ctrlKey: e.ctrlKey || e.metaKey, close });
    if (!keepOpen) close();
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    list = q ? fuzzyRank(q, items) : items.map(it => ({ item: it, score: 0, positions: [] }));
    selected = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(selected + 1, list.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(selected - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(e); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });

  document.getElementById('overlays').append(backdrop);
  render();
  input.focus();
  return { close, input };
}
