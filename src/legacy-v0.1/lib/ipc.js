/*
 * Renderer-side API. Uses the real Electron bridge when available,
 * otherwise falls back to the in-memory mock (demo mode).
 */
import { mockIpc } from './mock-ipc.js';

const native = typeof window !== 'undefined' ? window.obsidian : null;

async function call(fn, ...args) {
  if (native) {
    const r = await fn(...args);
    if (r && r.ok === false) throw new Error(r.error);
    return r ? r.data : undefined;
  }
  return fn.call(mockIpc, ...args);
}

export const ipc = {
  isDemo: !native,
  appInfo: (...a) => call(native?.appInfo ?? mockIpc.appInfo, ...a),
  globalGet: (...a) => call(native?.globalGet ?? mockIpc.globalGet, ...a),
  globalRemoveVault: (...a) => call(native?.globalRemoveVault ?? mockIpc.globalRemoveVault, ...a),
  pickFolder: (...a) => call(native?.pickFolder ?? mockIpc.pickFolder, ...a),

  vaultOpen: (...a) => call(native?.vaultOpen ?? mockIpc.vaultOpen, ...a),
  vaultCreate: (...a) => call(native?.vaultCreate ?? mockIpc.vaultCreate, ...a),
  vaultClose: (...a) => call(native?.vaultClose ?? mockIpc.vaultClose, ...a),
  vaultReveal: (...a) => call(native?.vaultReveal ?? mockIpc.vaultReveal, ...a),
  openExternalPath: (...a) => call(native?.openExternalPath ?? mockIpc.openExternalPath, ...a),
  openExternalUrl: (...a) => call(native?.openExternalUrl ?? mockIpc.openExternalUrl, ...a),

  listIndex: (...a) => call(native?.listIndex ?? mockIpc.listIndex, ...a),
  read: (...a) => call(native?.read ?? mockIpc.read, ...a),
  exists: (...a) => call(native?.exists ?? mockIpc.exists, ...a),
  stat: (...a) => call(native?.stat ?? mockIpc.stat, ...a),
  write: (...a) => call(native?.write ?? mockIpc.write, ...a),
  create: (...a) => call(native?.create ?? mockIpc.create, ...a),
  createFolder: (...a) => call(native?.createFolder ?? mockIpc.createFolder, ...a),
  rename: (...a) => call(native?.rename ?? mockIpc.rename, ...a),
  remove: (...a) => call(native?.remove ?? mockIpc.remove, ...a),
  move: (...a) => call(native?.move ?? mockIpc.move, ...a),

  search: (...a) => call(native?.search ?? mockIpc.search, ...a),

  readConfig: (...a) => call(native?.readConfig ?? mockIpc.readConfig, ...a),
  writeConfig: (...a) => call(native?.writeConfig ?? mockIpc.writeConfig, ...a),

  onIndex: (cb) => (native ? native.onIndex(cb) : mockIpc.onIndex(cb)),
  onFsEvents: (cb) => (native ? native.onFsEvents(cb) : mockIpc.onFsEvents(cb)),
  onMenu: (cb) => (native ? native.onMenu(cb) : mockIpc.onMenu(cb)),
  onPrepareClose: (cb) => (native ? native.onPrepareClose(cb) : mockIpc.onPrepareClose(cb)),
  readyToClose: () => (native ? native.readyToClose() : mockIpc.readyToClose()),
};

/* Vault asset → displayable URL (sync; Electron uses the app:// protocol,
 * demo mode pre-resolves assets to data URLs in refreshAssetUrls). */
const assetUrlCache = new Map();
export function assetUrl(path) {
  if (native) return 'app://vault/' + encodeURI(path);
  return assetUrlCache.get(path) || 'data:,';
}
export async function refreshAssetUrls(paths) {
  if (native) return;
  for (const p of paths) {
    if (assetUrlCache.has(p)) continue;
    try {
      const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
      if (ext === '.svg') {
        const text = await mockIpc.read(p);
        assetUrlCache.set(p, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text));
      }
    } catch { /* ignore */ }
  }
}
