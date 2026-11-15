/*
 * Editor tab controller: CodeMirror 6 live preview + reading view,
 * autosave, jump-to-line/heading/block, image paste, interactions.
 */
import {
  EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine,
} from '@codemirror/view';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import {
  defaultKeymap, history, historyKeymap, indentWithTab,
} from '@codemirror/commands';
import { searchKeymap, openSearchPanel, setSearchQuery, highlightSelectionMatches } from '@codemirror/search';
import {
  autocompletion, closeBracketsKeymap, completionKeymap,
} from '@codemirror/autocomplete';
import {
  markdown, markdownLanguage,
} from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle, indentUnit } from '@codemirror/language';

import { h, bus, debounce } from '../../lib/dom.js';
import { ipc, assetUrl } from '../../lib/ipc.js';
import {
  settings, vault, resolveVaultPath, noteCache, getCachedNote, invalidateCache,
} from '../../lib/state.js';
import { App } from '../../lib/app-context.js';
import { renderMarkdown, wirePreview } from '../../lib/markdown.js';
import { scanNote, isImage, stripMd, baseName, slugify } from '../../shared/links.cjs';
import { livePreviewPlugin } from './decorations.js';
import { wikilinkSource, tagSource, slashSource } from './completion.js';

const MODE_CONF = new Compartment();
const LINE_NUMBERS = new Compartment();

export async function createEditorTab(tab, leaf) {
  let path = tab.path;
  let content = '';
  if (!tab.empty) {
    content = await getCachedNote(path).catch(() => '');
    if (content == null) content = '';
  }
  tab._lastSaved = content;
  tab._savedMtime = vault.byPath.get(path)?.mtime;

  /* ------------------------------------------------------------- context */
  const ctx = {
    getPath: () => path,
    resolve: (target, from) => resolveVaultPath(target, from),
    renderEmbed: (file, heading, block) => {
      const cached = noteCache.get(file);
      if (!cached) {
        // trigger async load then force redraw
        getCachedNote(file).then(() => view.dispatch({ userEvent: 'embed.loaded' }));
        return null;
      }
      if ((ctx._depth || 0) > 2) return null;
      const sub = extractSection(cached.content, heading, block);
      const r = renderMarkdown(sub, {
        resolve: ctx.resolve,
        getNote: null, // no nested embeds in live preview widgets (depth guard)
        fromPath: file,
        assetUrl,
        depth: (ctx._depth || 0) + 1,
      });
      return r.html;
    },
    _depth: 0,
  };

  /* --------------------------------------------------------------- view */
  let saveTimer = null;
  const updateListener = EditorView.updateListener.of((u) => {
    if (u.docChanged) {
      // an "empty tab" becomes a real note as soon as the user types
      if (tab.empty && u.state.doc.length > 0) {
        tab.empty = false;
        App.createNote(null, view.state.doc.toString()).then((p) => {
          if (p) {
            path = p;
            tab.path = p;
            tab._dirty = false;
            tab._lastSaved = view.state.doc.toString();
            App.markDirty?.(tab, false);
            bus.emit('note-created', { path: p });
          }
        });
      }
      tab._dirty = !tab.empty;
      App.markDirty?.(tab, tab._dirty);
      scheduleSave();
      emitStats(u.state);
    }
  });

  const exts = () => [
    LINE_NUMBERS.of(settings.app.editor.lineNumbers ? lineNumbers() : []),
    history(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    indentUnit.of('  '),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
    autocompletion({ override: [wikilinkSource(), tagSource(), slashSource()], icons: false, activateOnTyping: true }),
    highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
    Prec.high(keymap.of([
      // app-level commands that CM's own keymaps would otherwise swallow
      { key: 'Mod-g', run: () => { App.runCommand('workspace:open-graph'); return true; }, preventDefault: true },
      { key: 'Mod-b', run: toggleFormat('**'), preventDefault: true },
      { key: 'Mod-i', run: toggleFormat('*'), preventDefault: true },
      { key: 'Mod-k', run: insertLink, preventDefault: true },
      { key: 'Mod-l', run: toggleTask, preventDefault: true },
      { key: 'Enter', run: continueList },
    ])),
    Prec.high(EditorView.domEventHandlers({
      paste: onPaste,
      drop: onDrop,
      mousedown: onClick,
    })),
    livePreviewPlugin(ctx),
    updateListener,
    EditorView.theme({
      '&.cm-focused': { outline: 'none' },
    }),
  ];

  const view = new EditorView({
    state: EditorState.create({
      doc: tab.empty ? '' : content,
      extensions: [MODE_CONF.of(exts())],
    }),
  });

  /* -------------------------------------------------------------- dom */
  const liveWrap = h('div', { class: 'editor-live' }, view.dom);
  const previewScroll = h('div', { class: 'preview-scroll hidden' });
  const previewSizer = h('div', { class: 'preview-sizer' });
  previewScroll.append(previewSizer);
  const host = h('div', { class: 'editor-host' + (settings.appearance.readable ? ' readable' : '') }, liveWrap, previewScroll);

  wirePreview(previewSizer, {
    onInternalLink: (target, heading, block, ctrl) => App.openFile(target, { ctrlKey: ctrl, heading, block }),
    onExternalLink: (url) => App.openExternal(url),
    onTag: (t) => App.openTagSearch?.(t),
    onToggleTask: (idx, checked) => toggleTaskByIndex(idx, checked),
    codeStore: () => previewSizer._codeStore || [],
  });

  function setMode(mode) {
    tab.mode = mode;
    if (mode === 'reading') {
      renderReading();
      previewScroll.classList.remove('hidden');
      liveWrap.classList.add('hidden');
    } else {
      previewScroll.classList.add('hidden');
      liveWrap.classList.remove('hidden');
      view.focus();
    }
    bus.emit('tab-activated', tab);
  }

  function renderReading() {
    const { html, codeStore } = renderMarkdown(view.state.doc.toString(), {
      resolve: ctx.resolve,
      getNote: (file, heading, block, depth) => {
        if (depth > 2) return null;
        const cached = noteCache.get(file);
        if (!cached) { getCachedNote(file); return null; }
        const sub = extractSection(cached.content, heading, block);
        return renderMarkdown(sub, {
          resolve: ctx.resolve, getNote: null, fromPath: file, assetUrl, depth,
        }).html;
      },
      fromPath: path,
      assetUrl,
      depth: 0,
    });
    previewSizer.innerHTML = html;
    previewSizer._codeStore = codeStore;
  }

  /* ------------------------------------------------------------- actions */
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 700);
    bus.emit('editor-status', { tab, status: 'saving' });
  }

  async function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!tab._dirty) return;
    if (tab.empty) return;
    const text = view.state.doc.toString();
    await ipc.write(path, text);
    tab._dirty = false;
    tab._lastSaved = text;
    noteCache.set(path, { content: text, mtime: vault.byPath.get(path)?.mtime || Date.now() });
    // refresh index for this note
    try {
      const st = await ipc.stat(path);
      tab._savedMtime = st.mtime;
    } catch { /* ok */ }
    App.markDirty?.(tab, false);
    bus.emit('editor-status', { tab, status: 'saved' });
    bus.emit('note-saved', { path, text });
  }

  const emitStats = debounce((state) => {
    const text = state.doc.toString();
    const words = text.split(/\s+/).filter(Boolean).length;
    bus.emit('editor-stats', { tab, words, chars: text.length });
  }, 200);

  function jumpTo({ line, heading, block }) {
    let pos = null;
    const text = view.state.doc.toString();
    if (heading) {
      const note = scanNote(text);
      const hd = note.headings.find(x => slugify(x.text) === slugify(heading) || x.text.toLowerCase() === heading.toLowerCase());
      if (hd) pos = lineToPos(hd.line);
    } else if (block) {
      const note = scanNote(text);
      const b = (note.blocks || []).find(x => x.id === block);
      if (b) pos = lineToPos(b.line);
    }
    if (pos == null && line != null) pos = lineToPos(line);
    if (pos == null) return;
    if (tab.mode === 'reading') setMode('live');
    view.dispatch({
      selection: { anchor: pos },
      scrollIntoView: true,
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
    view.focus();
  }
  function lineToPos(lineNo) {
    const n = Math.max(1, Math.min(lineNo, view.state.doc.lines));
    return view.state.doc.line(n).from;
  }

  function setContent(newContent) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: newContent } });
    tab._dirty = false;
    tab._lastSaved = newContent;
    App.markDirty?.(tab, false);
    if (tab.mode === 'reading') renderReading();
  }

  function setPath(newPath) {
    path = newPath;
    tab._savedMtime = vault.byPath.get(newPath)?.mtime;
  }

  /* ------------------------------------------------------- interactions */
  function onClick(event, v) {
    const t = event.target;
    // checkbox
    const cb = t.closest?.('.bs-checkbox');
    if (cb) {
      const pos = Number(cb.dataset.pos);
      const cur = v.state.sliceDoc(pos, pos + 3);
      const next = /\[[xX]\]/.test(cur) ? '[ ]' : '[x]';
      v.dispatch({ changes: { from: pos, to: pos + 3, insert: next } });
      return true;
    }
    // copy code button
    const copy = t.closest?.('.copy-btn');
    if (copy) {
      const from = Number(copy.dataset.from), to = Number(copy.dataset.to);
      const code = v.state.sliceDoc(from, to);
      navigator.clipboard?.writeText(code).catch(() => {});
      copy.textContent = 'Copied!';
      setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
      return true;
    }
    // wikilink / internal link / tag / external
    const wl = t.closest?.('.bs-wikilink, .bs-internallink');
    if (wl) {
      const target = wl.dataset.target;
      if (target) {
        App.openFile(target, { ctrlKey: event.ctrlKey, heading: wl.dataset.heading, block: wl.dataset.block });
        return true;
      }
    }
    const tg = t.closest?.('.bs-tag');
    if (tg) {
      App.openTagSearch?.(tg.dataset.tag);
      return true;
    }
    const ext = t.closest?.('.bs-link-ext');
    if (ext) {
      const url = ext.dataset.external;
      if (url) App.openExternal(url);
      return true;
    }
    const img = t.closest?.('.bs-img-widget, .bs-embed-widget');
    if (img) {
      // open the image source in a new tab on ctrl+click
      return false;
    }
    return false;
  }

  async function onPaste(event, v) {
    const items = event.clipboardData?.items || [];
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (!file) return true;
        const dataUrl = await blobToDataUrl(file);
        const name = await App.saveAttachment(dataUrl, file.type);
        if (name) {
          const pos = v.state.selection.main.head;
          const insert = `![[${name}]]`;
          v.dispatch({ changes: { from: pos, to: pos, insert }, selection: { anchor: pos + insert.length } });
        }
        return true;
      }
    }
    return false;
  }

  async function onDrop(event, v) {
    const files = event.dataTransfer?.files || [];
    for (const file of files) {
      if (file.type && file.type.startsWith('image/')) {
        event.preventDefault();
        const dataUrl = await blobToDataUrl(file);
        const name = await App.saveAttachment(dataUrl, file.type);
        if (name) {
          const pos = v.posAtCoords({ x: event.clientX, y: event.clientY }) ?? v.state.selection.main.head;
          v.dispatch({ changes: { from: pos, to: pos, insert: `\n![[${name}]]\n` } });
        }
        return true;
      }
    }
    return false;
  }

  function toggleTaskByIndex(idx, checked) {
    // toggle the idx-th task marker in the source
    const text = view.state.doc.toString();
    let count = -1, at = -1;
    const re = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/gm;
    let m;
    while ((m = re.exec(text))) {
      count++;
      if (count === idx) { at = m.index + m[1].length + 1; break; }
    }
    if (at < 0) return;
    view.dispatch({ changes: { from: at, to: at + 1, insert: checked ? 'x' : ' ' } });
  }

  /* ------------------------------------------------------------ editing */
  function toggleFormat(marker) {
    return (v) => {
      const { from, to } = v.state.selection.main;
      const selected = v.state.sliceDoc(from, to);
      if (!selected) {
        v.dispatch({
          changes: { from, to, insert: marker + marker },
          selection: { anchor: from + marker.length },
        });
        return true;
      }
      const before = v.state.sliceDoc(Math.max(0, from - marker.length), from);
      const after = v.state.sliceDoc(to, Math.min(v.state.doc.length, to + marker.length));
      if (before === marker && after === marker) {
        v.dispatch({
          changes: [
            { from: from - marker.length, to: from, insert: '' },
            { from: to, to: to + marker.length, insert: '' },
          ],
          selection: { anchor: from - marker.length, to: to - marker.length },
        });
      } else {
        v.dispatch({
          changes: { from, to, insert: marker + selected + marker },
          selection: { anchor: from + marker.length, to: to + marker.length },
        });
      }
      return true;
    };
  }

  function insertLink(v) {
    const { from, to } = v.state.selection.main;
    const selected = v.state.sliceDoc(from, to);
    const useWiki = settings.app.files.linkStyle === 'wikilink';
    const insert = useWiki ? `[[${selected}]]` : `[${selected}](url)`;
    v.dispatch({ changes: { from, to, insert }, selection: { anchor: from + (useWiki ? 2 : 1), head: from + insert.length - (useWiki ? 2 : 5) } });
    return true;
  }

  function toggleTask(v) {
    const line = v.state.doc.lineAt(v.state.selection.main.head);
    const m = /^(\s*(?:[-*+]|\d+[.)])\s+)(\[[ xX]\])?/.exec(line.text);
    if (m && m[2]) {
      const at = line.from + m[1].length + 1;
      const cur = v.state.sliceDoc(at, at + 1);
      v.dispatch({ changes: { from: at, to: at + 1, insert: /[xX]/.test(cur) ? ' ' : 'x' } });
    } else if (m) {
      v.dispatch({ changes: { from: line.from + m[1].length, to: line.from + m[1].length, insert: '[ ] ' } });
    } else {
      v.dispatch({ changes: { from: line.from, to: line.from, insert: '- [ ] ' } });
    }
    return true;
  }

  function continueList(v) {
    const { state } = v;
    const line = state.doc.lineAt(state.selection.main.head);
    const m = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/.exec(line.text);
    if (!m) return false;
    if (!m[5].trim() && !m[4]) {
      // empty item — remove it and exit the list
      v.dispatch({
        changes: { from: line.from, to: line.to, insert: '' },
        selection: { anchor: line.from },
      });
      return true;
    }
    let marker = m[2];
    const om = /^(\d+)([.)])$/.exec(marker);
    if (om) marker = String(parseInt(om[1], 10) + 1) + om[2];
    const task = m[4] ? '[ ] ' : '';
    const insert = '\n' + m[1] + marker + m[3] + task;
    const pos = state.selection.main.head;
    v.dispatch({
      changes: { from: pos, to: pos, insert },
      selection: { anchor: pos + insert.length },
    });
    return true;
  }

  /* ---------------------------------------------------------------- api */
  setMode(tab.mode || settings.app.editor.defaultViewMode);
  return {
    dom: () => host,
    destroy() {
      clearTimeout(saveTimer);
      if (tab._dirty && !tab.empty) {
        flushSave(); // fire and forget
      }
      view.destroy();
    },
    focus() { if (tab.mode !== 'reading') view.focus(); },
    flushSave,
    jumpTo,
    setContent,
    setPath,
    setMode,
    getDoc: () => view.state.doc.toString(),
    find: () => { openSearchPanel(view); },
    setModeLive: () => setMode('live'),
    setModeReading: () => setMode('reading'),
    refresh: () => { if (tab.mode === 'reading') renderReading(); else view.dispatch({}); },
    view: () => view,
  };
}

/* ------------------------------------------------------------- helpers */

function extractSection(content, heading, block) {
  if (!heading && !block) return content;
  const note = scanNote(content);
  const lines = content.split('\n');
  if (heading) {
    const hd = note.headings.find(x => slugify(x.text) === slugify(heading) || x.text.toLowerCase() === heading.toLowerCase());
    if (!hd) return content;
    const start = hd.line;
    const next = note.headings.find(x => x.line > start && x.level <= hd.level);
    const end = next ? next.line - 1 : lines.length;
    return lines.slice(start - 1, end).join('\n');
  }
  // block
  const b = (note.blocks || []).find(x => x.id === block);
  if (!b) return content;
  return lines[b.line - 1] || '';
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}
