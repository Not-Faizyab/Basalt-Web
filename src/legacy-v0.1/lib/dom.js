/* Tiny DOM helpers + event bus. */
import { ICON_PATHS } from './icon-paths.js';
export { ICON_PATHS };

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
export function icon(name, cls = '') {
  const d = document.createElement('span');
  d.className = 'icon ' + cls;
  d.innerHTML = ICON_PATHS[name] || ICON_PATHS.file;
  return d;
}
export function iconHtml(name, cls = 'icon') {
  return `<span class="${cls}">${ICON_PATHS[name] || ICON_PATHS.file}</span>`;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }


/* -------------------------------------------------------------------- bus */
const listeners = new Map();
export const bus = {
  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => bus.off(evt, fn);
  },
  off(evt, fn) { listeners.get(evt)?.delete(fn); },
  emit(evt, data) { listeners.get(evt)?.forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); },
};

/* ----------------------------------------------------------------- misc */
export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}
export function fmtHotkey(hk) {
  if (!hk) return '';
  return hk.split('+').map(p => p === 'Mod' ? 'Ctrl' : p === 'Cmd' ? 'Ctrl' : p).join('+');
}
