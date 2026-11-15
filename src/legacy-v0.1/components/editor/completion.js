/* Autocomplete sources: [[wikilinks]], #tags, /slash snippets. */
import { EditorView } from '@codemirror/view';
import { snippet } from '@codemirror/autocomplete';
import { stripMd } from '../../shared/links.cjs';
import { vault, mdFiles, allTags, noteTitle } from '../../lib/state.js';

function label(path) { return stripMd(path.split('/').pop()); }

export function wikilinkSource() {
  return (context) => {
    const before = context.matchBefore(/\[\[[^\]\n]*/);
    if (!before) return null;
    const raw = before.text;
    const qi = raw.indexOf('#');
    let query = raw.slice(2);
    let headingMode = false;
    if (qi >= 0) {
      headingMode = true;
      query = raw.slice(qi + 1);
      if (raw.slice(2, qi) === '') return null; // "[[#" → nothing to resolve yet
    }
    const from = before.from + 2 + (headingMode ? qi - 2 + 1 : 0);

    if (headingMode) {
      // suggest headings of the referenced note
      const noteRaw = raw.slice(2, qi);
      const note = mdFiles().find(f => label(f) === noteRaw || f === noteRaw || noteRaw && label(f).toLowerCase() === noteRaw.toLowerCase());
      if (!note) return null;
      const heads = (vault.notes[note]?.headings || []).map(h => h.text);
      return {
        from,
        options: heads.map(t => ({
          label: t,
          apply: (view, _c, from, to) => {
            view.dispatch({ changes: { from, to, insert: t + ']]' }, selection: { anchor: from + t.length + 2 } });
          },
        })),
        validFor: /^[^\]\n]*$/,
      };
    }

    const q = query.toLowerCase();
    const files = mdFiles()
      .filter(f => !q || label(f).toLowerCase().includes(q) || f.toLowerCase().includes(q))
      .slice(0, 30);
    return {
      from,
      options: files.map(f => ({
        label: label(f),
        detail: f,
        apply: (view, _c, from, to) => {
          const rest = context.state.sliceDoc(to, to + 2) === ']]' ? '' : ']]';
          const insert = label(f) + rest;
          view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
        },
      })),
      validFor: /^[^\]\n]*$/,
    };
  };
}

export function tagSource() {
  return (context) => {
    const before = context.matchBefore(/(?:^|\s)#[^\s#]*/);
    if (!before) return null;
    const hashAt = before.text.lastIndexOf('#');
    const from = before.from + hashAt;
    const q = before.text.slice(hashAt + 1).toLowerCase();
    const tags = allTags().filter(([t]) => !q || t.toLowerCase().includes(q)).slice(0, 25);
    if (!tags.length) return null;
    return {
      from: from + 1,
      options: tags.map(([t, count]) => ({ label: t, detail: `${count} notes`, apply: t + ' ' })),
      validFor: /^[^\s#]*$/,
    };
  };
}

/* / command menu (obsidian 1.4 style) */
const SLASH_ITEMS = [
  { label: 'Heading 1', icon: 'heading', apply: '# ' },
  { label: 'Heading 2', icon: 'heading', apply: '## ' },
  { label: 'Heading 3', icon: 'heading', apply: '### ' },
  { label: 'Bullet list', icon: 'list', apply: '- ' },
  { label: 'Numbered list', icon: 'list', apply: '1. ' },
  { label: 'Task list', icon: 'check', apply: '- [ ] ' },
  { label: 'Quote', icon: 'quote', apply: '> ' },
  { label: 'Callout', icon: 'alert', apply: '> [!note] Title\n> ' },
  { label: 'Code block', icon: 'code-block', apply: '```js\n\n```' },
  { label: 'Math block', icon: 'math', apply: '$$\n\n$$' },
  { label: 'Table', icon: 'table', apply: '| Column | Column |\n| --- | --- |\n|  |  |' },
  { label: 'Horizontal rule', icon: 'hr', apply: '\n---\n' },
  { label: 'Wikilink', icon: 'link', apply: '[[]]' },
];

export function slashSource() {
  return (context) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = context.matchBefore(/(?:^|\s)\/[\w-]*$/);
    if (!before) return null;
    // only at the very start of a line or after whitespace with mostly-empty line (obsidian behavior)
    if (before.text.startsWith('/')) {
      const from = before.from;
      const q = before.text.slice(1).toLowerCase();
      const items = SLASH_ITEMS.filter(it => !q || it.label.toLowerCase().includes(q));
      if (!items.length) return null;
      return {
        from,
        options: items.map(it => ({
          label: it.label,
          type: 'keyword',
          apply: (view, _c, from2, to2) => {
            let text = it.apply;
            view.dispatch({ changes: { from: from2, to: to2, insert: text } });
            // place cursor smartly
            const openers = { '```js\n\n```': 7, '$$\n\n$$': 3 };
            const anchor = openers[text] != null ? from2 + openers[text] : from2 + text.length;
            view.dispatch({ selection: { anchor } });
          },
        })),
        validFor: /^\/?[\w-]*$/,
      };
    }
    return null;
  };
}
