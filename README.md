# Basalt Web

[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-blue?logo=react)](https://react.dev/)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss)](https://tailwindcss.com/)
[![Prisma](https://img.shields.io/badge/Prisma-SQLite-2D3748?logo=prisma)](https://www.prisma.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Basalt Web** is a modern, self-hostable personal knowledge management (PKM) system and infinite canvas built for the browser. Inspired by the core Obsidian workflow, it gives you linked Markdown notes, interactive knowledge graphs, spatial canvas boards, and distraction-free writing right in your web browser.

---

## Features

### Live Preview & Continuous Markdown Editor

- **WYSIWYG-style Live Preview**: Formats Markdown inline as you write with live typography, code blocks, task lists, and tables.
- **Continuous Writing Flow**: Intuitive, full-page typing experience—no Notion-style block lockups, no jumping cursors, and zero disappearing blank lines.
- **List Continuation**: Hit `Enter` on bulleted or numbered lists to automatically continue; hit `Enter` on an empty marker to cleanly exit.
- **Mode Switching**: Instant toggle between **Live Preview**, **Source Mode**, and **Reading View** (`Ctrl+E`).
- **LaTeX Math & Callouts**: Full KaTeX math rendering (`$inline$` and `$$block$$`), syntax highlighting, and Obsidian-style callout boxes (`> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`).

<img width="1901" height="1046" alt="image" src="https://github.com/user-attachments/assets/9e1727d4-966a-46e4-ab55-ad4e04297ad2" />

### Bi-directional Linking & Knowledge Graph

- **`[[Wikilinks]]`**: Fast autocomplete for internal links with display aliases (`[[Note|Alias]]`) and section anchors (`[[Note#Heading]]`).
- **Backlinks & Unlinked Mentions**: Dedicated panel showing all referencing notes, context snippets, and one-click unlinked mention linking.
- **Interactive Graph View (`Ctrl+G`)**: Force-directed 2D visualization of your entire second brain with neighborhood highlighting, tag filtering, and physics controls.

<img width="1905" height="1046" alt="image" src="https://github.com/user-attachments/assets/38058718-7ea0-4114-8824-cc1370b109cc" />

### Infinite Canvas (`.canvas`)

- **Spatial Thinking**: Infinite zoomable, pannable 2D whiteboard.
- **Cards & Notes**: Place Markdown text cards, embed existing notes, color-code nodes, and duplicate or organize ideas freely with keyboard shortcuts (`Ctrl+C`, `Ctrl+V`, `Ctrl+D`).

<img width="1908" height="1042" alt="image" src="https://github.com/user-attachments/assets/6ff955a4-52db-42ca-a9d7-25e72604f616" />

### Navigation & Productivity

- **Quick Switcher (`Ctrl+O`)**: Fuzzy search notes by name or create a new note on the fly by pressing `Enter`.
- **Command Palette (`Ctrl+P`)**: Access every action, view, and setting directly from your keyboard.
- **Vault Search (`Ctrl+Shift+F`)**: Powerful full-text search engine with advanced operators (`tag:#work`, `path:Projects`, `task-todo:`, `task-done:`, `-negation`, `OR`).
- **Daily Notes & Templates (`Ctrl+Shift+D`)**: Auto-generate daily logs with dynamic timestamp variables (`{{date}}`, `{{time}}`, `{{title}}`).
- **Properties & YAML Frontmatter**: Visual metadata editor for note tags, dates, and custom frontmatter attributes.
- **Themes**: Obsidian-accurate **Default Dark** and **Moonstone Light** modes.

---

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router)
- **UI Library**: [React 19](https://react.dev/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) + Radix UI primitives
- **Database / ORM**: [Prisma ORM](https://www.prisma.io/) with SQLite (zero-config, portable)
- **Graph Engine**: [d3-force](https://github.com/d3/d3-force)
- **Math Rendering**: [KaTeX](https://katex.org/)

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18.18+ or v20+ recommended)
- `npm`, `pnpm`, or `yarn`

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/your-username/basalt-web.git
   cd basalt-web
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Initialize the SQLite database:**

   ```bash
   npx prisma db push
   ```

4. **Start the local development server:**

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Default Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl + P` | Open Command Palette |
| `Ctrl + O` | Open Quick Switcher |
| `Ctrl + N` | Create New Note |
| `Ctrl + E` | Toggle Reading / Editing View |
| `Ctrl + G` | Open Graph View |
| `Ctrl + Shift + D` | Open Today's Daily Note |
| `Ctrl + Shift + F` | Search Entire Vault |
| `Ctrl + F` / `Ctrl + H` | Find / Replace in Note |
| `Ctrl + B` / `Ctrl + I` | Bold / Italic Selection |
| `Ctrl + W` | Close Active Tab |
| `Ctrl + ,` | Settings |
| `Alt + ←` / `Alt + →` | Navigate Tab History Back / Forward |

---

## Production Build & Self-Hosting

### Standalone Node.js Build

```bash
npm run build
npm start
```

### Docker (Optional)

Basalt Web is completely self-contained with SQLite, making it trivial to run behind Nginx, Caddy, or inside a Docker container on your NAS or home server.

---

## License

This project is licensed under the [MIT License](LICENSE).

*Disclaimer: Basalt is an independent open-source project inspired by the Obsidian workflow. It is not affiliated with, endorsed by, or derived from Obsidian (Dynalist Inc.).*
