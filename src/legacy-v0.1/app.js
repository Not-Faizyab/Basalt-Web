/*
 * obsidian app bootstrap: layout, commands, hotkeys, IPC wiring, boot sequence.
 */
import { h, clear, icon, bus, fmtHotkey } from './lib/dom.js';
import { setApp, App } from './lib/app-context.js';
import { ipc, assetUrl, refreshAssetUrls } from './lib/ipc.js';
import {
  settings, vault, workspace, loadSettings, loadWorkspace, saveWorkspace, saveSettings,
  updateVaultSnapshot, mdFiles, imageFiles, applyAppearance, invalidateCache, resolveVaultPath,
} from './lib/state.js';
import { notice, modal, confirmModal } from './components/ui.js';
import { mountVaultSwitcher, mountRibbon, mountStatusbar, updateVaultChip } from './components/chrome.js';
import { mountExplorer, mountSearchPanel, mountTagsPanel } from './components/sidebar-left.js';
import { mountBacklinksPanel, mountOutlinePanel } from './components/sidebar-right.js';
import { mountLocalGraphPanel } from './components/graph-view.js';
import {
  mountWorkspace, openPath, openGraphTab, openNewTab, closeActiveTab, cycleTab,
  gotoTabNumber, splitPane, closePane, activeTab, activeLeaf, setActiveLeaf,
  handleFsEvents, remapPath, markDirty, allLeaves, activateTab,
} from './components/workspace.js';
import { openCommandPalette, openQuickSwitcher } from './components/palette.js';
import { openSettings } from './components/settings.js';
import { stripMd, baseName, joinPath } from './shared/links.cjs';

/* ============================================================== commands */

const COMMANDS = [];
function cmd(id, name, { icon: ic, hotkey, desc, run, hidden } = {}) {
  const c = { id, name, icon: ic, desc, defaultHotkey: hotkey, hotkeyLabel: hotkey ? fmtHotkey(hotkey) : '', run, hidden };
  COMMANDS.push(c);
  return c;
}

cmd('app:command-palette', 'Command palette', { icon: 'command', hotkey: 'Mod+p', run: () => openCommandPalette() });
cmd('app:quick-switcher', 'Quick switcher: open or create notes', { icon: 'switcher', hotkey: 'Mod+o', run: () => openQuickSwitcher() });
cmd('app:open-settings', 'Open settings', { icon: 'settings', hotkey: 'Mod+,', run: () => openSettings() });
cmd('app:toggle-theme', 'Toggle dark / light theme', { icon: 'sun', run: () => { settings.appearance.theme = settings.appearance.theme === 'dark' ? 'light' : 'dark'; applyAppearance(); saveSettings(); } });
cmd('app:toggle-left', 'Toggle left sidebar', { icon: 'sidebar-left', run: () => { workspace.left.open = !workspace.left.open; applyLayout(); saveWorkspace(); } });
cmd('app:toggle-right', 'Toggle right sidebar', { icon: 'sidebar-right', run: () => { workspace.right.open = !workspace.right.open; applyLayout(); saveWorkspace(); } });
cmd('view:toggle-left', 'Toggle left sidebar (view)', { hidden: true, run: () => App.runCommand('app:toggle-left') });
cmd('view:toggle-right', 'Toggle right sidebar (view)', { hidden: true, run: () => App.runCommand('app:toggle-right') });
cmd('view:toggle-right-backlinks', 'Show backlinks panel', { hidden: true, run: () => { workspace.right.open = true; workspace.right.tab = 'backlinks'; applyLayout(); saveWorkspace(); } });
cmd('panel:search', 'Search vault', { icon: 'search', hotkey: 'Mod+Shift+f', run: () => { workspace.left.open = true; workspace.left.tab = 'search'; applyLayout(); saveWorkspace(); setTimeout(() => App.focusSearch?.(), 60); } });
cmd('panel:files', 'Show file explorer', { icon: 'file', hotkey: 'Mod+Shift+e', run: () => { workspace.left.open = true; workspace.left.tab = 'files'; applyLayout(); saveWorkspace(); } });
cmd('panel:tags', 'Show tags panel', { icon: 'tag', run: () => { workspace.left.open = true; workspace.left.tab = 'tags'; applyLayout(); saveWorkspace(); } });
cmd('panel:outline', 'Show outline panel', { icon: 'list', run: () => { workspace.right.open = true; workspace.right.tab = 'outline'; applyLayout(); saveWorkspace(); } });
cmd('panel:backlinks', 'Show backlinks panel', { icon: 'link', run: () => { workspace.right.open = true; workspace.right.tab = 'backlinks'; applyLayout(); saveWorkspace(); } });
cmd('panel:local-graph', 'Show local graph', { icon: 'graph', run: () => { workspace.right.open = true; workspace.right.tab = 'graph'; applyLayout(); saveWorkspace(); } });

cmd('workspace:new-note', 'Create new note', { icon: 'new-file', hotkey: 'Mod+n', run: async () => { const p = await createNote(); if (p) openPath(p, { newTab: false }); } });
cmd('workspace:new-tab', 'Open a new empty tab', { icon: 'plus', hotkey: 'Mod+t', run: () => openNewTab() });
cmd('workspace:close-tab', 'Close current tab', { icon: 'x', hotkey: 'Mod+w', run: () => closeActiveTab() });
cmd('workspace:next-tab', 'Next tab', { hotkey: 'Mod+Tab', run: () => cycleTab(1) });
cmd('workspace:prev-tab', 'Previous tab', { hotkey: 'Mod+Shift+Tab', run: () => cycleTab(-1) });
for (let i = 1; i <= 9; i++) {
  cmd(`workspace:tab-${i}`, `Go to tab ${i === 9 ? '9 (last)' : i}`, { hotkey: `Mod+${i}`, hidden: true, run: () => gotoTabNumber(i) });
}
cmd('workspace:open-graph', 'Open graph view', { icon: 'graph', hotkey: 'Mod+g', run: () => openGraphTab() });
cmd('workspace:split-right', 'Split pane right', { icon: 'split-h', run: () => splitPane('row') });
cmd('workspace:split-down', 'Split pane down', { icon: 'split-v', run: () => splitPane('col') });
cmd('workspace:close-pane', 'Close current pane', { icon: 'x', run: () => closePane() });
cmd('workspace:rename-note', 'Rename current note…', { icon: 'pencil', hotkey: 'F2', run: () => { const t = activeTab(); if (t?.path) renameNoteModal(t.path); } });
cmd('workspace:reveal-note', 'Reveal current note in File Explorer', { icon: 'external-link', run: () => { const t = activeTab(); if (t?.path) ipc.vaultReveal(t.path); } });

cmd('editor:toggle-reading', 'Toggle reading / live preview', { icon: 'eye', hotkey: 'Mod+e', run: () => { const t = activeTab(); if (t?.ctrl?.setMode) t.ctrl.setMode(t.mode === 'reading' ? 'live' : 'reading'); } });
cmd('editor:find', 'Find in current note', { icon: 'search', hotkey: 'Mod+f', run: () => { const t = activeTab(); t?.ctrl?.find?.(); } });
cmd('editor:save', 'Save current note', { icon: 'check', hotkey: 'Mod+s', run: () => { const t = activeTab(); t?.ctrl?.flushSave?.(); } });
cmd('editor:delete-note', 'Delete current note (Recycle Bin)', { icon: 'trash', run: async () => {
  const t = activeTab();
  if (!t?.path) return;
  const ok = await confirmModal('Delete note', `"${t.path}" will be moved to the Windows Recycle Bin.`, 'Delete', true);
  if (ok) {
    try { await ipc.remove(t.path); notice(`Moved "${stripMd(baseName(t.path))}" to the Recycle Bin`); } catch (e) { notice(e.message, { type: 'error' }); }
  }
} });
cmd('editor:copy-path', 'Copy current note path', { icon: 'copy', run: () => { const t = activeTab(); if (t?.path) navigator.clipboard?.writeText(t.path); } });

cmd('daily:open', "Open today's daily note", { icon: 'calendar', hotkey: 'Mod+d', run: openDailyNote });
cmd('vault:open-switcher', 'Switch to another vault', { icon: 'vault', run: () => { ipc.vaultClose(); location.reload(); } });
cmd('vault:reload-index', 'Reload vault index', { icon: 'vault', run: async () => { const snap = await ipc.listIndex(); updateVaultSnapshot(snap); notice('Vault index reloaded'); } });
cmd('help:privacy', 'Privacy statement', { icon: 'shield', run: () => openSettings('privacy') });
cmd('help:shortcuts', 'Keyboard shortcuts', { icon: 'command', run: () => openSettings('hotkeys') });
cmd('help:about', 'About obsidian', { icon: 'info', run: () => openSettings('about') });
cmd('editor:toggle-reading-menu', 'Toggle reading view (menu)', { hidden: true, run: () => App.runCommand('editor:toggle-reading') });
cmd('editor:find-menu', 'Find in note (menu)', { hidden: true, run: () => App.runCommand('editor:find') });
cmd('panel:search-menu', 'Search vault (menu)', { hidden: true, run: () => App.runCommand('panel:search') });

function findCommand(id) { return COMMANDS.find(c => c.id === id); }

/* =============================================================== hotkeys */

let hotkeyMap = new Map();
function rebuildHotkeys() {
  hotkeyMap = new Map();
  for (const c of COMMANDS) {
    const combo = settings.hotkeys[c.id] != null ? settings.hotkeys[c.id] : c.defaultHotkey;
    if (combo) hotkeyMap.set(normalizeCombo(combo), c);
  }
}
function normalizeCombo(combo) {
  const parts = combo.split('+').map(p => p.trim());
  const key = parts[parts.length - 1].toLowerCase();
  const mods = new Set(parts.slice(0, -1).map(p => p.toLowerCase()));
  return [
    mods.has('mod') || mods.has('ctrl') || mods.has('cmd') ? 'mod' : '',
    mods.has('shift') ? 'shift' : '',
    mods.has('alt') ? 'alt' : '',
    key,
  ].filter(Boolean).join('+');
}
function eventCombo(e) {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  return [
    e.ctrlKey || e.metaKey ? 'mod' : '',
    e.shiftKey ? 'shift' : '',
    e.altKey ? 'alt' : '',
    key,
  ].filter(Boolean).join('+');
}

function installGlobalKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const inInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
    if (inInput && !e.ctrlKey && !e.metaKey) return; // typing flows to the input
    const combo = eventCombo(e);
    const c = hotkeyMap.get(combo);
    if (c) {
      e.preventDefault();
      e.stopPropagation();
      c.run();
    }
  });
}

/* ================================================================= layout */

let leftTabs = {}, rightTabs = {};
let leftBodies = {}, rightBodies = {};

function applyLayout() {
  const app = document.getElementById('app');
  app.classList.toggle('no-left', !workspace.left.open);
  app.classList.toggle('no-right', !workspace.right.open);
  document.getElementById('sidebar-left').style.width = workspace.left.size + 'px';
  document.getElementById('sidebar-right').style.width = workspace.right.size + 'px';
  for (const [id, el] of Object.entries(leftTabs)) el.classList.toggle('active', id === workspace.left.tab);
  for (const [id, el] of Object.entries(rightTabs)) el.classList.toggle('active', id === workspace.right.tab);
  for (const [id, el] of Object.entries(leftBodies)) el.classList.toggle('hidden', id !== workspace.left.tab);
  for (const [id, el] of Object.entries(rightBodies)) el.classList.toggle('hidden', id !== workspace.right.tab);
}

function mountSidebars() {
  const leftTabsEl = document.getElementById('sidebar-left-tabs');
  const leftBody = document.getElementById('sidebar-left-body');
  const rightTabsEl = document.getElementById('sidebar-right-tabs');
  const rightBody = document.getElementById('sidebar-right-body');

  leftTabs = {
    files: h('div', { class: 'sidebar-tab', title: 'Files', onclick: () => { workspace.left.tab = 'files'; applyLayout(); saveWorkspace(); } }, icon('file')),
    search: h('div', { class: 'sidebar-tab', title: 'Search', onclick: () => { workspace.left.tab = 'search'; applyLayout(); saveWorkspace(); } }, icon('search')),
    tags: h('div', { class: 'sidebar-tab', title: 'Tags', onclick: () => { workspace.left.tab = 'tags'; applyLayout(); saveWorkspace(); } }, icon('tag')),
  };
  rightTabs = {
    backlinks: h('div', { class: 'sidebar-tab', title: 'Backlinks', onclick: () => { workspace.right.tab = 'backlinks'; applyLayout(); saveWorkspace(); } }, icon('link')),
    outline: h('div', { class: 'sidebar-tab', title: 'Outline', onclick: () => { workspace.right.tab = 'outline'; applyLayout(); saveWorkspace(); } }, icon('list')),
    graph: h('div', { class: 'sidebar-tab', title: 'Local graph', onclick: () => { workspace.right.tab = 'graph'; applyLayout(); saveWorkspace(); } }, icon('graph')),
  };
  clear(leftTabsEl); leftTabsEl.append(...Object.values(leftTabs));
  clear(rightTabsEl); rightTabsEl.append(...Object.values(rightTabs));

  const filesBody = h('div', { class: 'sb-panel' });
  const searchBody = h('div', { class: 'sb-panel' });
  const tagsBody = h('div', { class: 'sb-panel' });
  leftBodies = { files: filesBody, search: searchBody, tags: tagsBody };
  clear(leftBody); leftBody.append(filesBody, searchBody, tagsBody);
  mountExplorer(filesBody);
  mountSearchPanel(searchBody);
  mountTagsPanel(tagsBody);

  const blBody = h('div', { class: 'sb-panel' });
  const olBody = h('div', { class: 'sb-panel' });
  const lgBody = h('div', { class: 'sb-panel' });
  rightBodies = { backlinks: blBody, outline: olBody, graph: lgBody };
  clear(rightBody); rightBody.append(blBody, olBody, lgBody);
  mountBacklinksPanel(blBody);
  mountOutlinePanel(olBody);
  mountLocalGraphPanel(lgBody);

  installSidebarResize('sidebar-left-resize', 'sidebar-left', workspace.left, -1);
  installSidebarResize('sidebar-right-resize', 'sidebar-right', workspace.right, 1);
}

function installSidebarResize(handleId, sidebarId, side, dir) {
  const handle = document.getElementById(handleId);
  const sidebar = document.getElementById(sidebarId);
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handle.classList.add('dragging');
    const move = (ev) => {
      const rect = sidebar.getBoundingClientRect();
      const size = dir < 0 ? ev.clientX - rect.left : rect.right - ev.clientX;
      side.size = Math.max(180, Math.min(520, size));
      sidebar.style.width = side.size + 'px';
    };
    const up = () => {
      handle.classList.remove('dragging');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      saveWorkspace();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

/* =============================================================== actions */

async function createNote(folder = null, content = '') {
  try {
    let target = folder;
    if (!target && settings.app.files.newNoteLocation === 'same') {
      const t = activeTab();
      if (t?.path?.includes('/')) target = t.path.slice(0, t.path.lastIndexOf('/'));
    }
    let name = 'Untitled.md';
    let n = 1;
    while (await ipc.exists(joinPath(target || '', name))) {
      name = `Untitled ${++n}.md`;
    }
    const path = joinPath(target || '', name);
    await ipc.create(path, content);
    invalidateCache(path);
    updateVaultSnapshot(await ipc.listIndex());
    return path;
  } catch (e) {
    notice('Could not create note: ' + e.message, { type: 'error' });
    return null;
  }
}

function renameNoteModal(path) {
  const oldName = path.split('/').pop();
  const oldDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  const input = h('input', { type: 'text', value: oldName, style: { width: '100%' } });
  const linkNote = h('div', { class: 'muted', style: { fontSize: '0.85em', marginTop: '8px' } },
    settings.app.files.autoUpdateLinks ? 'Links pointing to this note will be updated automatically.' : 'Link updating is disabled in settings.');
  const m = modal({
    title: 'Rename note',
    iconName: 'pencil',
    body: h('div', {},
      h('p', { class: 'muted', style: { marginTop: 0 } }, oldDir ? 'Folder: ' + oldDir : 'In vault root'),
      input,
      linkNote),
    footer: [
      h('button', { onclick: () => m.close() }, 'Cancel'),
      h('button', {
        class: 'primary',
        onclick: async () => {
          const newName = input.value.trim();
          m.close();
          if (!newName || newName === oldName) return;
          const newPath = oldDir + newName;
          try {
            invalidateCache(path);
            const { updatedLinks } = await ipc.rename(path, newPath);
            remapPath(path, newPath);
            notice(updatedLinks ? `Renamed — updated ${updatedLinks} link${updatedLinks === 1 ? '' : 's'}` : 'Renamed');
          } catch (e) {
            notice('Rename failed: ' + e.message, { type: 'error' });
          }
        },
      }, 'Rename'),
    ],
  });
  input.focus();
  input.select();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') m.box.querySelector('.primary').click();
    if (e.key === 'Escape') m.close();
  });
}

async function openDailyNote() {
  const d = new Date();
  const fmt = settings.app.daily.format || 'YYYY-MM-DD';
  const name = formatDate(d, fmt);
  const folder = settings.app.daily.folder || '';
  const path = folder ? folder + '/' + name + '.md' : name + '.md';
  if (vault.byPath.has(path)) {
    openPath(path, { newTab: false });
    return;
  }
  let content = '';
  const tplPath = settings.app.daily.template;
  if (tplPath && vault.byPath.has(tplPath)) {
    try {
      const tpl = await ipc.read(tplPath);
      content = tpl.replace(/\{\{date\}\}/g, formatDate(d, fmt)).replace(/\{\{title\}\}/g, name).replace(/\{\{time\}\}/g, formatDate(d, 'HH:mm'));
    } catch { /* ignore */ }
  }
  if (!content) content = `# ${name}\n\n`;
  try {
    await ipc.create(path, content);
    invalidateCache(path);
    updateVaultSnapshot(await ipc.listIndex());
    openPath(path, { newTab: false });
  } catch (e) {
    notice('Could not create daily note: ' + e.message, { type: 'error' });
  }
}

function formatDate(d, fmt) {
  const pad = (n) => String(n).padStart(2, '0');
  return fmt
    .replace('YYYY', String(d.getFullYear()))
    .replace('MM', pad(d.getMonth() + 1))
    .replace('DD', pad(d.getDate()))
    .replace('HH', pad(d.getHours()))
    .replace('mm', pad(d.getMinutes()));
}

async function saveAttachment(dataUrl, mime) {
  const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const stamp = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const name = `Pasted image ${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.${ext}`;
  const folder = settings.app.files.attachmentFolder || '';
  const path = folder ? folder + '/' + name : name;
  try {
    const base64 = dataUrl.split(',')[1] || '';
    await ipc.write(path, base64, 'base64');
    invalidateCache(path);
    updateVaultSnapshot(await ipc.listIndex());
    return name;
  } catch (e) {
    notice('Could not save image: ' + e.message, { type: 'error' });
    return null;
  }
}

async function openExternal(url) {
  try {
    const r = await ipc.openExternalUrl(url);
    if (r === 'blocked') notice('External links are blocked (see Settings → Privacy)', { type: 'warn' });
  } catch (e) {
    notice(e.message, { type: 'error' });
  }
}

function openFile(target, opts = {}) {
  if (!target) return Promise.resolve();
  let path = target;
  if (!vault.byPath.has(path)) {
    const r = resolveVaultPath(target, null);
    if (r.file) {
      path = r.file;
      if (opts.heading == null && r.heading) opts.heading = r.heading;
      if (opts.block == null && r.block) opts.block = r.block;
    } else if (!/\.md$/i.test(path)) {
      // unresolved wikilink → create the note (obsidian behavior)
      const title = stripMd(baseName(target));
      return createNote(opts.folder || null, `# ${title}\n\n`).then((p) => {
        if (p) openPath(p, { newTab: opts.ctrlKey, heading: opts.heading });
      });
    }
  }
  return openPath(path, opts);
}

/* =================================================================== boot */

let switcherCtl = null;

async function bootMainUi() {
  mountSidebars();
  applyLayout();
  mountWorkspace(document.getElementById('workspace'));
  mountStatusbar();
  updateVaultChip();
  rebuildHotkeys();
  installGlobalKeys();

  // restore tabs of every leaf
  let opened = false;
  for (const leaf of allLeaves()) {
    if (leaf.tabs.length) {
      setActiveLeaf(leaf);
      await activateTab(leaf, 0);
      opened = true;
    }
  }
  if (!opened) {
    const files = mdFiles().sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    if (files.length) await openPath(files[0].path, {});
  }
  if (settings.app.daily.openOnStartup) openDailyNote();
  notice('obsidian never makes network requests — your notes stay on this PC.', { timeout: 4500 });
}

async function openVaultAndEnter(path) {
  const snap = await ipc.vaultOpen(path);
  updateVaultSnapshot(snap);
  await loadSettings();
  await loadWorkspace();
  switcherCtl.hide();
  document.getElementById('app').classList.remove('hidden');
  await bootMainUi();
}

async function boot() {
  setApp({
    ipc, settings, vault, workspace,
    commands: COMMANDS,
    runCommand: (id) => findCommand(id)?.run(),
    openFile, openGraph: () => openGraphTab(),
    palette: openCommandPalette, switcher: openQuickSwitcher,
    notice, activeTab, markDirty,
    remapTabs: remapPath,
    createNote, renameNote: renameNoteModal,
    openTagSearch: (tag) => {
      workspace.left.open = true; workspace.left.tab = 'search';
      applyLayout(); saveWorkspace();
      setTimeout(() => App.setSearchQuery?.('#' + tag), 60);
    },
    openExternal,
    assetUrl,
    saveAttachment,
    refreshEditors: () => { for (const leaf of allLeaves()) for (const t of leaf.tabs) t.ctrl?.refresh?.(); },
    refreshExplorer: () => { /* explorer re-renders on index-updated */ },
    rebuildHotkeys,
  });
  mountRibbon();

  ipc.onIndex((snap) => {
    updateVaultSnapshot(snap);
    refreshAssetUrls(imageFiles().map(f => f.path));
  });
  ipc.onFsEvents(handleFsEvents);
  ipc.onMenu((id) => { findCommand(id)?.run(); });
  ipc.onPrepareClose(async () => {
    for (const leaf of allLeaves()) for (const t of leaf.tabs) t.ctrl?.flushSave?.();
    saveWorkspace();
    await new Promise((r) => setTimeout(r, 300));
    ipc.readyToClose();
  });

  switcherCtl = mountVaultSwitcher(openVaultAndEnterFromSwitcher);

  async function openVaultAndEnterFromSwitcher(snap) {
    if (snap) {
      updateVaultSnapshot(snap);
      await loadSettings();
      await loadWorkspace();
    }
    switcherCtl.hide();
    document.getElementById('app').classList.remove('hidden');
    await bootMainUi();
  }

  // demo mode: jump straight into the demo vault
  if (ipc.isDemo) {
    const g = await ipc.globalGet();
    const v = g.vaults?.[0];
    if (v) { await openVaultAndEnter(v.path); return; }
  }

  // auto-reopen the last vault (real app)
  const g = await ipc.globalGet();
  if (g.lastVault && !ipc.isDemo) {
    try { await openVaultAndEnter(g.lastVault); return; } catch { /* fall back to switcher */ }
  }
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif;color:#eee;background:#16171a;height:100%">Failed to start: ${String(e && e.message || e)}</div>`;
});
