/*
 * App state: settings persistence (in .obsidian/*.json inside the vault),
 * the vault index cache, note content cache, and workspace model.
 */
import { ipc } from './ipc.js';
import { bus } from './dom.js';
import { resolveTarget, isImage } from '../shared/links.cjs';

export const settings = {
  appearance: {
    theme: 'dark',
    accent: '#9d7cff',
    fontSize: 15,
    readable: true,
  },
  app: {
    editor: {
      defaultViewMode: 'live',     // live | reading
      lineNumbers: false,
      spellcheck: true,
      strictLineBreaks: true,      // single newline = <br> (obsidian default)
      showFrontmatter: true,
    },
    files: {
      attachmentFolder: 'attachments',
      newNoteLocation: 'root',     // root | same
      linkStyle: 'wikilink',       // wikilink | mdlink
      autoUpdateLinks: true,
      showHidden: false,
    },
    daily: {
      folder: 'Daily',
      format: 'YYYY-MM-DD',
      template: '',
      openOnStartup: false,
    },
    privacy: {
      externalLinks: 'ask',        // ask | open | block
      allowRemoteImages: false,
    },
  },
  hotkeys: {},
};

export const vault = {
  root: '',
  name: '',
  files: [],            // [{path, isFolder, mtime, size}]
  notes: {},            // path -> {links, tags, headings, aliases, title, blocks}
  backlinks: {},        // path -> [src...]
  unresolved: [],       // [[target, count]]
  byPath: new Map(),
  byName: new Map(),
};

export const noteCache = new Map(); // path -> {content, mtime}

export function resolveVaultPath(target, fromPath) {
  return resolveTarget(target, fromPath, { byPath: vault.byPath, byName: vault.byName });
}

export async function getCachedNote(path) {
  const meta = vault.byPath.get(path);
  const cached = noteCache.get(path);
  if (cached && meta && cached.mtime === meta.mtime) return cached.content;
  try {
    const content = await ipc.read(path);
    noteCache.set(path, { content, mtime: meta ? meta.mtime : Date.now() });
    return content;
  } catch {
    return null;
  }
}

export function invalidateCache(path) {
  noteCache.delete(path);
}

export function updateVaultSnapshot(snap) {
  vault.root = snap.root || vault.root;
  vault.name = snap.name || vault.name;
  vault.files = snap.files || [];
  vault.notes = snap.notes || {};
  vault.backlinks = snap.backlinks || {};
  vault.unresolved = snap.unresolved || [];
  vault.byPath = new Map();
  vault.byName = new Map();
  for (const f of vault.files) {
    vault.byPath.set(f.path, f);
    const b = f.path.split('/').pop();
    if (!vault.byName.has(b)) vault.byName.set(b, []);
    vault.byName.get(b).push(f.path);
  }
  // drop cache entries for deleted files
  for (const p of [...noteCache.keys()]) if (!vault.byPath.has(p)) noteCache.delete(p);
  bus.emit('index-updated');
}

/* ------------------------------------------------------------- settings io */

const DEFAULTS_JSON = JSON.parse(JSON.stringify(settings));

export async function loadSettings() {
  const [app, appearance, hotkeys] = await Promise.all([
    ipc.readConfig('app'),
    ipc.readConfig('appearance'),
    ipc.readConfig('hotkeys'),
  ]);
  if (app) deepMerge(settings.app, app);
  if (appearance) deepMerge(settings.appearance, appearance);
  if (hotkeys) settings.hotkeys = hotkeys;
  applyAppearance();
}

let saveTimer = null;
export function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    ipc.writeConfig('app', settings.app);
    ipc.writeConfig('appearance', settings.appearance);
    ipc.writeConfig('hotkeys', settings.hotkeys);
  }, 250);
}

function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') deepMerge(target[k], v);
    else target[k] = v;
  }
}

export function applyAppearance() {
  document.body.dataset.theme = settings.appearance.theme;
  document.body.style.setProperty('--font-size', settings.appearance.fontSize + 'px');
  document.body.style.setProperty('--accent', settings.appearance.accent);
  const soft = hexToRgba(settings.appearance.accent, 0.16);
  document.body.style.setProperty('--accent-soft', soft);
  document.body.style.setProperty('--accent-text', lightenHex(settings.appearance.accent, settings.appearance.theme === 'dark' ? 0.25 : -0.15));
  bus.emit('appearance-changed');
}

function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(157,124,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function lightenHex(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (c) => Math.min(255, Math.max(0, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  return `#${[f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

/* --------------------------------------------------------- workspace model */

export const workspace = {
  left: { open: true, size: 260, tab: 'files' },
  right: { open: true, size: 300, tab: 'backlinks' },
  // tree of splits; leaf: {type:'leaf', tabs:[Tab], active: idx, flex}
  // Tab: {type:'file'|'image'|'graph', path, mode:'live'|'reading'}
  root: { type: 'split', dir: 'row', children: [{ type: 'leaf', tabs: [], active: -1, flex: 1 }] },
  activeLeafPath: null,
};

export function newTab(path, type = 'file', mode = null) {
  const ext = path.split('.').pop().toLowerCase();
  if (type === 'file' && isImage(path)) type = 'image';
  return { type, path, mode: mode || (type === 'file' ? settings.app.editor.defaultViewMode : type) };
}

export async function loadWorkspace() {
  const ws = await ipc.readConfig('workspace');
  if (ws) {
    if (ws.left) Object.assign(workspace.left, ws.left);
    if (ws.right) Object.assign(workspace.right, ws.right);
    if (ws.root && ws.root.children && ws.root.children.length) {
      const cloned = JSON.parse(JSON.stringify(ws.root));
      if (cleanTree(cloned) && allLeavesOf(cloned).length) workspace.root = cloned;
    }
  }
}

function cleanTree(node) {
  if (node.type === 'leaf') {
    node.tabs = (node.tabs || []).filter(t => t.type === 'graph' || vault.byPath.has(t.path));
    if (node.active >= node.tabs.length) node.active = node.tabs.length - 1;
    return node.tabs.length > 0;
  }
  node.children = (node.children || []).map(cleanTree).filter(Boolean);
  return node.children.length > 0;
}
function allLeavesOf(node, out = []) {
  if (node.type === 'leaf') { out.push(node); return out; }
  for (const c of node.children || []) allLeavesOf(c, out);
  return out;
}

let wsTimer = null;
export function saveWorkspace() {
  clearTimeout(wsTimer);
  wsTimer = setTimeout(() => {
    const serialize = (node) => {
      if (node.type === 'leaf') {
        return {
          type: 'leaf',
          tabs: node.tabs.map(t => ({ type: t.type, path: t.path, mode: t.mode })),
          active: node.active, flex: node.flex || 1,
        };
      }
      return { type: 'split', dir: node.dir, children: node.children.map(serialize), flex: node.flex || 1 };
    };
    ipc.writeConfig('workspace', {
      left: { open: workspace.left.open, size: workspace.left.size, tab: workspace.left.tab },
      right: { open: workspace.right.open, size: workspace.right.size, tab: workspace.right.tab },
      root: serialize(workspace.root),
    });
  }, 300);
}

/* helpers over the index */
export function mdFiles() { return vault.files.filter(f => !f.isFolder && /\.md$/i.test(f.path)); }
export function imageFiles() { return vault.files.filter(f => !f.isFolder && isImage(f.path)); }
export function noteTitle(path) {
  const n = vault.notes[path];
  if (!n) return path.split('/').pop();
  const base = path.split('/').pop().replace(/\.(md|markdown)$/i, '');
  return n.title || base;
}
export function allTags() {
  const counts = new Map();
  for (const n of Object.values(vault.notes)) {
    for (const t of n.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
