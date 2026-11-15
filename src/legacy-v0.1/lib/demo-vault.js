/* Demo vault content used by mock mode (browser demo / automated tests). */
export const DEMO_VAULT = {
  'Welcome.md': `---
title: Welcome to obsidian
aliases: [Home, Start]
---

# Welcome to obsidian 🌑

obsidian is a **local-first** knowledge base. Every note is a plain Markdown file inside a folder *you* choose. Nothing ever leaves your machine.

> [!tip] Try these first
> Press \`Ctrl+O\` to jump between notes, \`Ctrl+P\` for the command palette, and \`Ctrl+G\` for the graph.

## Why you'll like it

- **Your files, your rules** — the vault is just a folder on your disk
- [[Linking Your Notes|Double-linked notes]] — connect ideas, not folders
- A live [[Graph View]] of everything you know
- Zero network calls — see [[Privacy & Security]]

\`\`\`js
// The whole storage layer is this simple:
const note = await fs.readFile('Welcome.md', 'utf8');
\`\`\`

$e^{i\\pi} + 1 = 0$ — math works inline, and in blocks:

$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$

## Getting around

| Shortcut | Action |
| --- | --- |
| \`Ctrl + O\` | Quick switcher |
| \`Ctrl + P\` | Command palette |
| \`Ctrl + E\` | Toggle reading view |
| \`Ctrl + G\` | Graph view |

- [x] Read this note
- [ ] Open [[Linking Your Notes]]
- [ ] Write your first daily note

#obsidian #welcome #meta

![[Daily/2026-11-10]]

> [!warning] Backlinks update automatically
> The panel on the right shows every note that links here.

> [!quote] Anonymous
> The best tool is the one that's yours.

---

Start by starring a #tag, or read [[Markdown Syntax]].`,
  'Linking Your Notes.md': `# Linking Your Notes

Links are the heart of a knowledge base. Type \`[[\` and start typing a note name — obsidian suggests matches from your vault.

## Kinds of links

1. **Wikilinks** — \`[[Graph View]]\` links to a note by name: [[Graph View]]
2. **Aliased** — \`[[Daily Notes|journals]]\` renders as [[Daily Notes|journals]]
3. **Heading links** — \`[[Welcome#Why you'll like it]]\` jumps to a section
4. **Embeds** — \`![[Welcome]]\` pulls a whole note inline (see below)

## Unresolved links

Links to notes that don't exist yet look [[like this]]. Click one to create the note — a great way to plan future writing.

## Backlinks

Every link creates a backlink on the target. This note links to [[Graph View]] and [[Daily Notes]], so it appears in their backlink lists.

#linking #howto`,
  'Graph View.md': `# Graph View

Press \`Ctrl+G\` to open the graph. Each node is a note; each edge is a link.

## What you can do

- **Drag** nodes, **pan** the background, **scroll** to zoom
- Hover to highlight a note's neighborhood
- Click a node to open the note
- Adjust forces in the control panel

The right sidebar also has a *local graph* showing the current note's neighborhood.

## Notes in this demo vault that link here

- [[Welcome]]
- [[Linking Your Notes]]

#graph #visual`,
  'Daily Notes.md': `# Daily Notes

A daily note is a journal entry created with today's date, e.g. \`2026-11-10.md\`. Press \`Ctrl+D\` to open (or create) today's note.

## Template

Daily notes can start from a template in your vault. Tokens like \`{{date}}\` and \`{{title}}\` are replaced automatically.

#daily #howto`,
  'Markdown Syntax.md': `# Markdown Syntax

Everything renders live as you type. Move the cursor onto a line to see its raw syntax.

## Text

**bold**, *italic*, ***both***, ~~strikethrough~~, \`inline code\`, ==highlighted==, and [an external link](https://example.com) (clicks always ask first — privacy).

## Lists

1. Ordered lists
   - Nested bullets
   - Another one
2. Task lists
   - [ ] todo
   - [x] done

## Quotes and code

> Regular quotes still work.

> [!note] This is a callout
> Callouts support many types: note, tip, info, warning, danger, quote, example...

> [!example]- Collapsed callout
> Starts folded. Click the title to expand.

\`\`\`python
def hello(name: str) -> str:
    return f"Hello, {name}!"
\`\`\`

## Tables & footnotes-free extras

| Feature | Supported |
| --- | :---: |
| Tables | ✅ |
| Math | ✅ |
| Callouts | ✅ |

Images and other attachments are stored in your vault and referenced with \`![[file]]\`.

#markdown #reference`,
  'Tags & Search.md': `# Tags & Search

## Tags

Type \`#tag\` anywhere in a note. Tags can nest: #obsidian/sub-feature. The **Tags** panel in the left sidebar lists them all.

## Search

Press \`Ctrl+Shift+F\` for vault-wide search with case-sensitivity, regex and whole-word toggles. Clicking a result opens the note at the matching line.

#search #howto`,
  'Privacy & Security.md': `# Privacy & Security

> [!important] The short version
> obsidian makes **zero** network requests. Your notes never leave the folder you chose.

## How it works

- The app is a local Electron window; a strict CSP blocks remote content
- External links always ask before opening your browser
- Deleted files go to the **Recycle Bin**
- All settings live in a \`.obsidian/\` folder inside your vault — delete it and the app forgets everything

## Verify it yourself

The full source ships with the app. Block it in your firewall if you like — nothing breaks.

#privacy #meta`,
  'Orphan Note.md': `# Orphan Note

No other note links here (yet), so I show up as an isolated node in the [[Graph View]] — and the graph has a toggle to hide orphans like me.

#meta`,
  'Daily/2026-11-10.md': `---
title: 2026-11-10
---

# 2026-11-10

## Today

- Installed obsidian ✅
- Wrote my first notes

## Thoughts

Linked my notes together — the [[Graph View]] is already fun to watch.

#daily`,
};
