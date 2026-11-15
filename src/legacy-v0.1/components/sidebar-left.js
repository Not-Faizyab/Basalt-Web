/*
 * Left sidebar: Files (tree explorer), Search, Tags.
 */
import { h, clear, icon, bus } from '../lib/dom.js';
import { App } from '../lib/app-context.js';
import { ipc } from '../lib/ipc.js';
import { vault, settings } from '../lib/state.js';
import { contextMenu } from './ui.js';
import { isImage, isMarkdown, stripMd } from '../shared/links.cjs';

/* ------------------------------------------------------------ file tree */

let expandedFolders = new Set(['']); // '' = root, always expanded
let activeFile = null;

export function mountExplorer(el) {
  const head = h('div', { class: 'explorer-head' },
    h('span', { class: 'panel-title' }, 'Files'),
    h('span', { class: 'icon-btn', title: 'New note', onclick: () => App.runCommand('workspace:new-note') }, icon('new-file')),
    h('span', { class: 'icon-btn', title: 'New folder', onclick: () => createFolderInline(el, '') }, icon('new-folder')),
    h('span', { class: 'icon-btn', title: 'Collapse all', onclick: () => { expandedFolders = new Set(['']); render(); } }, icon('list')),
  );
  const tree = h('div', { class: 'tree' });
  el.append(h('div', { class: 'explorer' }, head, tree));

  function render() { renderTree(tree); }
  el._render = render;
  render();
  bus.on('index-updated', render);
  bus.on('tab-activated', (tab) => {
    activeFile = tab?.type === 'file' || tab?.type === 'image' ? tab.path : activeFile;
    render();
  });
}

function fileIconName(f) {
  if (f.isFolder) return 'folder';
  if (isImage(f.path)) return 'file-img';
  if (isMarkdown(f.path)) return 'file-md';
  return 'file';
}

function renderTree(container) {
  clear(container);
  const showHidden = settings.app.files.showHidden;
  const files = vault.files.filter(f => {
    if (!showHidden && f.path.split('/').some(seg => seg.startsWith('.') || seg === 'node_modules')) return false;
    return true;
  });
  if (!files.length) {
    container.append(h('div', { class: 'explorer-empty' }, 'Empty vault — create your first note with Ctrl+N'));
    return;
  }
  const byParent = new Map();
  for (const f of files) {
    const parent = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(f);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.isFolder === b.isFolder ? a.path.localeCompare(b.path, undefined, { numeric: true }) : a.isFolder ? -1 : 1));
  }
  // expand path to active file
  if (activeFile) {
    let dir = activeFile.includes('/') ? activeFile.slice(0, activeFile.lastIndexOf('/')) : '';
    while (dir) { expandedFolders.add(dir); dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''; }
  }

  const renderDir = (parent, depth, el) => {
    const items = byParent.get(parent) || [];
    for (const f of items) {
      if (f.isFolder) {
        const open = expandedFolders.has(f.path);
        const row = h('div', {
          class: 'tree-item',
          dataset: { path: f.path },
          onclick: () => { open ? expandedFolders.delete(f.path) : expandedFolders.add(f.path); renderTree(container); },
          oncontextmenu: (e) => folderMenu(e, f),
          ondragover: (e) => { e.preventDefault(); row.classList.add('drop-target'); },
          ondragleave: () => row.classList.remove('drop-target'),
          ondrop: (e) => { e.preventDefault(); row.classList.remove('drop-target'); const src = e.dataTransfer.getData('text/obsidian-path'); if (src && src !== f.path) movePath(src, f.path + '/' + stripMd(src.split('/').pop())); },
        },
          h('span', { class: 'chevron' + (open ? ' open' : '') }, icon('chevron')),
          icon(f.path === activeContainer ? 'folder-open' : 'folder'),
          h('span', { class: 'tree-name' }, f.path.split('/').pop()),
        );
        el.append(row);
        if (open) renderDir(f.path, depth + 1, el);
      } else {
        const name = f.path.split('/').pop();
        const isActive = f.path === activeFile;
        const row = h('div', {
          class: 'tree-item' + (isActive ? ' active' : ''),
          dataset: { path: f.path },
          draggable: 'true',
          onclick: (e) => App.openFile(f.path, { ctrlKey: e.ctrlKey || e.metaKey }),
          oncontextmenu: (e) => fileMenu(e, f),
          ondragstart: (e) => e.dataTransfer.setData('text/obsidian-path', f.path),
          ondblclick: () => App.renameNote(f.path),
        },
          h('span', { class: 'chevron leaf-spacer' }, icon('chevron')),
          icon(fileIconName(f)),
          h('span', { class: 'tree-name' }, stripMd(name) === name ? name : stripMd(name)),
        );
        el.append(row);
      }
    }
  };
  const activeContainer = activeFile && activeFile.includes('/') ? activeFile.slice(0, activeFile.lastIndexOf('/')) : null;
  renderDir('', 0, container);
}

function fileMenu(e, f) {
  e.preventDefault();
  contextMenu(e.clientX, e.clientY, [
    { label: 'Open', icon: 'file', run: () => App.openFile(f.path, {}) },
    { label: 'Open in new tab', icon: 'plus', run: () => App.openFile(f.path, { newTab: true }) },
    { sep: true },
    { label: 'Rename…', icon: 'pencil', kbd: 'F2', run: () => App.renameNote(f.path) },
    { label: 'Delete (Recycle Bin)', icon: 'trash', danger: true, run: () => deletePath(f) },
    { sep: true },
    { label: 'Copy path', icon: 'copy', run: () => navigator.clipboard?.writeText(f.path) },
    { label: 'Reveal in File Explorer', icon: 'external-link', run: () => ipc.vaultReveal(f.path) },
    ...(isImage(f.path) ? [{ label: 'Open with default app', icon: 'external-link', run: () => ipc.openExternalPath(f.path) }] : []),
  ]);
}

function folderMenu(e, f) {
  e.preventDefault();
  contextMenu(e.clientX, e.clientY, [
    { label: 'New note', icon: 'new-file', run: () => createNoteInline(document.querySelector('.explorer'), f.path) },
    { label: 'New folder', icon: 'new-folder', run: () => createFolderInline(document.querySelector('.explorer'), f.path) },
    { sep: true },
    { label: 'Rename…', icon: 'pencil', run: () => renameInline(e.currentTarget, f.path, true) },
    { label: 'Delete (Recycle Bin)', icon: 'trash', danger: true, run: () => deletePath(f) },
    { sep: true },
    { label: 'Reveal in File Explorer', icon: 'external-link', run: () => ipc.vaultReveal(f.path) },
  ]);
}

async function deletePath(f) {
  try {
    await ipc.remove(f.path);
    App.notice?.(`Moved "${f.path.split('/').pop()}" to the Recycle Bin`);
  } catch (err) {
    App.notice?.('Delete failed: ' + err.message, { type: 'error' });
  }
}

async function movePath(src, dest) {
  try {
    await ipc.move(src, dest);
    App.notice?.(`Moved to ${dest}`);
  } catch (err) {
    App.notice?.('Move failed: ' + err.message, { type: 'error' });
  }
}

function createNoteInline(container, folder) {
  const target = folder || (settings.app.files.newNoteLocation === 'same' && activeFile?.includes('/') ? activeFile.slice(0, activeFile.lastIndexOf('/')) : '');
  App.createNote(target || null).then((p) => { if (p) { if (target) expandedFolders.add(target); App.openFile(p, { newTab: false }); } });
}

function createFolderInline(container, parent) {
  const tree = container.querySelector('.tree');
  const input = h('input', { type: 'text', class: 'tree-rename', placeholder: 'folder name', spellcheck: 'false' });
  const row = h('div', { class: 'tree-item' }, h('span', { class: 'chevron leaf-spacer' }, icon('chevron')), icon('folder'), input);
  if (parent) {
    // insert after parent's row
    const parentRow = tree.querySelector(`[data-path="${CSS.escape(parent)}"]`);
    if (parentRow) parentRow.after(row); else tree.prepend(row);
  } else {
    tree.prepend(row);
  }
  input.focus();
  const commit = async () => {
    const name = input.value.trim();
    row.remove();
    if (!name) return;
    const path = parent ? parent + '/' + name : name;
    try { await ipc.createFolder(path); expandedFolders.add(path); } catch (e) { App.notice?.(e.message, { type: 'error' }); }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); row.remove(); }
  });
  input.addEventListener('blur', commit);
}

function renameInline(row, path, isFolder) {
  if (!row) return;
  const nameEl = row.querySelector('.tree-name');
  if (!nameEl) return;
  const input = h('input', { type: 'text', class: 'tree-rename', value: path.split('/').pop(), spellcheck: 'false' });
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = async () => {
    const newName = input.value.trim();
    let newPath = null;
    if (newName && newName !== path.split('/').pop()) {
      newPath = (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '') + newName;
    }
    if (!newPath) { input.replaceWith(nameEl); return; }
    try {
      const { updatedLinks } = await ipc.rename(path, newPath);
      App.remapTabs?.(path, newPath);
      App.notice?.(updatedLinks ? `Renamed — updated ${updatedLinks} link${updatedLinks === 1 ? '' : 's'}` : 'Renamed');
    } catch (e) {
      App.notice?.(e.message, { type: 'error' });
      input.replaceWith(nameEl);
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); input.replaceWith(nameEl); }
  });
  input.addEventListener('blur', commit);
}

/* -------------------------------------------------------------- search */

let searchState = { query: '', caseSensitive: false, regex: false, wholeWord: false };

export function mountSearchPanel(el) {
  const input = h('input', { type: 'search', placeholder: 'Search vault… (Ctrl+Shift+F)' });
  const optCase = h('span', { class: 'search-opt', title: 'Match case (Aa)' }, 'Aa');
  const optWord = h('span', { class: 'search-opt', title: 'Match whole word' }, 'ab|');
  const optRegex = h('span', { class: 'search-opt', title: 'Regular expression' }, '.*');
  const status = h('div', { class: 'search-status' }, 'Type to search your vault');
  const results = h('div', { class: 'search-results' });
  const panel = h('div', { class: 'search-panel' },
    h('div', { class: 'search-box' },
      input,
      h('div', { class: 'search-opts' }, optCase, optWord, optRegex),
      status,
    ),
    results,
  );
  el.append(panel);

  const toggles = [[optCase, 'caseSensitive'], [optWord, 'wholeWord'], [optRegex, 'regex']];
  for (const [elm, key] of toggles) {
    elm.addEventListener('click', () => {
      searchState[key] = !searchState[key];
      elm.classList.toggle('on', searchState[key]);
      run();
    });
  }
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; run(); }
    if (e.key === 'Enter') run();
  });

  async function run() {
    searchState.query = input.value;
    if (!searchState.query) {
      clear(results);
      status.textContent = 'Type to search your vault';
      return;
    }
    if (searchState.regex) {
      try { new RegExp(searchState.query); } catch (e) { status.textContent = 'Invalid regex: ' + e.message; return; }
    }
    status.textContent = 'Searching…';
    try {
      const { results: res, total } = await ipc.search(searchState.query, {
        caseSensitive: searchState.caseSensitive,
        regex: searchState.regex,
        wholeWord: searchState.wholeWord,
      });
      status.textContent = `${res.length} files · ${total} matches`;
      clear(results);
      for (const fileRes of res.slice(0, 100)) {
        const grp = h('div', { class: 'search-file' },
          h('div', { class: 'search-file-head', onclick: () => App.openFile(fileRes.path, {}) },
            icon('file-md'),
            h('span', {}, stripMd(fileRes.path.split('/').pop())),
            h('span', { class: 'faint', style: { fontWeight: 400, fontSize: '0.82em', marginLeft: '6px' } }, fileRes.path.includes('/') ? fileRes.path.slice(0, fileRes.path.lastIndexOf('/')) : ''),
            h('span', { class: 'count' }, String(fileRes.count)),
          ));
        for (const m of fileRes.matches.slice(0, 12)) {
          grp.append(h('div', {
            class: 'search-match',
            html: highlightCtx(m.context, searchState),
            onclick: () => App.openFile(fileRes.path, { line: m.line }),
          }));
        }
        results.append(grp);
      }
      if (!res.length) results.append(h('div', { class: 'fuzzy-empty' }, 'No matches found'));
    } catch (err) {
      status.textContent = 'Search failed: ' + err.message;
    }
  }

  App.focusSearch = () => { input.focus(); input.select(); };
  App.setSearchQuery = (q) => { input.value = q; run(); };
}

function highlightCtx(text, st) {
  const esc = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  try {
    let re;
    if (st.regex) re = new RegExp(st.query, st.caseSensitive ? 'g' : 'gi');
    else re = new RegExp(st.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), st.caseSensitive ? 'g' : 'gi');
    return esc(text).replace(new RegExp(re.source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), re.flags), (m) => `<mark>${m}</mark>`);
  } catch {
    return esc(text);
  }
}

/* ----------------------------------------------------------------- tags */

export function mountTagsPanel(el) {
  const render = () => {
    clear(el);
    const wrap = h('div', { class: 'tags-panel' });
    const counts = new Map();
    for (const n of Object.values(vault.notes)) {
      for (const t of n.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    }
    if (!counts.size) {
      wrap.append(h('div', { class: 'bl-empty' }, 'No tags yet. Type #tag inside a note.'));
      el.append(wrap);
      return;
    }
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const rendered = new Set();
    for (const [tag, count] of entries) {
      if (rendered.has(tag)) continue;
      // mark children rendered
      for (const [t2] of entries) if (t2 !== tag && t2.startsWith(tag + '/')) rendered.add(t2);
      wrap.append(h('div', { class: 'tag-item', onclick: () => App.openTagSearch?.(tag) },
        h('span', { class: 'tag-chip' }, icon('tag')),
        h('span', {}, '#' + tag),
        h('span', { class: 'count' }, String(count)),
      ));
    }
    el.append(wrap);
  };
  render();
  bus.on('index-updated', render);
}
