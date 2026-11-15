/*
 * Vault switcher (start screen) + ribbon + statusbar.
 */
import { h, clear, icon, bus } from '../lib/dom.js';
import { App } from '../lib/app-context.js';
import { ipc } from '../lib/ipc.js';
import { vault, workspace, settings, applyAppearance, loadSettings, loadWorkspace, updateVaultSnapshot } from '../lib/state.js';
import { notice, modal } from './ui.js';

/* ------------------------------------------------------- vault switcher */

export function mountVaultSwitcher(onOpened) {
  const root = document.getElementById('vault-switcher');
  root.classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');

  async function render() {
    const g = await ipc.globalGet();
    clear(root);
    const list = h('div', { class: 'switcher-list' });
    if (g.vaults?.length) {
      list.append(h('div', { class: 'switcher-list-title' }, 'Your vaults'));
      for (const v of g.vaults) {
        list.append(h('div', { class: 'vault-item', onclick: () => open(v) },
          icon('vault', 'icon-lg'),
          h('div', { style: { minWidth: 0 } },
            h('div', { class: 'v-name' }, v.name || v.path.split(/[\\/]/).pop()),
            h('div', { class: 'v-path' }, v.path)),
          h('div', { class: 'vault-remove', title: 'Forget this vault', onclick: async (e) => { e.stopPropagation(); await ipc.globalRemoveVault(v.path); render(); } }, icon('x')),
        ));
      }
    }
    root.append(h('div', { class: 'switcher-card' },
      h('div', { class: 'brand' },
        h('img', { src: '../../assets/icon.png', alt: 'obsidian' }),
        h('div', {},
          h('h1', {}, 'obsidian'),
          h('p', {}, 'Your thoughts, locally. Plain Markdown files, on your disk.'))),
      h('div', { class: 'switcher-actions' },
        h('button', { class: 'primary', onclick: createNew }, icon('new-folder'), 'Create new vault'),
        h('button', { onclick: openExisting }, icon('folder'), 'Open folder as vault'),
        ipc.isDemo ? h('button', { onclick: () => open({ path: 'C:\\Demo', name: 'Demo vault' }) }, icon('flame'), 'Try demo vault') : null,
      ),
      list,
      h('div', { class: 'switcher-foot' }, icon('shield'), 'No account, no cloud, no telemetry — everything stays on this computer.'),
    ));
  }

  async function createNew() {
    const parent = await ipc.pickFolder();
    if (!parent) return;
    let name = 'My vault';
    const input = h('input', { type: 'text', value: name, style: { width: '100%' } });
    const m = modal({
      title: 'Create new vault',
      body: h('div', {},
        h('p', { class: 'muted', style: { marginTop: 0 } }, 'The vault is a normal folder — you own it.'),
        h('p', { class: 'muted', style: { fontSize: '0.85em' } }, parent),
        h('div', { class: 'row' }, h('span', {}, 'Name:'), input)),
      footer: [
        h('button', { onclick: () => m.close() }, 'Cancel'),
        h('button', { class: 'primary', onclick: async () => { name = input.value.trim() || name; m.close(); const snap = await ipc.vaultCreate(parent, name); await start(snap); } }, 'Create'),
      ],
    });
    input.focus();
    input.select();
  }

  function openExisting() {
    ipc.pickFolder().then(async (path) => {
      if (!path) return;
      try {
        const snap = await ipc.vaultOpen(path);
        await start(snap);
      } catch (err) {
        notice('Could not open vault: ' + err.message, { type: 'error' });
      }
    });
  }

  async function open(v) {
    try {
      const snap = await ipc.vaultOpen(v.path);
      await start(snap);
    } catch (err) {
      notice('Could not open vault: ' + err.message, { type: 'error' });
    }
  }

  async function start(snap) {
    if (snap) {
      updateVaultSnapshot(snap);
      await loadSettings();
      await loadWorkspace();
    }
    root.classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    onOpened?.();
  }

  render();
  return { show: () => { root.classList.remove('hidden'); document.getElementById('app').classList.add('hidden'); render(); }, hide: () => root.classList.add('hidden') };
}

/* ---------------------------------------------------------------- ribbon */

export function mountRibbon() {
  const el = document.getElementById('ribbon');
  clear(el);
  const mk = (iconName, label, run, id) => {
    const b = h('div', { class: 'ribbon-btn', title: label, onclick: run }, icon(iconName));
    if (id) b.dataset.ribbonId = id;
    el.append(b);
    return b;
  };
  mk('switcher', 'Quick switcher (Ctrl+O)', () => App.runCommand('app:quick-switcher'));
  mk('search', 'Search (Ctrl+Shift+F)', () => App.runCommand('panel:search'));
  mk('graph', 'Graph view (Ctrl+G)', () => App.runCommand('workspace:open-graph'));
  mk('calendar', "Today's daily note (Ctrl+D)", () => App.runCommand('daily:open'));
  mk('command', 'Command palette (Ctrl+P)', () => App.runCommand('app:command-palette'));
  el.append(h('div', { class: 'ribbon-spacer' }));
  mk('sidebar-left', 'Toggle left sidebar', () => App.runCommand('view:toggle-left'));
  mk('sidebar-right', 'Toggle right sidebar', () => App.runCommand('view:toggle-right'));
  el.append(h('div', { class: 'ribbon-spacer' }));
  mk('settings', 'Settings (Ctrl+,)', () => App.runCommand('app:open-settings'));
}

/* -------------------------------------------------------------- statusbar */

export function mountStatusbar() {
  const el = document.getElementById('statusbar');
  clear(el);

  const leftSide = h('div', { class: 'row', style: { gap: '12px' } });
  const rightSide = h('div', { class: 'row', style: { gap: '12px' } });
  el.append(leftSide, h('span', { class: 'spacer' }), rightSide);

  const saveState = h('span', { class: 'status-item', title: 'Save status' });
  const backlinks = h('span', { class: 'status-item', title: 'Backlinks — click to open panel', onclick: () => App.runCommand('view:toggle-right-backlinks') }, icon('link'), h('span', {}, '0'));
  const words = h('span', { class: 'status-item', title: 'Words' }, icon('list'), h('span', {}, '0'));
  const chars = h('span', { class: 'status-item', title: 'Characters' }, h('span', {}, '0'));
  rightSide.append(saveState, backlinks, words, chars);

  const vaultChip = document.getElementById('vault-chip');
  clear(vaultChip);
  vaultChip.append(icon('vault'), h('span', {}, vault.name || 'Vault'));
  vaultChip.title = 'Manage vaults';
  vaultChip.addEventListener('click', () => App.runCommand('vault:open-switcher'));

  function refreshCounts() {
    const tab = App.activeTab?.();
    if (tab?.type === 'file' && tab.path) {
      backlinks.querySelector('span').textContent = String((vault.backlinks[tab.path] || []).length);
    } else {
      backlinks.querySelector('span').textContent = '0';
    }
  }
  bus.on('index-updated', refreshCounts);
  bus.on('tab-activated', refreshCounts);
  refreshCounts();

  bus.on('editor-stats', ({ words: w, chars: c }) => {
    words.querySelector('span').textContent = String(w);
    chars.querySelector('span').textContent = String(c);
  });
  bus.on('editor-status', ({ status }) => {
    saveState.textContent = status === 'saving' ? 'Saving…' : 'Saved';
    saveState.style.color = status === 'saving' ? 'var(--text-faint)' : 'var(--good)';
  });
  saveState.textContent = 'Saved';
}

/* ------------------------------------------------------------ vault chip */

export function updateVaultChip() {
  const chip = document.getElementById('vault-chip');
  if (chip) chip.querySelector('span:last-child').textContent = vault.name || 'Vault';
}
