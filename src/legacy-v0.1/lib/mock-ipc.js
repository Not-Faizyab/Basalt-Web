/*
 * Mock IPC — runs the whole app in a plain browser (demo mode) with an
 * in-memory vault. Same API surface as preload.js. Used for the hosted
 * demo and for automated UI checks; the Electron build never loads this.
 */
import { DEMO_VAULT } from './demo-vault.js';
import { scanNote, isMarkdown, baseName, resolveTarget, rewriteLinks } from '../shared/links.cjs';

const LS_KEY = 'obsidian-mock-state';
const storage = (typeof localStorage !== 'undefined')
  ? localStorage
  : { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = v; }, removeItem(k) { delete this._m[k]; } };

function loadState() {
  try { return JSON.parse(storage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
function saveState(s) { storage.setItem(LS_KEY, JSON.stringify(s)); }

class MockIpc {
  constructor() {
    const s = loadState();
    this.files = new Map();      // path -> content | null (folder)
    this.configs = s.configs || {};
    this.global = { vaults: [{ name: 'Demo vault', path: 'C:\\Users\\you\\Documents\\Demo vault', demo: true }] };
    this.listeners = { index: [], 'fs-events': [], menu: [], 'app:prepare-close': [] };
    if (s.files) for (const [p, c] of Object.entries(s.files)) this.files.set(p, c);
    else {
      for (const [p, c] of Object.entries(DEMO_VAULT)) this.files.set(p, c);
      this.files.set('attachments/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120"><rect width="320" height="120" rx="12" fill="#1e2024"/><g fill="none" stroke="#9d7cff" stroke-width="4"><path d="M60 40 44 68l16 28 16-28-16-28Z"/><path d="M110 40 94 68l16 28 16-28-16-28Z" opacity=".7"/><path d="M160 40 144 68l16 28 16-28-16-28Z" opacity=".45"/></g><text x="200" y="72" font-family="Segoe UI" font-size="22" fill="#dcdde0">obsidian</text></svg>');
    }
    this._persist();
  }
  _persist() {
    const files = {};
    for (const [p, c] of this.files) files[p] = c;
    saveState({ files, configs: this.configs });
  }

  /* ---- index ---- */
  _index() {
    const byPath = new Map(), byName = new Map(), notes = {};
    let fakeMtime = 0;
    for (const p of [...this.files.keys()].sort()) {
      const isFolder = this.files.get(p) === null;
      byPath.set(p, { isFolder, mtime: isFolder ? 0 : ++fakeMtime });
      const b = baseName(p);
      byName.set(b, [...(byName.get(b) || []), p]);
      if (!isFolder && isMarkdown(p)) {
        const n = scanNote(this.files.get(p));
        notes[p] = { links: n.links, tags: n.tags, headings: n.headings, aliases: n.aliases, title: n.title, blocks: n.blocks || [] };
      }
    }
    const backlinks = {};
    const unresolved = [];
    const unresolvedMap = new Map();
    for (const [src, note] of Object.entries(notes)) {
      for (const link of note.links) {
        if (link.embed) continue;
        const r = resolveTarget(link.target, src, { byPath, byName });
        if (r.file && r.file !== src) (backlinks[r.file] = backlinks[r.file] || []).push ? (backlinks[r.file].push(src), 0) : (backlinks[r.file] = [src]);
        else if (!r.file && link.target) unresolvedMap.set(link.target, (unresolvedMap.get(link.target) || 0) + 1);
      }
    }
    for (const [k, v] of Object.entries(backlinks)) backlinks[k] = [...new Set(v)];
    for (const [k, v] of unresolvedMap) unresolved.push([k, v]);
    return {
      root: 'C:\\Users\\you\\Documents\\Demo vault',
      name: 'Demo vault',
      files: [...byPath.entries()].map(([path, v]) => ({ path, ...v })),
      notes, backlinks, unresolved,
    };
  }
  _emitIndex() { this.listeners.index.forEach(cb => cb(this._index())); }

  onIndex(cb) { this.listeners.index.push(cb); }
  onFsEvents(cb) { this.listeners['fs-events'].push(cb); }
  onMenu(cb) { this.listeners.menu.push(cb); }
  onPrepareClose(cb) { this.listeners['app:prepare-close'].push(cb); }
  readyToClose() {}

  /* ---- app ---- */
  async appInfo() { return { version: '0.1.0', platform: 'web-demo', electron: 'n/a' }; }
  async globalGet() { return this.global; }
  async globalRemoveVault(p) { this.global.vaults = this.global.vaults.filter(v => v.path !== p); return this.global; }
  async pickFolder() { return 'C:\\Users\\you\\Documents\\New vault'; }

  async vaultOpen(path) {
    this.root = path;
    const snap = this._index();
    snap.root = path;
    snap.name = 'Demo vault';
    return snap;
  }
  async vaultCreate(parent, name) { return this.vaultOpen(parent + '\\' + name); }
  async vaultClose() { return true; }
  async vaultReveal() {}
  async openExternalPath() {}
  async openExternalUrl(url) { window.open(url, '_blank', 'noopener'); return 'opened'; }

  async listIndex() { return this._index(); }
  async read(rel) {
    if (!this.files.has(rel)) throw new Error('No such file: ' + rel);
    const c = this.files.get(rel);
    if (c === null) throw new Error('Is a folder');
    return c;
  }
  async exists(rel) { return this.files.has(rel); }
  async stat(rel) { return { mtime: Date.now(), size: (this.files.get(rel) || '').length }; }
  async write(rel, content) { this.files.set(rel, content); this._persist(); this._emitIndex(); }
  async create(rel, content = '') {
    if (this.files.has(rel)) throw new Error('File already exists');
    this.files.set(rel, content);
    this._persist(); this._emitIndex();
    return rel;
  }
  async createFolder(rel) { this.files.set(rel, null); this._persist(); this._emitIndex(); return rel; }
  async rename(oldRel, newRel) {
    let updatedLinks = 0;
    const moving = [...this.files.keys()].filter(p => p === oldRel || p.startsWith(oldRel + '/'));
    const map = new Map(moving.map(p => [p, newRel + p.slice(oldRel.length)]));
    const idx = this._index();
    const byPath = new Map(), byName = new Map();
    for (const f of idx.files) { byPath.set(f.path, f); byName.set(baseName(f.path), [...(byName.get(baseName(f.path)) || []), f.path]); }
    if (isMarkdown(oldRel)) {
      for (const [p, content] of this.files) {
        if (!isMarkdown(p) || map.has(p)) continue;
        const { content: newC, count } = rewriteLinks(content, oldRel, newRel, { byPath, byName });
        if (count) { this.files.set(p, newC); updatedLinks += count; }
      }
    }
    for (const [from, to] of map) this.files.set(to, this.files.get(from));
    for (const from of map.keys()) this.files.delete(from);
    this._persist(); this._emitIndex();
    return { updatedLinks };
  }
  async remove(rel) {
    for (const p of [...this.files.keys()]) if (p === rel || p.startsWith(rel + '/')) this.files.delete(p);
    this._persist(); this._emitIndex();
    return true;
  }
  async move(oldRel, newRel) { return this.rename(oldRel, newRel).then(r => r.updatedLinks); }

  async search(query, opts = {}) {
    const { caseSensitive = false, regex = false, wholeWord = false } = opts;
    let re;
    if (regex) re = new RegExp(query, caseSensitive ? 'g' : 'gi');
    else {
      const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp(wholeWord ? `\\b${esc}\\b` : esc, caseSensitive ? 'g' : 'gi');
    }
    const results = []; let total = 0;
    for (const [p, content] of this.files) {
      if (!isMarkdown(p)) continue;
      const lines = content.split('\n');
      const matches = [];
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        const m = re.exec(lines[i]);
        if (!m) continue;
        matches.push({ line: i + 1, col: m.index, text: lines[i], context: lines[i].slice(Math.max(0, m.index - 36), m.index + query.length + 48) });
        total++;
      }
      if (matches.length) results.push({ path: p, count: matches.length, matches });
    }
    results.sort((a, b) => b.count - a.count);
    return { results, total };
  }

  async readConfig(name) { return this.configs[name] || null; }
  async writeConfig(name, obj) { this.configs[name] = obj; this._persist(); return true; }
}

export const mockIpc = new MockIpc();
