/* Markdown pipeline test (bundled via esbuild, run in Node). */
import { renderMarkdown, splitFrontmatter, CALLOUTS } from '../src/lib/markdown.js';

let failures = 0;
function check(name, cond) {
  if (cond) console.log('  ok -', name);
  else { failures++; console.error('  FAIL -', name); }
}

const note = `---
title: Test
aliases: [T]
---

# Heading One

See [[Other Note]] and [[Missing|alias]] and [ext](https://example.com).

> [!tip] Pro tip
> Callouts work **here** with [[links]].

Inline $x^2$ and block:

$$E = mc^2$$

- [ ] open task
- [x] done task

\`\`\`python
print("hi")
\`\`\`

Some ==highlighted== text and \`code\` and #atag.

| a | b |
| --- | --- |
| 1 | 2 |
`;

const ctx = {
  resolve: (t) => (t === 'Other Note' ? { file: 'Other Note.md' } : { file: null }),
  fromPath: 'Test.md',
  assetUrl: (p) => 'app://vault/' + encodeURIComponent(p),
  getNote: null,
  depth: 0,
};
const { html, codeStore } = renderMarkdown(note, ctx);

console.log('renderMarkdown:');
check('properties table rendered', html.includes('<table class="properties">') && html.includes('Test'));
check('internal link rendered', html.includes('data-target="Other Note"') && html.includes('internal-link'));
check('unresolved link styled', html.includes('unresolved'));
check('alias displayed', html.includes('>alias<'));
check('external link rendered', html.includes('external-link') && html.includes('https://example.com'));
check('callout rendered', html.includes('class="callout"') && html.includes('data-callout="tip"'));
check('callout title', html.includes('Pro tip'));
check('callout body content', html.includes('Callouts work'));
check('katex inline rendered', html.includes('katex'));
check('math block rendered', (html.match(/katex-display/g) || []).length >= 1);
check('task checkboxes enabled', html.includes('type="checkbox"') && !html.includes('disabled'));
check('checked state kept', /checked/.test(html));
check('code block with copy button', html.includes('code-block') && html.includes('copy-btn') && html.includes('data-code="0"'));
check('code content stored', codeStore.length === 1 && codeStore[0].includes('print'));
check('highlight', html.includes('<mark>'));
check('tag chip', html.includes('data-tag="atag"'));
check('table rendered', html.includes('<table>') && html.includes('<th>'));
check('heading id', html.includes('id="h-heading-one"'));
check('wikilink inside callout', html.includes('data-target="links"'));

console.log('splitFrontmatter:');
const fm = splitFrontmatter('---\ntitle: X\naliases: [a, b]\n---\nbody');
check('aliases array', Array.isArray(fm.properties.aliases) && fm.properties.aliases.join() === 'a,b');
check('body extracted', fm.body.trim() === 'body');

console.log('CALLOUTS:');
check('tip defined', CALLOUTS.tip && CALLOUTS.tip.icon === 'flame');

if (failures) { console.error(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nMARKDOWN PIPELINE OK');
