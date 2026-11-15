/* Test decorations build() against the demo content — catches invalid RangeSets. */
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { livePreviewPlugin, build } from '../src/components/editor/decorations.js';
import { scanNote } from '../src/shared/links.cjs';
const { Decoration } = require('@codemirror/view');

const DOC = `---
title: Demo
---

# Heading One

Some **bold** and *em* and ==hl== and \`code\` and [[Wiki Link]] and ![[Embed Me]] and
[[Wiki Link|alias]] and [md](target.md) and [ext](https://x.dev) and $x^2$ and #tag.

> [!tip] Pro tip
> Body **bold** with [[link]].

\`\`\`js
console.log(1);
\`\`\`

- [ ] open task
- [x] done task
- plain item
- nested
  - deep

| a | b |
| --- | --- |
| 1 | 2 |

---`;

const state = EditorState.create({
  doc: DOC,
  extensions: [
    EditorView.lineWrapping,
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
  ],
});
const fakeView = {
  state,
  visibleRanges: [{ from: 0, to: state.doc.length }],
};

const ctx = {
  getPath: () => 'Demo.md',
  resolve: (t) => (t === 'Wiki Link' ? { file: 'Wiki Link.md' } : t === 'Embed Me' ? { file: 'Embed Me.md' } : { file: null }),
  renderEmbed: () => '<p>embedded</p>',
  _depth: 0,
};

const deco = build(fakeView, ctx);

try {
  const set = Decoration.set(deco, true);
  console.log('Decoration.set ok:', set.size, 'ranges');
} catch (e) {
  console.error('Decoration.set THREW:', e.stack);
  process.exit(1);
}

// validate ranges
let bad = 0;
for (const r of deco) {
  if (r.from == null || Number.isNaN(r.from) || r.to == null || Number.isNaN(r.to)) { console.error('NaN range!', r); bad++; }
  if (r.from > r.to) { console.error(`inverted range from=${r.from} to=${r.to}`, r.valueSpec || r); bad++; }
  if (r.from < 0 || r.to > state.doc.length) { console.error(`out of doc from=${r.from} to=${r.to}`); bad++; }
}
console.log(bad ? `${bad} BAD RANGES` : 'all ranges valid');
process.exit(bad ? 1 : 0);
