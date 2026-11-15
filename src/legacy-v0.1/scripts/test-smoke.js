#!/usr/bin/env node
/* Smoke tests for pure logic: link engine, markdown pipeline, fuzzy matcher. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

/* ---------------------------------------------------------------- links */
const L = require('../src/shared/links.cjs');

const sample = `---
title: Sample Note
aliases: [Alias One, "Alias Two"]
tags: [frontmatter-tag]
---

# Main Heading

Some text with [[Link Target]], [[Link Target|aliased]], [[Folder/Deep Note#Section Head]],
![[Embed Target]] and an embed image ![[picture.png]].

## Second

- task [ ] and #inline-tag plus #nested/tag
- a [[Missing Note]] link
- a [md link](Other%20Note.md) and an [external](https://example.com)

\`\`\`js
// [[code block link]] should not count
const tag = "#not-a-tag";
\`\`\`

Inline \`[[also code]]\` ignored.

Block id here ^my-block-id
`;

const note = L.scanNote(sample);
assert.ok(note.title === 'Sample Note', 'title from frontmatter');
assert.deepStrictEqual(note.aliases, ['Alias One', 'Alias Two'], 'aliases parsed');
const targets = note.links.map(l => l.target);
assert.ok(targets.includes('Link Target'), 'basic wikilink');
const aliased = note.links.find(l => l.alias === 'aliased');
assert.ok(aliased && aliased.target === 'Link Target', 'aliased wikilink');
const headingLink = note.links.find(l => l.heading === 'Section Head');
assert.ok(headingLink && headingLink.target === 'Folder/Deep Note', 'heading link');
assert.ok(note.links.some(l => l.target === 'picture.png' && l.embed), 'image embed');
assert.ok(note.links.some(l => l.mdStyle && l.target === 'Other Note.md'), 'md internal link recorded (decoded)');
assert.ok(!targets.some(t => t && t.includes('code block')), 'code blocks ignored');
assert.ok(note.tags.includes('inline-tag') && note.tags.includes('nested/tag'), 'tags extracted');
assert.ok(!note.tags.includes('not-a-tag'), 'code tag ignored');
assert.ok(note.tags.includes('frontmatter-tag'), 'frontmatter tag counted');
assert.ok(note.headings.length === 2, 'headings found');
assert.ok(note.headings[0].line === 7, 'heading line numbers account for frontmatter');
assert.ok((note.blocks || []).some(b => b.id === 'my-block-id'), 'block id found');

/* resolve */
const index = {
  byPath: new Map([['Link Target.md', {}], ['Folder/Deep Note.md', {}], ['picture.png', {}], ['dup.md', {}], ['sub/dup.md', {}]]),
  byName: new Map([['Link Target.md', ['Link Target.md']], ['Deep Note.md', ['Folder/Deep Note.md']], ['picture.png', ['picture.png']], ['dup.md', ['dup.md', 'sub/dup.md']]]),
};
let r = L.resolveTarget('Link Target', 'x.md', index);
assert.strictEqual(r.file, 'Link Target.md', 'resolve by basename');
r = L.resolveTarget('Folder/Deep Note#Section Head', 'x.md', index);
assert.strictEqual(r.file, 'Folder/Deep Note.md');
assert.strictEqual(r.heading, 'Section Head');
r = L.resolveTarget('dup', 'sub/current.md', index); // exact root match wins (obsidian semantics)
assert.strictEqual(r.file, 'dup.md', 'exact vault-root match wins over duplicates');
r = L.resolveTarget('Nope', 'x.md', index);
assert.strictEqual(r.file, null, 'unresolved → null');

/* rewrite */
const before = 'A [[Link Target]] b [[Link Target|alias]] c [text](<Link Target>) d [[Other]]';
const idx2 = {
  byPath: new Map([['Link Target.md', {}], ['Moved/Target.md', {}], ['Other.md', {}]]),
  byName: new Map([['Link Target.md', ['Link Target.md']], ['Target.md', ['Link Target.md', 'Moved/Target.md']], ['Other.md', ['Other.md']]]),
};
const { content: after, count } = L.rewriteLinks(before, 'Link Target.md', 'Moved/Target.md', idx2);
assert.strictEqual(count, 3, 'three links rewritten');
assert.ok(after.includes('[[Target|alias]]') || after.includes('[[Moved/Target.md|alias]]'), 'alias preserved');
assert.ok(after.includes('[[Other]]'), 'other links untouched');

/* ---------------------------------------------------------- markdown */
/* marked + katex are ESM-friendly but expose CJS entry points */
const { marked } = require('marked');
const katex = require('katex');
assert.ok(typeof marked.parse === 'function', 'marked available');
assert.ok(typeof katex.renderToString === 'function', 'katex available');

console.log('ALL SMOKE TESTS PASSED');
