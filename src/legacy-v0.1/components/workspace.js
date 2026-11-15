/*
 * Workspace: recursive split panes, tab groups, view hosting.
 * Tab: { type: 'file'|'image'|'graph', path, mode: 'live'|'reading', ctrl (controller) }
 */
import { h, clear, icon, bus } from '../lib/dom.js';
import { App } from '../lib/app-context.js';
import { workspace, newTab, saveWorkspace, settings, vault, getCachedNote, invalidateCache } from '../lib/state.js';
import { contextMenu, attachTooltip, notice } from './ui.js';
import { isImage, isMarkdown } from '../shared/links.cjs';

const TAB_ICON = { file: 'file-md', image: 'file-img', graph: 'graph' };

export function mountWorkspace(el) {
  render();
  bus.on('index-updated', () => { renderTabTitles(); pruneMissingTabs(); });
}

function render() {
  const host = clear(document.getElementById('workspace'));
  host.classList.add('pane-root');
  host.append(renderNode(workspace.root));
  // re-attach every leaf's active tab DOM (render rebuilt the containers)
  for (const leaf of allLeaves()) {
    if (leaf._el && leaf.active >= 0 && leaf.tabs[leaf.active]) {
      const tab = leaf.tabs[leaf.active];
      if (tab.ctrl) {
        if (!tab._dom) tab._dom = tab.ctrl.dom();
        const content = leaf._el.querySelector('.pane-content');
        const emptyEl = content.querySelector('.workspace-empty');
        if (emptyEl) emptyEl.remove();
        content.append(tab._dom);
        tab._dom.classList.remove('hidden');
      }
    }
  }
}

function renderNode(node) {
  if (node.type === 'split') {
    const div = h('div', { class: 'pane-split pane-' + node.dir });
    const children = node.children;
    children.forEach((child, i) => {
      const childEl = renderNode(child);
      childEl.style.flex = (child.flex || 1);
      div.append(childEl);
      if (i < children.length - 1) {
        const divider = h('div', { class: 'pane-divider pane-' + node.dir });
        attachDividerDrag(divider, div, children, i, node.dir);
        div.append(divider);
      }
    });
    return div;
  }
  return renderLeaf(node);
}

function attachDividerDrag(divider, container, children, idx, dir) {
  divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    divider.classList.add('dragging');
    const total = dir === 'row' ? container.getBoundingClientRect().width : container.getBoundingClientRect().height;
    const a = children[idx], b = children[idx + 1];
    const move = (ev) => {
      const rect = container.getBoundingClientRect();
      const pos = dir === 'row' ? ev.clientX - rect.left : ev.clientY - rect.top;
      const frac = Math.max(0.1, Math.min(0.9, pos / total));
      const sum = (a.flex || 1) + (b.flex || 1);
      a.flex = frac * sum;
      b.flex = (1 - frac) * sum;
      const els = container.children;
      // children alternate: [child, divider, child, divider...]
      const elA = els[idx * 2], elB = els[idx * 2 + 2];
      if (elA) elA.style.flex = a.flex;
      if (elB) elB.style.flex = b.flex;
    };
    const up = () => {
      divider.classList.remove('dragging');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      saveWorkspace();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

function renderLeaf(leaf) {
  const el = h('div', {
    class: 'pane-leaf' + (leaf === activeLeaf() ? ' active' : ''),
    onmousedown: () => setActiveLeaf(leaf),
  });
  leaf._el = el;

  const tabbar = h('div', { class: 'tabbar' });
  const content = h('div', { class: 'pane-content' });
  el.append(tabbar, content);
  renderLeafTabs(leaf, tabbar, content);
  if (leaf.tabs.length === 0) showEmpty(content, leaf);
  return el;
}

function showEmpty(content, leaf) {
  content.append(h('div', { class: 'workspace-empty' },
    h('div', { class: 'big' }, 'No file is open'),
    h('div', {}, 'Create a note or open something from your vault'),
    h('div', { class: 'hint' },
      h('button', { onclick: () => App.runCommand('workspace:new-note') }, icon('new-file'), ' New note'),
      h('button', { onclick: () => App.runCommand('app:quick-switcher') }, icon('switcher'), ' Quick switcher'),
      h('button', { onclick: () => App.runCommand('app:command-palette') }, icon('command'), ' Commands'),
    ),
  ));
}

function renderLeafTabs(leaf, tabbar, content) {
  clear(tabbar);
  leaf.tabs.forEach((tab, i) => {
    const title = tabTitle(tab);
    const closeBtn = h('span', { class: 'tab-close', onclick: (e) => { e.stopPropagation(); closeTab(leaf, i); } }, icon('x'));
    const t = h('div', {
      class: 'tab' + (i === leaf.active ? ' active' : ''),
      onclick: (e) => { setActiveLeaf(leaf); activateTab(leaf, i); },
      onmousedown: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(leaf, i); } },
      oncontextmenu: (e) => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [
          { label: 'Close tab', icon: 'x', run: () => closeTab(leaf, i) },
          { label: 'Close other tabs', icon: 'x', run: () => { leaf.tabs = [tab]; leaf.active = 0; rebuild(); } },
          { label: 'Close all tabs', icon: 'x', run: () => { leaf.tabs.forEach(t => t.ctrl?.destroy?.()); leaf.tabs = []; leaf.active = -1; rebuild(); } },
          { sep: true },
          ...(tab.type !== 'graph' ? [
            { label: 'Reveal in File Explorer', icon: 'external-link', run: () => App.ipc.vaultReveal(tab.path) },
            ...(tab.type === 'file' ? [{ label: 'Rename…', icon: 'pencil', run: () => App.renameNote(tab.path) }] : []),
          ] : []),
        ]);
      },
    },
      icon(TAB_ICON[tab.type] || 'file'),
      h('span', { class: 'tab-title' }, title),
      tab._dirty ? h('span', { class: 'dirty-dot' }) : closeBtn,
    );
    tabbar.append(t);
  });
  tabbar.append(h('span', { class: 'spacer' }),
    h('span', {
      class: 'icon-btn', onclick: () => setActiveLeaf(leaf) || App.runCommand('workspace:new-note'),
      oncontextmenu: (e) => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [
          { label: 'New note', icon: 'new-file', run: () => { setActiveLeaf(leaf); App.runCommand('workspace:new-note'); } },
          { label: 'Split right', icon: 'split-h', run: () => { setActiveLeaf(leaf); App.runCommand('workspace:split-right'); } },
          { label: 'Split down', icon: 'split-v', run: () => { setActiveLeaf(leaf); App.runCommand('workspace:split-down'); } },
          { label: 'Close pane', icon: 'x', run: () => { setActiveLeaf(leaf); App.runCommand('workspace:close-pane'); } },
        ]);
      },
    }, icon('plus')));
}

function tabTitle(tab) {
  if (tab.type === 'graph') return 'Graph';
  return (tab.path.split('/').pop() || 'Untitled').replace(/\.(md|markdown)$/i, '');
}

async function activateTab(leaf, i) {
  leaf.active = i;
  const tab = leaf.tabs[i];
  if (!tab) { rebuild(); saveWorkspace(); return; }
  if (!tab.ctrl) tab.ctrl = await createController(tab, leaf);
  render(); // rebuilds containers + re-attaches active tab DOM (incl. this one)
  tab.ctrl.focus?.();
  saveWorkspace();
  bus.emit('tab-activated', tab);
}
export { activateTab };

export async function openPath(path, { newTab: openInNewTab = false, ctrlKey = false, line = null, heading = null, block = null } = {}) {
  const leaf = activeLeaf() || workspace.root.children[0];
  const existing = leaf.tabs.findIndex(t => t.path === path && t.type !== 'graph');
  if (existing >= 0 && !openInNewTab && !ctrlKey) {
    await activateTab(leaf, existing);
  } else if (!openInNewTab && !ctrlKey && leaf.active >= 0 && leaf.tabs.length) {
    // replace active tab content like obsidian's "preview click"? No — open in new tab of this leaf
    const tab = newTab(path);
    leaf.tabs.splice(leaf.active + 1, 0, tab);
    await activateTab(leaf, leaf.active + 1);
  } else {
    const tab = newTab(path);
    leaf.tabs.push(tab);
    await activateTab(leaf, leaf.tabs.length - 1);
  }
  const tab = leaf.tabs.find(t => t.path === path);
  if (tab && (line != null || heading || block) && tab.ctrl?.jumpTo) {
    tab.ctrl.jumpTo({ line, heading, block });
  }
  return tab;
}

export function openGraphTab() {
  const leaf = activeLeaf() || workspace.root.children[0];
  const existing = leaf.tabs.findIndex(t => t.type === 'graph');
  if (existing >= 0) { activateTab(leaf, existing); return; }
  const tab = { type: 'graph', path: 'graph://global', mode: 'graph' };
  leaf.tabs.push(tab);
  activateTab(leaf, leaf.tabs.length - 1);
}

export function openNewTab() {
  const leaf = activeLeaf() || workspace.root.children[0];
  const tab = newTab('__empty__.md');
  tab.empty = true;
  tab.path = '';
  tab.type = 'file';
  leaf.tabs.push(tab);
  activateTab(leaf, leaf.tabs.length - 1);
}

export function closeTab(leaf, i) {
  const tab = leaf.tabs[i];
  if (!tab) return;
  if (tab._dirty) tab.ctrl?.flushSave?.();
  tab.ctrl?.destroy?.();
  tab._dom?.remove();
  leaf.tabs.splice(i, 1);
  if (leaf.active >= leaf.tabs.length) leaf.active = leaf.tabs.length - 1;
  rebuild();
  saveWorkspace();
}

export function closeActiveTab() {
  const leaf = activeLeaf();
  if (leaf && leaf.active >= 0) closeTab(leaf, leaf.active);
}

export function cycleTab(dir = 1) {
  const leaf = activeLeaf();
  if (!leaf || leaf.tabs.length < 2) return;
  leaf.active = (leaf.active + dir + leaf.tabs.length) % leaf.tabs.length;
  activateTab(leaf, leaf.active);
}

export function gotoTabNumber(n) {
  const leaf = activeLeaf();
  if (!leaf) return;
  const idx = n === 9 ? leaf.tabs.length - 1 : n - 1;
  if (idx >= 0 && idx < leaf.tabs.length) activateTab(leaf, idx);
}

export function activeTab() {
  const leaf = activeLeaf();
  return leaf ? leaf.tabs[leaf.active] : null;
}

export function splitPane(dir) {
  const leaf = activeLeaf();
  if (!leaf) return;
  const tab = leaf.tabs[leaf.active];
  const parent = findParent(workspace.root, leaf);
  const newLeaf = { type: 'leaf', tabs: [], active: -1, flex: 1 };
  // copy the current tab into the new leaf BEFORE rebuild (rebuild prunes empty leaves)
  if (tab && (tab.type === 'graph' ? true : tab.path)) {
    newLeaf.tabs.push(tab.type === 'graph' ? { type: 'graph', path: 'graph://global', mode: 'graph' } : newTab(tab.path, 'file', tab.mode));
    newLeaf.active = 0;
  }
  if (parent.dir === dir) {
    const i = parent.children.indexOf(leaf);
    parent.children.splice(i + 1, 0, newLeaf);
    const total = parent.children.reduce((s, c) => s + (c.flex || 1), 0);
    parent.children.forEach(c => { c.flex = (c.flex || 1) / total; });
  } else {
    const i = parent.children.indexOf(leaf);
    const wrap = { type: 'split', dir, children: [leaf, newLeaf], flex: leaf.flex || 1 };
    leaf.flex = 1; newLeaf.flex = 1;
    parent.children[i] = wrap;
  }
  rebuild();
  setActiveLeaf(newLeaf);
  if (newLeaf.tabs.length) activateTab(newLeaf, 0);
  saveWorkspace();
}

export function closePane() {
  const leaf = activeLeaf();
  if (!leaf) return;
  const parent = findParent(workspace.root, leaf);
  if (parent.children.length <= 1) return; // keep at least one leaf
  leaf.tabs.forEach(t => { t.ctrl?.destroy?.(); t._dom?.remove(); });
  const i = parent.children.indexOf(leaf);
  parent.children.splice(i, 1);
  const first = findFirstLeaf(workspace.root);
  if (first) setActiveLeaf(first);
  rebuild();
  saveWorkspace();
}

function findParent(node, leaf) {
  if (node.type === 'split') {
    if (node.children.includes(leaf)) return node;
    for (const c of node.children) {
      const r = findParent(c, leaf);
      if (r) return r;
    }
  }
  return null;
}
function findFirstLeaf(node) {
  if (node.type === 'leaf') return node;
  for (const c of node.children) { const r = findFirstLeaf(c); if (r) return r; }
  return null;
}
export function allLeaves(node = workspace.root, out = []) {
  if (node.type === 'leaf') { out.push(node); return out; }
  node.children.forEach(c => allLeaves(c, out));
  return out;
}

let _activeLeaf = null;
export function activeLeaf() {
  if (_activeLeaf && allLeaves().includes(_activeLeaf)) return _activeLeaf;
  const first = findFirstLeaf(workspace.root);
  _activeLeaf = first;
  return first;
}
export function setActiveLeaf(leaf) {
  if (_activeLeaf === leaf) return;
  _activeLeaf = leaf;
  document.querySelectorAll('.pane-leaf').forEach(el => el.classList.remove('active'));
  if (leaf._el) leaf._el.classList.add('active');
  bus.emit('tab-activated', activeTab());
}

function rebuild() {
  // remove empty leaves (except the last one) and rerender
  const leaves = allLeaves();
  if (leaves.length > 1) {
    for (const l of leaves) {
      if (!l.tabs.length) {
        const parent = findParent(workspace.root, l);
        if (parent && parent.children.length > 1) parent.children.splice(parent.children.indexOf(l), 1);
      }
    }
  }
  if (!allLeaves().length) {
    workspace.root = { type: 'split', dir: 'row', children: [{ type: 'leaf', tabs: [], active: -1, flex: 1 }] };
    _activeLeaf = null;
  }
  render();
  saveWorkspace();
}

function renderTabTitles() {
  for (const leaf of allLeaves()) {
    if (leaf._el) {
      const bar = leaf._el.querySelector('.tabbar');
      if (bar) renderLeafTabs(leaf, bar, leaf._el.querySelector('.pane-content'));
    }
  }
}

function pruneMissingTabs() {
  for (const leaf of allLeaves()) {
    for (let i = leaf.tabs.length - 1; i >= 0; i--) {
      const t = leaf.tabs[i];
      if (t.type !== 'graph' && t.path && !vault.byPath.has(t.path)) {
        closeTab(leaf, i);
        notice(`"${tabTitle(t)}" was moved or deleted outside obsidian`, { type: 'warn' });
      }
    }
  }
}

/* --------------------------------------------------------- controllers */

async function createController(tab, leaf) {
  if (tab.type === 'graph') {
    const { createGraphView } = await import('./graph-view.js');
    return createGraphView({ mode: 'global' });
  }
  if (tab.type === 'image') {
    return {
      dom: () => h('div', { class: 'image-view' }, h('img', { src: assetSrc(tab.path) })),
      destroy() {},
    };
  }
  const { createEditorTab } = await import('./editor/index.js');
  return createEditorTab(tab, leaf);
}

function assetSrc(path) {
  // image tabs always use the vault protocol (or data: in demo mode via App)
  return App.assetUrl ? App.assetUrl(path) : path;
}

export function markDirty(tab, dirty) {
  tab._dirty = dirty;
  const leaf = allLeaves().find(l => l.tabs.includes(tab));
  if (leaf?._el) {
    const bar = leaf._el.querySelector('.tabbar');
    if (bar) renderLeafTabs(leaf, bar, leaf._el.querySelector('.pane-content'));
  }
}

/* external fs events → open tabs */
export async function handleFsEvents(evts) {
  for (const { rel } of evts) {
    for (const leaf of allLeaves()) {
      for (const tab of leaf.tabs) {
        if (tab.path !== rel || tab.type !== 'file') continue;
        const stillThere = vault.byPath.has(rel);
        if (!stillThere) { pruneMissingTabs(); continue; }
        const meta = vault.byPath.get(rel);
        const savedAt = tab._savedMtime;
        if (savedAt != null && Math.abs(savedAt - meta.mtime) < 1) continue;
        if (!tab._dirty) {
          invalidateCache(rel);
          const content = await getCachedNote(rel);
          if (content != null && tab.ctrl?.setContent) {
            tab.ctrl.setContent(content);
            tab._savedMtime = vault.byPath.get(rel)?.mtime;
            tab._lastSaved = content;
          }
        } else {
          notice(`"${tabTitle(tab)}" changed on disk while you have unsaved edits`, {
            type: 'warn',
            actions: [
              { label: 'Reload', run: async () => { tab._dirty = false; const c = await getCachedNote(rel); if (c != null) { tab.ctrl.setContent(c); markDirty(tab, false); tab._lastSaved = c; } } },
              { label: 'Keep mine', run: () => { tab.ctrl?.flushSave?.(); } },
            ],
          });
        }
      }
    }
  }
}

export function remapPath(oldPath, newPath) {
  for (const leaf of allLeaves()) {
    for (const tab of leaf.tabs) {
      if (tab.path === oldPath) {
        tab.path = newPath;
        tab.ctrl?.setPath?.(newPath);
      }
    }
  }
  renderTabTitles();
  saveWorkspace();
}
