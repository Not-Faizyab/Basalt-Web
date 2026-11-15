"use client"

// ─── Slash commands: "/" at the start of a block/line → block-type menu ──────
// Shared by the live-preview block editor and source mode. Every item applies
// a real markdown transformation — no decorative entries.
import { useEffect, useRef } from "react"
import { Heading1, Heading2, Heading3, Heading4, Heading5, Heading6, List, ListOrdered, ListTodo, Quote, Code2, Table, Sigma, Minus, Type, MessageSquareQuote } from "lucide-react"

export interface SlashItem {
  id: string
  label: string
  hint: string
  icon: React.ReactNode
  /** Produces the new text for the block/line + where the caret goes. */
  apply: () => { text: string; caret: number }
}

const H = (n: number, icon: React.ReactNode): SlashItem => ({
  id: `h${n}`,
  label: `Heading ${n}`,
  hint: "#".repeat(n) + " Heading",
  icon,
  apply: () => ({ text: "#".repeat(n) + " ", caret: "#".repeat(n).length + 1 }),
})

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: "text",
    label: "Text",
    hint: "Plain paragraph",
    icon: <Type size={14} />,
    apply: () => ({ text: "", caret: 0 }),
  },
  H(1, <Heading1 size={14} />),
  H(2, <Heading2 size={14} />),
  H(3, <Heading3 size={14} />),
  H(4, <Heading4 size={14} />),
  H(5, <Heading5 size={14} />),
  H(6, <Heading6 size={14} />),
  {
    id: "bullet",
    label: "Bullet list",
    hint: "- Item",
    icon: <List size={14} />,
    apply: () => ({ text: "- ", caret: 2 }),
  },
  {
    id: "numbered",
    label: "Numbered list",
    hint: "1. Item",
    icon: <ListOrdered size={14} />,
    apply: () => ({ text: "1. ", caret: 3 }),
  },
  {
    id: "todo",
    label: "To-do list",
    hint: "- [ ] Task",
    icon: <ListTodo size={14} />,
    apply: () => ({ text: "- [ ] ", caret: 6 }),
  },
  {
    id: "quote",
    label: "Quote",
    hint: "> Quote",
    icon: <Quote size={14} />,
    apply: () => ({ text: "> ", caret: 2 }),
  },
  {
    id: "callout",
    label: "Callout",
    hint: "> [!note] Title",
    icon: <MessageSquareQuote size={14} />,
    apply: () => {
      const t = "> [!note] Title\n> "
      return { text: t, caret: t.length }
    },
  },
  {
    id: "code",
    label: "Code block",
    hint: "``` fenced code",
    icon: <Code2 size={14} />,
    apply: () => ({ text: "```\n\n```", caret: 4 }),
  },
  {
    id: "table",
    label: "Table",
    hint: "2×2 table",
    icon: <Table size={14} />,
    apply: () => {
      const t = "| Column 1 | Column 2 |\n| --- | --- |\n|  |  |"
      return { text: t, caret: 12 }
    },
  },
  {
    id: "math",
    label: "Math block",
    hint: "$$ LaTeX $$",
    icon: <Sigma size={14} />,
    apply: () => ({ text: "$$\n\n$$", caret: 3 }),
  },
  {
    id: "divider",
    label: "Divider",
    hint: "--- horizontal rule",
    icon: <Minus size={14} />,
    apply: () => ({ text: "---", caret: 3 }),
  },
]

/** Filter items by the text typed after "/". */
export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_ITEMS
  return SLASH_ITEMS.filter((i) => i.label.toLowerCase().includes(q) || i.id.includes(q))
}

/** Extract active slash command `{ prefix, query }` from a line/block, or null. */
export function extractSlashQuery(text: string): { prefix: string; query: string } | null {
  if (text.length > 36 || text.includes("\n")) return null
  const m = text.match(/^(\s*(?:[-*+]|\d+[.)]|>)?[ \t]?)\/([^/*\n][^/\n]*)?$/)
  if (!m) return null
  return { prefix: m[1] ?? "", query: m[2] ?? "" }
}

/** Does a block/line consist of just "/query" (or list/quote prefix + "/query")? */
export function isSlashQuery(text: string): boolean {
  return extractSlashQuery(text) !== null
}

/** The popup itself — positioned near caret/block, obs-suggest styling with edge clamp. */
export function SlashMenu({
  items,
  selected,
  onSelect,
  top,
  left,
  onHover,
}: {
  items: SlashItem[]
  selected: number
  onSelect: (item: SlashItem) => void
  top: number
  left: number
  onHover?: (index: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${selected}"]`)?.scrollIntoView({ block: "nearest" })
  }, [selected])

  if (items.length === 0) return null

  const winW = typeof window !== "undefined" ? window.innerWidth : 1200
  const winH = typeof window !== "undefined" ? window.innerHeight : 800
  const estH = Math.min(300, items.length * 34 + 10)
  const clampedLeft = Math.max(8, Math.min(left, winW - 308))
  const clampedTop = top + estH <= winH - 8 ? Math.max(8, top) : Math.max(8, top - estH - 28)

  return (
    <div
      ref={listRef}
      className="obs-suggest fixed z-[70] w-[300px] max-h-[300px] overflow-y-auto p-1"
      style={{ top: clampedTop, left: clampedLeft }}
    >
      {items.map((item, i) => (
        <div
          key={item.id}
          data-idx={i}
          className="obs-tree-row !min-h-[32px] !text-[0.85rem]"
          style={i === selected ? { background: "var(--background-modifier-active-hover)" } : undefined}
          onMouseEnter={() => onHover?.(i)}
          onMouseDown={(e) => {
            e.preventDefault()
            onSelect(item)
          }}
        >
          <span className="opacity-70">{item.icon}</span>
          <span className="truncate">{item.label}</span>
          <span className="ml-auto truncate pl-2 font-mono text-[0.7rem]" style={{ color: "var(--text-faint)" }}>
            {item.hint}
          </span>
        </div>
      ))}
    </div>
  )
}
