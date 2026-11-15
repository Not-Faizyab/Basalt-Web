import { db } from "@/lib/db"

/**
 * Seeds the "Demo Vault" — ~25 interlinked notes engineered to demonstrate
 * every rendering feature and produce a beautiful graph.
 */

type SeedNote = { name: string; content: string }
type SeedFolder = { name: string; notes: SeedNote[]; folders?: SeedFolder[] }

const F = (s: string) => s.replace(/\r\n/g, "\n")

const WELCOME = F(`---
tags:
  - welcome
  - start
aliases:
  - Home
  - Start Here
cssclass: wide-page
---

# Welcome to your vault

This is **Basalt** — a private, flexible Markdown knowledge base built around plain-text files and [[Linking your notes|wiki-links]].

> [!tip] Quick start
> Press \`Ctrl + O\` to jump to any note, or \`Ctrl + P\` to open the **command palette**. Try \`Ctrl + G\` to see the [[Graph view|graph]] of your vault.

## What can I do here?

1. Learn the [[Basics of Markdown]] — formatting, lists, tables, code and tasks
2. Connect ideas with [[Linking your notes]] and explore [[Backlinks and mentions]]
3. Organize with [[Tags & properties]] and [[Maps of content]]
4. Automate with [[Daily notes]], [[Templates]] and the [[Command palette]]
5. See your knowledge as a network in the [[Graph view]]

## Where to go next

- New to note-taking systems? Start with [[Zettelkasten method]] and [[Atomic notes]]
- Working on something? See [[Website redesign]] in *Projects*
- Just exploring? Browse the [[Workshop]] ideas, or check today's [[2026-11-10|daily note]]

> [!note] Everything is connected
> The graph shows how notes reference each other. Notes that don't exist yet — like [[Reading list]] — can be created by simply clicking the link.

#start #guide`)

const BASICS = F(`---
tags:
  - guide
  - start
---

# Basics of Markdown

Basalt is a Markdown editor. Markdown is a lightweight syntax for formatting text — you type a few symbols and the text becomes rich.

## Formatting

You can write **bold**, *italic*, ~~strikethrough~~, ==highlighted== and \`inline code\`.

Combine them freely: ***bold italic***, or **bold with *nested italic***.

## Lists

Unordered lists:

- Milk
- Bread
    - Whole grain
- Coffee

Ordered lists:

1. First
2. Second
3. Third

### Task lists

Task lists (click the checkboxes!):

- [x] Create a vault
- [x] Write my first note
- [ ] Link two notes together
- [ ] Open the [[Graph view]]

## Quotes

> "The palest ink is better than the best memory."
> — Chinese proverb

## Code

Inline code: \`npm run dev\`. Fenced code blocks keep their syntax highlighting:

\`\`\`ts
interface Note {
  id: string
  name: string
  content: string
  links: string[]
}

/** Resolve a [[wikilink]] to a note path. */
export function resolve(target: string): Note | null {
  return notes.find((n) => n.name === target) ?? null
}
\`\`\`

\`\`\`python
def fib(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
\`\`\`

## Tables

| Shortcut | Action | Notes |
| --- | --- | --- |
| \`Ctrl + P\` | Command palette | Run anything |
| \`Ctrl + O\` | Quick switcher | Jump to a note |
| \`Ctrl + E\` | Toggle edit / reading | Per note |
| \`Ctrl + G\` | Graph view | Visualize links |

## Horizontal rule

---

## Links

The most important syntax lives in [[Linking your notes]].

#guide #start`)

const LINKING = F(`---
tags:
  - guide
aliases:
  - Wikilinks
---

# Linking your notes

Links are the whole point of a networked thought tool. Type \`[[\` and start typing a note name — an autocomplete will help you.

## Kinds of links

- A normal link: [[Basics of Markdown]]
- A link with a different display text: [[Basics of Markdown|custom alias]]
- A link to a section: [[Callouts#Foldable callouts]]
- A link to a block: [[Embeds#^block-quote]]
- A link to a note that doesn't exist yet: [[Reading list]] — click it to create the note
- An image or attachment embed: \`![[diagram.png]]\` or \`![Alt text](image.png)\`

## Unresolved links

Links to missing notes are shown in a faded color — they are invitations. Basalt treats them as *potential* notes, and they appear in the [[Graph view]] as faded nodes. ^unresolved

## How linking changes thinking

Instead of sorting notes into rigid folders, let links do the organizing:

1. Write an [[Atomic notes|atomic note]] about one idea
2. Link it to related ideas as you think of them
3. Let [[Maps of content]] emerge as hubs
4. Discover connections you didn't plan via [[Backlinks and mentions]]

> [!quote] Victoria Emeret
> The moment you link one thought to another, you create a path that didn't exist before.

See also: [[Zettelkasten method]], [[Evergreen notes]], [[Tags & properties]]

#guide`)

const TAGS = F(`---
tags:
  - guide
priority: high
reviewed: true
review-count: 3
next-review: 2026-11-15
aliases:
  - Frontmatter
  - Properties
---

# Tags & properties

## Tags

Add a \`#\` before a word anywhere in a note to tag it, like #guide or #method. Tags live in the **Tags** panel on the right sidebar. Click a tag to search for it.

Multi-word tags work too: #deep-work/session

Tags are great for status and categories; links are great for relationships and thoughts. Use both — see [[Linking your notes]].

## Properties

Every note can have a YAML frontmatter block — properties. This note's properties look like this in source mode:

\`\`\`yaml
---
tags:
  - guide
priority: high
reviewed: true
next-review: 2026-11-15
---
\`\`\`

The property editor at the top of this note shows them as a table with typed values:

- **Text** — free-form strings
- **List** — comma-separated arrays (like \`tags\` and \`aliases\`)
- **Number** — numeric values
- **Checkbox** — true / false
- **Date** — calendar dates

Properties power searches like \`tag:#guide\` and can be added from the **Add property** button. See [[Website redesign]] for a project using properties for status and due dates.

#guide`)

const EMBEDS = F(`---
tags:
  - guide
---

# Embeds

Any link can become an **embed** by adding a \`!\` in front. Embedded content renders *inside* the current note, stays live, and can even be edited where it appears.

## Embed a whole note

![[Zettelkasten method]]

## Embed a section

Embed only a heading and its content:

![[Basics of Markdown#Task lists]]

## Embed a specific block

Add \`^\` and the block id in source mode:

![[Linking your notes#^unresolved]]

Embeds work with anything linkable — notes, headings, and blocks. They're the building blocks of dashboards and [[Maps of content]].

#guide`)

const CALLOUTS = F(`---
tags:
  - guide
---

# Callouts

Callouts are colored, foldable blocks for asides, warnings and tips. Twelve types ship by default.

> [!note] Note
> A note callout. Useful background info.

> [!abstract] Abstract / Summary
> A condensed overview.

> [!info] Info
> Neutral information.

> [!tip] Tip
> Helpful advice — like: press \`Ctrl + P\` to open the command palette.

> [!success] Success / Check
> Something completed successfully.

> [!question] Question
> An open question — great for [[Research questions]].

> [!warning] Warning / Caution
> Careful with this one.

> [!failure] Failure / Danger
> Something went wrong.

> [!bug] Bug
> Known issue.

> [!example] Example
> A demonstration of the concept.

> [!quote] Quote
> A quotation with attribution.

> [!todo] Todo
> An outstanding action.

## Foldable callouts

Add \`+\` after the type to make the callout expandable by default, or \`-\` to collapse it:

> [!tip]- Folded by default
> Click the header to expand. This is how the FAQ-style notes are built.

> [!tip]+ Expanded by default
> Click the header to collapse me.

#guide`)

const SHORTCUTS = F(`---
tags:
  - guide
---

# Keyboard shortcuts

Basalt is keyboard-first. The essentials:

## Global

| Shortcut | Action |
| --- | --- |
| \`Ctrl + P\` | Open command palette |
| \`Ctrl + O\` | Open quick switcher |
| \`Ctrl + N\` | Create new note |
| \`Ctrl + E\` | Toggle edit / reading view |
| \`Ctrl + G\` | Open graph view |
| \`Ctrl + Shift + F\` | Search in all files |
| \`Ctrl + ,\` | Open settings |
| \`Alt + ←\` / \`Alt + →\` | Navigate back / forward |
| \`Ctrl + W\` | Close current tab |

## Editor

| Shortcut | Action |
| --- | --- |
| \`Ctrl + B\` | Bold selection |
| \`Ctrl + I\` | Italicize selection |
| \`Ctrl + K\` | Insert external link |
| \`Ctrl + L\` | Toggle checkbox |
| \`Ctrl + D\` | Delete line / block |
| \`Ctrl + F\` | Find in current note |
| \`Ctrl + H\` | Find & replace |
| \`Esc\` | Close popup / stop editing |

The full list lives in **Settings → Hotkeys**, where every command can be rebound.

See also: [[Command palette]], [[Basics of Markdown]]

#guide`)

const GRAPH = F(`---
tags:
  - guide
---

# Graph view

Press \`Ctrl + G\` or click the graph icon in the left ribbon. The graph is an interactive map of how your notes connect.

## Reading the graph

- **Node size** = number of links to that note
- **Colors** = groups you define (by tag or path)
- **Faded nodes** = unresolved links — notes that don't exist yet
- Hover a node to highlight its neighborhood and see labels

## Interacting

- **Drag** a node to pin it
- **Scroll** to zoom, drag the background to pan
- Click the ⚙️ settings icon for filters, groups, display and force controls
- Click a node to open the note

## Local graph

Right-click any note → *Open local graph*, or use the command palette. It shows only the current note's neighborhood, with a depth slider — perfect for staying oriented inside one topic like [[Workshop]].

The graph of this vault was seeded to look interesting on purpose — explore the cluster around [[Zettelkasten method]].

#guide`)

const SEARCH = F(`---
tags:
  - guide
---

# Search tips

Open search with \`Ctrl + Shift + F\` or the left sidebar's magnifier. Beyond plain text, Basalt supports search operators:

| Operator | Matches | Example |
| --- | --- | --- |
| \`tag:\` | Notes with a tag | \`tag:#guide\` |
| \`path:\` | Notes in a path | \`path:Workshop\` |
| \`file:\` | Note names only | \`file:graph\` |
| \`line:( )\` | Terms on the same line | \`line:(zettelkasten links)\` |
| quotes | Exact phrase | \`"atomic notes"\` |
| \`OR\` | Either term | \`graph OR graphview\` |
| parentheses | Grouping | \`(tag:#guide OR tag:#start)\` |

## Tips

- Toggle **Aa** for case-sensitive matching
- Results are grouped per file with contextual snippets — click to jump
- Search for links with \`[[Note name]]\`
- Combine a search with a bookmark: press the bookmark icon next to the search bar

See also: [[Tags & properties]], [[Command palette]]

#guide`)

const DAILY = F(`---
tags:
  - guide
---

# Daily notes

A daily note is a dated journal entry — one click creates today's note using your configured format (default \`YYYY-MM-DD\`) and folder.

## Open today's note

- Click the calendar icon in the left ribbon
- Use the command palette → *Daily notes: Open today's daily note*
- Or from this vault's [[2026-11-10|today's entry]]

## Configuration

In **Settings → Daily notes** you can change:

- The **date format** (e.g. \`YYYY-MM-DD\`)
- The **folder** where dailies are stored (here: \`Daily notes\`)
- The **template** used for new entries (here: [[Daily template]])

Daily notes pair beautifully with [[Templates]] — the template in this vault automatically links to the previous day, projects and a task list.

#guide`)

const TEMPLATES = F(`---
tags:
  - guide
---

# Templates

Templates let you insert reusable content into any note — boilerplate, structure, checklists.

## Using templates

1. Keep template files in a folder — this vault uses \`Templates\`
2. Point **Settings → Templates** at that folder
3. Run the command palette → *Templates: Insert template*, or use the ribbon icon
4. Pick a template from the list — it's inserted at your cursor

## Placeholder tokens

| Token | Expands to |
| --- | --- |
| \`{{title}}\` | The current note's title |
| \`{{date}}\` | Today's date (configurable format) |
| \`{{time}}\` | Current time |

This vault ships two templates: [[Daily template]] and [[Meeting notes template]]. See [[Daily notes]] for how dailies use them automatically.

#guide`)

const COMPOSER = F(`---
tags:
  - guide
---

# Note composer

Note composer is the pair of commands for restructuring notes:

## Extract selection

Select text, run *Note composer: Extract current selection*, give the new note a name — and the selection becomes a new note, replaced by a link to it. Perfect for growing an [[Atomic notes|atomic note]] out of a paragraph that outgrew its home.

## Merge current file with another file

The inverse: folds the current note into another note, leaving a link (or nothing) behind.

Both commands are in the command palette and the editor's ⋯ menu.

#guide`)

const ZETTEL = F(`---
tags:
  - method
aliases:
  - Zettelkasten
---

# Zettelkasten method

The **Zettelkasten** (German: "slip-box") is a note-taking method developed by sociologist Niklas Luhmann, who used it to write more than 70 books and hundreds of articles.

## Core principles

1. **One idea per note** — see [[Atomic notes]]
2. **Write in your own words** — a note you can't understand later is worthless
3. **Link relentlessly** — every new note must be connected to at least one existing note, following [[Linking your notes]]
4. **No rigid categories** — structure emerges bottom-up, visible in the [[Graph view]]

## The three kinds of notes

- **Fleeting notes** — quick captures, processed or deleted daily (your [[Daily notes]])
- **Literature notes** — what a source said, in your words, with a reference
- **Permanent notes** — polished, atomic, densely linked ideas like [[Evergreen notes]]

> [!quote] Niklas Luhmann
> One cannot think without writing.

Related: [[Atomic notes]], [[Evergreen notes]], [[Progressive summarization]], [[Spaced repetition]]

#method`)

const ATOMIC = F(`---
tags:
  - method
---

# Atomic notes

An atomic note contains **exactly one idea** — small enough to hold in your head, big enough to be useful.

## Why atomic?

- A note with one idea gets **one title** that means one thing
- Links become precise: pointing at *this* idea, not a document full of them
- Notes become **recombinable** — the same atom can support many arguments
- Rewriting is cheap, so notes can be improved forever — the idea behind [[Evergreen notes]]

## Rules of thumb

1. If a note needs "and" in the title, split it
2. Title notes as full claims when possible: *"Notes improve with revision, not accumulation"*
3. When a note grows past ~300 words, look for the seam and split it — the [[Zettelkasten method]] call this a luhmann-id moment

> [!tip] Practice
> Take your last long meeting note and split it into atoms. You'll find 3–5 ideas hiding in it.

#method`)

const EVERGREEN = F(`---
tags:
  - method
aliases:
  - Evergreen note
---

# Evergreen notes

Evergreen notes are written to **accumulate value over time** (Andy Matuschak's term). Unlike a journal entry or a meeting note, an evergreen note is revised, renamed and re-linked as your understanding improves.

## Qualities of an evergreen note

- **Concept-oriented** — about an idea, not an event
- **Densely linked** — connected into the web of [[Atomic notes]]
- **Written for your future self** — complete sentences, no shorthand
- **Continuously revised** — you'll revisit it whenever a linked note changes

## Evergreen vs. fleeting

| | Fleeting | Evergreen |
| --- | --- | --- |
| Lifetime | Days | Forever |
| Audience | Present you | Future you |
| Editing | None | Constant |
| Example | [[2026-11-10]] | [[Zettelkasten method]] |

#method`)

const PROGRESSIVE = F(`---
tags:
  - method
---

# Progressive summarization

Tiago Forte's technique for layering emphasis onto notes as you revisit them, so the important parts surface themselves.

## The layers

1. **Layer 0** — the original source note
2. **Layer 1** — bold the parts that matter
3. **Layer 2** — *italicize* the best of the bold
4. **Layer 3** — ==highlight== the essential
5. **Layer 4** — write a tiny summary in your own words

Each pass is optional and opportunistic: only summarize what proves useful. Over time each note becomes a compressed version of itself — like ==this sentence==, which survived four revisits.

Pair it with [[Spaced repetition]] to resurface notes on a schedule, and keep the source atomic ([[Atomic notes]]).

#method`)

const SPACED = F(`---
tags:
  - method
---

# Spaced repetition

Spaced repetition resurfaces knowledge at increasing intervals, exploiting the *spacing effect*: memory strengthens most when recall is attempted just before forgetting.

## Why it works

> [!abstract] The spacing effect
> Reviews are most effective when scheduled at the moment recall is about to fail — each successful, effortful recall pushes the forgetting curve further out.

## Applying it to notes

- Review notes at expanding intervals: 1 day → 1 week → 1 month
- Question-driven: convert a note's claim into a question, quiz yourself first
- Tools like Anki schedule this automatically; a simple "next-review" property (like in [[Tags & properties]]) plus a daily check works too

This is the retrieval half of the learning loop; [[Progressive summarization]] is the compression half.

#method`)

const MOC = F(`---
tags:
  - structure
aliases:
  - MOC
  - Map of Content
---

# Maps of content

A **map of content** (MOC) is a hub note that curates links to a topic — a table of contents you write yourself. Structure in Basalt is emergent: folders stay shallow, MOCs do the organizing.

## Anatomy of a good MOC

- A one-paragraph definition of the topic
- Links grouped by sub-theme, not exhaustive
- Notes that earn their place through repeated linking — you can see candidates in the [[Graph view]]
- A link back "up" to broader MOCs when one exists

## This vault's structure

- [[Welcome]] — the entry point
- [[Workshop]]-adjacent methods: [[Zettelkasten method]], [[Atomic notes]], [[Evergreen notes]], [[Progressive summarization]], [[Spaced repetition]]
- Guides: [[Search tips]], [[Graph view]], [[Daily notes]], [[Templates]]

When a MOC gets crowded, split it: the same logic as [[Atomic notes]].

#structure`)

const RESEARCH = F(`---
status: in-progress
priority: 8
tags:
  - project
---

# Research questions

Open questions collected while working on [[Website redesign]] and reading about knowledge management.

## Open

- [ ] Does tool choice ([[Basalt tooling|tooling]]) actually affect note quality, or only note *quantity*?
- [ ] What's the retention difference between [[Spaced repetition]] and rereading? (paper: Dunlosky 2013)
- [ ] How large does a [[Zettelkasten method|Zettelkasten]] need to be before emergent structure appears?
- [ ] Is [[Progressive summarization]] worth the overhead for teams, or only individuals?

## Answered

- [x] Can a web app replicate Obsidian faithfully? — **Yes.** You're looking at Basalt.
- [x] Do unresolved links belong in the graph? — Yes, as faded nodes. See [[Linking your notes]].

> [!question] Your turn
> Add a question, then link it to a note where the answer might live — perhaps [[Reading list]].

#project`)

const WEBSITE = F(`---
status: in progress
priority: high
due: 2026-11-30
team:
  - Maya
  - Jonas
  - Priya
tags:
  - project
---

# Website redesign

> [!info] Project brief
> Refresh the marketing site: new type system, case studies, and a docs area. Due end of November.

## Milestones

- [x] Stakeholder interviews
- [x] Content audit
- [ ] Wireframes — *Maya*
- [ ] Type & color system
- [ ] Docs area IA
- [ ] Launch checklist

## Notes

- Audit summary lives in [[2026-11-09|Monday's daily note]]
- Open questions tracked in [[Research questions]]
- The [[Workshop]] methods inform how we keep project notes linked

## Log

| Date | Entry |
| --- | --- |
| 2026-11-08 | Kickoff, scope agreed |
| 2026-11-09 | Content audit done — 214 pages, 61% stale |
| 2026-11-10 | Started wireframes |

#project`)

const IDEAS = F(`---
tags:
  - idea
---

# Ideas

A scratchpad of unpolished ideas. None of these are linked yet — which is exactly why the **unlinked mentions** section of [[Evergreen notes]] and [[Zettelkasten method]] is useful: it finds text that *could* be a link.

1. An evergreen notes garden where notes "decay" without reviews
2. Zettelkasten method but every note must fit a single screenshot
3. A plugin that auto-suggests links from unlinked mentions
4. Weekly review template that queries tasks across all daily notes

> [!tip] Try it
> Open [[Evergreen notes]] and check its **Unlinked mentions** panel — this note appears there. Press *Link* to convert the mention into a real link.

#idea`)

const DAILY_TEMPLATE = F(`---
tags:
  - daily
---

# {{title}}

<< [[{{prev_daily}}]] | [[{{next_daily}}]] >>

## Tasks

- [ ]

## Focus

What matters today:

## Notes

#daily`)

const MEETING_TEMPLATE = F(`---
tags:
  - meeting
attendees:
---

# {{title}}

**Date:** {{date}} {{time}}

## Agenda

-

## Notes

## Action items

- [ ]

#meeting`)

const D8 = F(`---
tags:
  - daily
---

# 2026-11-08

## Tasks

- [x] Kick off [[Website redesign]]
- [x] Set up this vault and read [[Welcome]]
- [ ] Start [[Reading list]]

## Focus

Setting up the system: folders, templates, daily notes.

## Notes

- The [[Zettelkasten method]] intro video was good; skimming [[Atomic notes]] next
- Question for tomorrow: when do [[Maps of content]] become worth building?

#daily`)

const D9 = F(`---
tags:
  - daily
---

# 2026-11-09

<< [[2026-11-08]] | [[2026-11-10]] >>

## Tasks

- [x] Content audit for [[Website redesign]] — 214 pages, 61% stale
- [x] Read [[Evergreen notes]] and [[Progressive summarization]]
- [ ] Convert two ideas from [[Ideas]] into atomic notes

## Focus

Deep work block on the audit; capture friction is real — everything goes to [[Ideas]] first.

## Notes

- The unlinked mentions panel in [[Evergreen notes]] is a link-harvesting machine
- Wireframes start tomorrow with Maya

#daily`)

const D10 = F(`---
tags:
  - daily
---

# 2026-11-10

<< [[2026-11-09]] | [[2026-11-11]] >>

## Tasks

- [ ] Wireframe review with Maya ([[Website redesign]])
- [ ] Process [[Ideas]] into [[Atomic notes]]
- [ ] Answer one [[Research questions|research question]]
- [ ] Read [[Spaced repetition]] and schedule reviews

## Focus

Wireframes in the morning, note-processing in the afternoon.

## Notes

- Today this vault became a web app. Everything still feels local.
- The [[Graph view]] cluster around [[Zettelkasten method]] is getting dense — time for a [[Maps of content|map of content]]?

#daily`)

const WORKSHOP_HUB = F(`---
tags:
  - structure
---

# Workshop

A loose collection of note-taking methods. These work best combined:

- [[Zettelkasten method]] — the grandfather system
- [[Atomic notes]] — the unit of thought
- [[Evergreen notes]] — notes that compound
- [[Progressive summarization]] — layered emphasis
- [[Spaced repetition]] — resurfacing on a schedule

Start anywhere; they all point at each other. The [[Graph view]] makes the cluster easy to see.

#structure`)

const READING = F(`---
tags:
  - list
status: evergreen
---

# Reading list

- *How to Take Smart Notes* — Sönke Ahrens → [[Zettelkasten method]]
- *Building a Second Brain* — Tiago Forte → [[Progressive summarization]]
- *How to Read a Book* — Adler & Van Doren
- Andy Matuschak's notes → [[Evergreen notes]]
- Dunlosky et al. 2013, *Improving Students' Learning* → [[Spaced repetition]]

#list`)

const BASALT_TOOLING = F(`---
tags:
  - guide
---

# Basalt tooling

The pieces of this app that make a vault feel alive:

- [[Command palette]] — every action, one keystroke away
- [[Quick switcher]] — fuzzy-find any note by name
- [[Graph view]] — the map of the vault
- [[Backlinks and mentions]] — what links here?
- [[Daily notes]] — journaling with zero friction
- [[Templates]] — stop retyping structure
- [[Note composer]] — refactor notes like code

> [!info] Web edition
> This replica stores your vault server-side, so it survives reloads and works in any browser. Everything else — the editor, the linking, the graph — behaves like the desktop app.

#guide`)

const BACKLINKS = F(`---
tags:
  - guide
aliases:
  - Backlinks
---

# Backlinks and mentions

Open the right sidebar's **Backlinks** tab (or press the link count in the status bar). Backlinks answer the question every folder-based system fails at: *what points here?*

## Linked mentions

Notes containing a \`[[link]]\` to the current note, with the surrounding context. Click a mention to jump to the source.

## Unlinked mentions

Occurrences of the note's *name* in other notes that aren't links yet — with a **Link** button that converts them in place. This is the cheapest way to densify your graph; [[Ideas]] is full of them for exactly this reason.

## In the graph

Every backlink is an edge in the [[Graph view]]. Hubs like [[Zettelkasten method]] get big nodes precisely because many notes point at them.

#guide`)

const COMMAND_PALETTE = F(`---
tags:
  - guide
aliases:
  - Palette
---

# Command palette

Press \`Ctrl + P\`. The palette lists every command in the app with its hotkey — editor actions, navigation, plugin commands — filtered as you type.

## Tips

- Start typing to fuzzy-search commands
- Everything in the [[Keyboard shortcuts|shortcuts table]] is a command too
- Commands respect context: graph commands appear in graph tabs, editor commands in notes
- \`Ctrl + O\` is the sibling palette for **files** — the [[Quick switcher]]

If you can't find a feature, the palette is the fastest way to reach it.

#guide`)

const QUICK_SWITCHER = F(`---
tags:
  - guide
aliases:
  - Switcher
---

# Quick switcher

Press \`Ctrl + O\` and type. The switcher fuzzy-matches note names (and [[Tags & properties|aliases]]), showing the full path under each result.

- \`Enter\` opens the top hit
- \`Ctrl + Enter\` opens it in a new tab
- \`↑\` \`↓\` move through results
- No match? The first result becomes **Create note** — pressing Enter creates it on the spot

This is the fastest way to navigate a vault: type three letters, hit Enter, keep writing.

#guide`)

export async function seedDemoVault() {
  const existing = await db.vault.findFirst({ where: { name: "Demo Vault" } })
  if (existing) return existing

  const vault = await db.vault.create({ data: { name: "Demo Vault" } })

  const tree: SeedFolder[] = [
    {
      name: "Getting Started",
      notes: [
        { name: "Basics of Markdown", content: BASICS },
        { name: "Linking your notes", content: LINKING },
        { name: "Tags & properties", content: TAGS },
        { name: "Embeds", content: EMBEDS },
        { name: "Callouts", content: CALLOUTS },
        { name: "Keyboard shortcuts", content: SHORTCUTS },
      ],
    },
    {
      name: "Guides",
      notes: [
        { name: "Graph view", content: GRAPH },
        { name: "Search tips", content: SEARCH },
        { name: "Daily notes", content: DAILY },
        { name: "Templates", content: TEMPLATES },
        { name: "Note composer", content: COMPOSER },
        { name: "Backlinks and mentions", content: BACKLINKS },
        { name: "Command palette", content: COMMAND_PALETTE },
        { name: "Quick switcher", content: QUICK_SWITCHER },
        { name: "Basalt tooling", content: BASALT_TOOLING },
      ],
    },
    {
      name: "Workshop",
      notes: [
        { name: "Workshop", content: WORKSHOP_HUB },
        { name: "Zettelkasten method", content: ZETTEL },
        { name: "Atomic notes", content: ATOMIC },
        { name: "Evergreen notes", content: EVERGREEN },
        { name: "Progressive summarization", content: PROGRESSIVE },
        { name: "Spaced repetition", content: SPACED },
        { name: "Maps of content", content: MOC },
      ],
    },
    {
      name: "Projects",
      notes: [
        { name: "Website redesign", content: WEBSITE },
        { name: "Research questions", content: RESEARCH },
      ],
    },
    {
      name: "Templates",
      notes: [
        { name: "Daily template", content: DAILY_TEMPLATE },
        { name: "Meeting notes template", content: MEETING_TEMPLATE },
      ],
    },
    {
      name: "Daily notes",
      notes: [
        { name: "2026-11-08", content: D8 },
        { name: "2026-11-09", content: D9 },
        { name: "2026-11-10", content: D10 },
      ],
    },
  ]

  for (const [fi, f] of tree.entries()) {
    const folder = await db.folder.create({
      data: { vaultId: vault.id, name: f.name, parentId: null, position: fi },
    })
    for (const [ni, note] of f.notes.entries()) {
      await db.note.create({
        data: { vaultId: vault.id, folderId: folder.id, name: note.name, content: note.content, position: ni },
      })
    }
  }

  // Root-level notes
  const rootNotes: SeedNote[] = [
    { name: "Welcome", content: WELCOME },
    { name: "Ideas", content: IDEAS },
    { name: "Reading list", content: READING },
  ]
  for (const [ni, note] of rootNotes.entries()) {
    await db.note.create({
      data: { vaultId: vault.id, folderId: null, name: note.name, content: note.content, position: ni },
    })
  }

  return vault
}
