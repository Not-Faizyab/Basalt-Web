/*
 * Command palette and quick switcher.
 */
import { h, clear, icon } from '../lib/dom.js';
import { App } from '../lib/app-context.js';
import { vault, mdFiles, noteTitle, settings } from '../lib/state.js';
import { fuzzyModal } from './ui.js';
import { stripMd, baseName } from '../shared/links.cjs';

export function openCommandPalette() {
  const commands = (App.commands || []).filter(c => !c.hidden);
  fuzzyModal({
    placeholder: 'Type a command…',
    emptyText: 'No matching command',
    iconOf: (it) => icon(it.icon || 'command'),
    items: commands.map(c => ({
      text: c.name,
      sub: c.desc || '',
      right: c.hotkeyLabel || '',
      run: c,
    })),
    onRun: (item) => {
      App.runCommand(item.run.id);
    },
  });
}

export function openQuickSwitcher() {
  const files = mdFiles().map(f => ({
    text: stripMd(baseName(f.path)),
    sub: f.path,
    path: f.path,
  }));
  const modal = fuzzyModal({
    placeholder: 'Find or create a note…',
    emptyText: 'No note found — press Enter to create it',
    iconOf: () => icon('file-md'),
    items: files,
    onInput: (query, list, listBox) => {
      // "create note" affordance row
      if (query && !list.length) { /* fuzzyModal already shows emptyText */ }
    },
    onRun: (item, { ctrlKey }) => {
      App.openFile(item.path, { ctrlKey, newTab: ctrlKey });
    },
  });
  // add a "create" row at the bottom when there's an exact non-match
  const origInput = modal.input;
  origInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const q = origInput.value.trim();
    if (!q) return;
    const existing = mdFiles().find(f => stripMd(baseName(f.path)).toLowerCase() === q.toLowerCase());
    if (existing) return; // normal selection handles it
    if (e.isComposing) return;
    // avoid double-run: only when list box shows empty
    const listEl = modal.box ? modal.box.querySelector('.fuzzy-list') : null;
    const hasItems = listEl && listEl.querySelector('.fuzzy-item');
    if (hasItems) return; // a real item is selected; default flow applies
    e.stopImmediatePropagation();
    modal.close();
    const path = await App.createNote(null, '');
    if (path) App.openFile(path, { newTab: false });
  });
  return modal;
}
