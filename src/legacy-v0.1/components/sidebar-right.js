/*
 * Right sidebar: Backlinks (+ outgoing links + unlinked mentions), Outline.
 */
import { h, clear, icon, bus } from '../lib/dom.js';
import { App } from '../lib/app-context.js';
import { ipc } from '../lib/ipc.js';
import { vault, resolveVaultPath, noteCache, getCachedNote } from '../lib/state.js';
import { stripMd, baseName, slugify } from '../shared/links.cjs';

/* ----------------------------------------------------------- backlinks */

export function mountBacklinksPanel(el) {
  let unlinkedMentions = null;
  let currentPath = null;

  async function render() {
    clear(el);
    const tab = App.activeTab?.();
    if (!tab || tab.type !== 'file' || !tab.path) {
      el.append(h('div', { class: 'bl-empty' }, 'Open a note to see its backlinks.'));
      return;
    }
    const path = tab.path;
    currentPath = path;
    const wrap = h('div', { class: 'backlinks-panel' });
    el.append(wrap);

    const srcs = (vault.backlinks[path] || []).slice().sort();
    wrap.append(h('div', { class: 'panel-section-title' }, `Linked mentions (${srcs.length})`));
    if (!srcs.length) {
      wrap.append(h('div', { class: 'bl-empty' }, 'No note links to this one yet.'));
    } else {
      for (const src of srcs) {
        const linksInSrc = (vault.notes[src]?.links || []).filter(l => !l.embed && resolveVaultPath(l.target, src).file === path);
        const grp = h('div', { class: 'bl-group' },
          h('div', { class: 'bl-file', onclick: () => App.openFile(src, {}) },
            icon('file-md'),
            h('span', {}, stripMd(baseName(src))),
            h('span', { class: 'count' }, String(linksInSrc.length)),
          ));
        for (const l of linksInSrc.slice(0, 6)) {
          grp.append(h('div', {
            class: 'bl-ctx',
            onclick: () => App.openFile(src, { line: l.line }),
          }, contextSnippet(l)));
        }
        wrap.append(grp);
      }
    }

    // outgoing links
    const note = vault.notes[path];
    if (note) {
      const outgoing = [];
      const seen = new Set();
      for (const l of note.links || []) {
        const r = resolveVaultPath(l.target, path);
        const key = (r.file || l.target) + '#' + (l.heading || '');
        if (seen.has(key)) continue;
        seen.add(key);
        outgoing.push({ l, r });
      }
      wrap.append(h('div', { class: 'panel-section-title' }, `Outgoing links (${outgoing.length})`));
      const outRow = h('div', { style: { padding: '2px 4px' } });
      for (const { l, r } of outgoing.slice(0, 40)) {
        outRow.append(h('span', {
          class: 'outgoing-link' + (r.file ? '' : ' unresolved'),
          onclick: (e) => App.openFile(l.target, { ctrlKey: e.ctrlKey, heading: l.heading, block: l.block }),
        }, (l.alias || stripMd(baseName(r.file || l.target))) + (l.heading ? ' › ' + l.heading : '') + (l.block ? ' › ^' + l.block : '')));
      }
      wrap.append(outRow);
    }

    // unlinked mentions (async, lazy)
    const title = stripMd(baseName(path));
    if (title.length >= 3) {
      wrap.append(h('div', { class: 'panel-section-title' }, 'Unlinked mentions'));
      const holder = h('div', {});
      wrap.append(holder);
      if (unlinkedMentions && unlinkedMentions.for === path) {
        showUnlinked(holder, unlinkedMentions.results, path);
      } else {
        holder.append(h('div', { class: 'bl-empty' }, 'Searching…'));
        try {
          const { results } = await ipc.search(title, { caseSensitive: false });
          const linked = new Set(srcs);
          const un = results.filter(r => r.path !== path && !linked.has(r.path));
          if (currentPath !== path) return; // tab changed meanwhile
          unlinkedMentions = { for: path, results: un };
          clear(holder);
          showUnlinked(holder, un, path);
        } catch { /* ignore */ }
      }
    }
  }

  function contextSnippet(l) {
    const text = 'link in line ' + l.line;
    const span = h('span', {}, l.raw ? l.raw.slice(0, 60) : text);
    return span;
  }

  function showUnlinked(holder, results, path) {
    if (!results.length) {
      holder.append(h('div', { class: 'bl-empty' }, 'None — no note mentions this title as plain text.'));
      return;
    }
    for (const r of results.slice(0, 8)) {
      const grp = h('div', { class: 'bl-group' },
        h('div', { class: 'bl-file', onclick: () => App.openFile(r.path, {}) },
          icon('file-md'), h('span', {}, stripMd(baseName(r.path))), h('span', { class: 'count' }, String(r.count))));
      for (const m of r.matches.slice(0, 3)) {
        grp.append(h('div', { class: 'bl-ctx', onclick: () => App.openFile(r.path, { line: m.line }) }, m.context.slice(0, 90)));
      }
      holder.append(grp);
    }
  }

  render();
  bus.on('index-updated', () => { unlinkedMentions = null; render(); });
  bus.on('tab-activated', render);
}

/* -------------------------------------------------------------- outline */

export function mountOutlinePanel(el) {
  function render() {
    clear(el);
    const tab = App.activeTab?.();
    if (!tab || tab.type !== 'file' || !tab.path) {
      el.append(h('div', { class: 'outline-empty' }, 'Open a note to see its outline.'));
      return;
    }
    const wrap = h('div', { class: 'outline-panel' });
    el.append(wrap);
    let headings = [];
    const cached = noteCache.get(tab.path);
    if (cached) {
      // live doc if this tab is being edited
      const live = tab.ctrl?.getDoc?.();
      const text = live != null ? live : cached.content;
      headings = extractHeadings(text);
    } else {
      headings = (vault.notes[tab.path]?.headings || []).map(hd => ({ ...hd }));
      getCachedNote(tab.path).then(render);
    }
    if (!headings.length) {
      wrap.append(h('div', { class: 'outline-empty' }, 'No headings in this note.'));
      return;
    }
    for (const hd of headings) {
      wrap.append(h('div', {
        class: 'outline-item',
        style: { paddingLeft: (6 + (hd.level - 1) * 14) + 'px' },
        onclick: () => tab.ctrl?.jumpTo?.({ heading: hd.text }),
      }, hd.text));
    }
  }
  render();
  bus.on('tab-activated', render);
  bus.on('index-updated', render);
  // refresh as user types (debounced via editor stats events)
  bus.on('editor-stats', render);
}

function extractHeadings(text) {
  const out = [];
  const lines = text.split('\n');
  let inCode = false, fm = text.startsWith('---\n');
  let fmClosed = !fm;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!fmClosed) { if (i > 0 && line.trim() === '---') fmClosed = true; continue; }
    if (/^\s*(```|~~~)/.test(line)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i + 1 });
  }
  return out;
}
