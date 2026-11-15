"use client"

// ─── obsidian-exact right-click context menus ────────────────────────────────
// Structure mirrors obsidian 1.x (text-only items, hotkeys right-aligned,
// submenu arrows — exactly like obsidian's own Menu component):
//   • editor (live preview + source): Cut/Copy/Paste/Paste as plain text ·
//     Format ▸ · Paragraph ▸ · Insert ▸ · Select line (+ Note Composer section
//     and a link section when the caret is on a link)
//   • reading view: link menu / Copy / Select all
//   • file explorer: Open in new tab / Open to the right / Open in new window ·
//     Make a copy · Move file to folder… · Merge entire file with… · Bookmark… ·
//     Copy path ▸ · Open version history · Open with default app ·
//     Reveal in system explorer · Rename… · Delete
//   • tabs: Pin/Unpin · Close · Close others · Close all
import { create } from "zustand"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useWorkspace } from "../stores/workspace"
import { useUi } from "../stores/ui"
import { toast } from "sonner"

// ─── Menu model ──────────────────────────────────────────────────────────────

export interface MenuAction {
  type?: "action"
  icon?: React.ReactNode
  label: string
  hotkey?: string
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
  sub?: MenuItem[]
}
export interface MenuSeparator {
  type: "separator"
}
export type MenuItem = MenuAction | MenuSeparator

interface MenuState {
  open: boolean
  x: number
  y: number
  items: MenuItem[]
  openMenu: (x: number, y: number, items: MenuItem[]) => void
  closeMenu: () => void
}

export const useContextMenu = create<MenuState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  openMenu: (x, y, items) => set({ open: true, x, y, items }),
  closeMenu: () => set({ open: false, items: [] }),
}))

/** Open a menu at a mouse event's position. */
export function showMenuAt(e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[]) {
  e.preventDefault()
  useContextMenu.getState().openMenu(e.clientX, e.clientY, items)
}

export function closeContextMenu() {
  useContextMenu.getState().closeMenu()
}

/** Global marker so editors can skip blur-commit while a menu is open. */
declare global {
  interface Window {
    __obsMenuActive?: number
  }
}

// ─── Host (mount once, at app root) ─────────────────────────────────────────

export function ContextMenuHost() {
  const { open, x, y, items } = useContextMenu()

  useEffect(() => {
    if (open) {
      window.__obsMenuActive = (window.__obsMenuActive ?? 0) + 1
      return () => {
        window.__obsMenuActive = Math.max(0, (window.__obsMenuActive ?? 1) - 1)
      }
    }
  }, [open])

  if (!open || items.length === 0) return null

  return createPortal(
    <>
      <div
        className="fixed inset-0"
        style={{ zIndex: 299 }}
        onMouseDown={(e) => {
          e.preventDefault()
          closeContextMenu()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          closeContextMenu()
        }}
      />
      <MenuPanel x={x} y={y} items={items} onDone={() => closeContextMenu()} />
    </>,
    document.body,
  )
}

// ─── One menu panel (recursive for submenus) ────────────────────────────────

function MenuPanel({
  x,
  y,
  items,
  onDone,
  depth = 0,
}: {
  x: number
  y: number
  items: MenuItem[]
  onDone: () => void
  depth?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [highlight, setHighlight] = useState(-1)
  const [subOpen, setSubOpen] = useState<number | null>(null)
  const [subRect, setSubRect] = useState<{ x: number; y: number } | null>(null)

  // flip to fit the viewport
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let nx = x
    let ny = y
    if (nx + r.width > window.innerWidth - 8) nx = Math.max(8, window.innerWidth - r.width - 8)
    if (ny + r.height > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - r.height - 8)
    if (nx !== x || ny !== y) setPos({ x: nx, y: ny })
  }, [x, y, items])

  const actionable = items.map((it, i) => ({ it, i })).filter(({ it }) => it.type !== "separator")

  // keyboard navigation (only the deepest open submenu handles keys)
  const isDeepest = subOpen === null
  useEffect(() => {
    if (!isDeepest) return
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        if (depth === 0) onDone()
        else setSubOpen(null)
        return
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        e.stopPropagation()
        const dir = e.key === "ArrowDown" ? 1 : -1
        let next = highlight
        for (let step = 0; step < actionable.length; step++) {
          next = (next + dir + actionable.length + 1) % (actionable.length + 1)
          if (next === actionable.length) next = 0
          const entry = actionable.find((a) => a.i === next)
          if (entry && entry.it.type !== "separator") {
            const disabled = (entry.it as MenuAction).disabled
            if (!disabled) break
          }
        }
        setHighlight(next)
        return
      }
      if (e.key === "Enter" && highlight >= 0) {
        const item = items[highlight] as MenuAction
        if (!item.disabled) {
          e.preventDefault()
          e.stopPropagation()
          if (item.sub) {
            setSubOpen(highlight)
          } else {
            onDone()
            item.onClick?.()
          }
        }
        return
      }
      if (e.key === "ArrowRight" && highlight >= 0) {
        const item = items[highlight] as MenuAction
        if (item.sub) {
          e.preventDefault()
          e.stopPropagation()
          setSubOpen(highlight)
        }
      }
    }
    window.addEventListener("keydown", h, true)
    return () => window.removeEventListener("keydown", h, true)
  }, [highlight, items, actionable, isDeepest, depth, onDone])

  const openSub = (i: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setSubRect({ x: r.right - 4, y: r.top - 5 })
    setSubOpen(i)
  }

  return (
    <div ref={ref} className="obs-menu obs-anim-in" style={{ left: pos.x, top: pos.y }} role="menu">
      {items.map((item, i) =>
        item.type === "separator" ? (
          <div key={i} className="obs-menu-separator" />
        ) : (
          <button
            key={i}
            // obsidian menus never steal focus from the editor — the caret
            // stays exactly where it was while the menu is open.
            onMouseDown={(e) => e.preventDefault()}
            className={`obs-menu-item ${item.disabled ? "is-disabled" : ""} ${item.danger ? "is-danger" : ""} ${highlight === i ? "is-highlighted" : ""}`}
            onMouseEnter={(e) => {
              setHighlight(i)
              if (item.sub) {
                openSub(i, e.currentTarget)
              } else {
                setSubOpen(null)
              }
            }}
            onClick={(e) => {
              if (item.disabled) return
              if (item.sub) {
                openSub(i, e.currentTarget as HTMLElement)
                return
              }
              onDone()
              item.onClick?.()
            }}
          >
            <span className="obs-menu-item-icon">{item.icon}</span>
            <span className="obs-menu-item-title">{item.label}</span>
            {item.hotkey && <span className="obs-menu-item-hotkey">{item.hotkey}</span>}
            {item.sub && <span className="obs-menu-item-sub-indicator">▸</span>}
            {item.sub && subOpen === i && subRect && (
              <MenuPanel x={subRect.x} y={subRect.y} items={item.sub} onDone={onDone} depth={depth + 1} />
            )}
          </button>
        ),
      )}
    </div>
  )
}

// ─── Textarea text operations (shared by live preview + source mode) ────────

/** Set a textarea value the React-friendly way and restore selection. */
function setTa(ta: HTMLTextAreaElement, value: string, selStart: number, selEnd: number) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
  setter?.call(ta, value)
  ta.dispatchEvent(new Event("input", { bubbles: true }))
  ta.focus({ preventScroll: true })
  ta.setSelectionRange(selStart, selEnd)
}

/** Toggle an inline marker around the selection (obsidian's toggle semantics). */
export function applyInlineFormat(ta: HTMLTextAreaElement, marker: string, placeholder = "") {
  const s = ta.selectionStart
  const e = ta.selectionEnd
  const value = ta.value
  const sel = value.slice(s, e)
  const before = value.slice(0, s)
  const after = value.slice(e)

  // already wrapped inside the selection → unwrap
  if (sel.length >= marker.length * 2 && sel.startsWith(marker) && sel.endsWith(marker)) {
    const inner = sel.slice(marker.length, sel.length - marker.length)
    setTa(ta, before + inner + after, s, s + inner.length)
    return
  }
  // markers just outside the selection → unwrap
  if (before.endsWith(marker) && after.startsWith(marker)) {
    setTa(ta, before.slice(0, before.length - marker.length) + sel + after.slice(marker.length), s - marker.length, e - marker.length)
    return
  }
  const body = sel || placeholder
  const text = marker + body + marker
  setTa(ta, before + text + after, s, s + text.length)
  if (!sel) {
    // caret inside the markers
    requestAnimationFrame(() => ta.setSelectionRange(s + marker.length, s + marker.length))
  }
}

/** Strip all inline formatting markers from the selection. */
export function clearInlineFormatting(ta: HTMLTextAreaElement) {
  const s = ta.selectionStart
  const e = ta.selectionEnd
  let start = s
  let end = e
  if (start === end) {
    // no selection: clear the whole line's inline markers
    start = ta.value.lastIndexOf("\n", s - 1) + 1
    end = ta.value.indexOf("\n", s) === -1 ? ta.value.length : ta.value.indexOf("\n", s)
  }
  const raw = ta.value.slice(start, end)
  const cleaned = raw
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/==(.+?)==/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
  setTa(ta, ta.value.slice(0, start) + cleaned + ta.value.slice(end), start, start + cleaned.length)
}

type ParagraphStyle = "text" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "quote" | "callout" | "bullet" | "number" | "task"

/** Line prefix of an existing block style, to be replaced. */
const BLOCK_PREFIX = /^(\s*)(?:#{1,6}(?:\s+)|>\s*\[!\w+\]\s*(?:.*)?(?:\s+)|>\s+|[-*+]\s+\[[ xX/-]\]\s+|[-*+]\s+|\d+[.)]\s+)?/

/** Transform the paragraph type of the selected line(s). */
export function applyParagraphStyle(ta: HTMLTextAreaElement, style: ParagraphStyle) {
  const value = ta.value
  let ls = value.lastIndexOf("\n", ta.selectionStart - 1) + 1
  let endSearch = value.indexOf("\n", Math.max(ta.selectionEnd - 1, ta.selectionStart))
  let le = endSearch === -1 ? value.length : endSearch
  // multi-line selection: cover every touched line
  const lineText = value.slice(ls, le)
  if (lineText.includes("\n")) le = le

  const prefixOf = (line: string): string => {
    switch (style) {
      case "text":
        return ""
      case "h1":
        return "# "
      case "h2":
        return "## "
      case "h3":
        return "### "
      case "h4":
        return "#### "
      case "h5":
        return "##### "
      case "h6":
        return "###### "
      case "quote":
        return "> "
      case "callout":
        return "> [!note] "
      case "bullet":
        return "- "
      case "number":
        return "1. "
      case "task":
        return "- [ ] "
    }
  }

  const transformed = lineText
    .split("\n")
    .map((line, idx) => {
      const m = line.match(BLOCK_PREFIX)
      const indent = m?.[1] ?? ""
      let body = line.slice((m?.[0] ?? line).length)
      let prefix = prefixOf(line)
      if (style === "callout") {
        // keep existing callout type when re-applying
        const cm = line.match(/^>\s*\[!(\w+)\]/)
        if (cm) prefix = `> [!${cm[1]}] `
      }
      if (style === "number") prefix = `${idx + 1}. `
      // toggling the same style off (obsidian: clicking "Bullet list" on a bullet un-bullets)
      const currentPrefix = (m?.[0] ?? "").trim()
      const same =
        (style === "bullet" && /^[-*+]\s/.test(currentPrefix)) ||
        (style === "task" && /^[-*+]\s+\[[ xX/-]\]/.test(currentPrefix)) ||
        (style === "number" && /^\d+[.)]\s/.test(currentPrefix)) ||
        (style === "quote" && /^>/.test(currentPrefix))
      if (same) {
        prefix = ""
        body = line.slice((m?.[0] ?? line).length)
        return indent + body
      }
      if (style === "callout" && body.trim() === "") body = "Title"
      return indent + prefix + body
    })
    .join("\n")

  setTa(ta, value.slice(0, ls) + transformed + value.slice(le), ls, ls + transformed.length)
}

/** Insert a block-level snippet at the caret as its own paragraph. */
export function insertBlock(ta: HTMLTextAreaElement, text: string) {
  const value = ta.value
  const s = ta.selectionStart
  // find the current line end so the snippet starts on a fresh line
  let le = value.indexOf("\n", s)
  if (le === -1) le = value.length
  const line = value.slice(value.lastIndexOf("\n", s - 1) + 1, le)
  const atEmptyLine = line.trim() === ""
  const insert = (atEmptyLine ? "" : "\n\n") + text + "\n"
  setTa(ta, value.slice(0, le) + insert + value.slice(le), le + insert.length, le + insert.length)
}

/** obsidian's "Select line". */
export function selectLine(ta: HTMLTextAreaElement) {
  const value = ta.value
  const ls = value.lastIndexOf("\n", ta.selectionStart - 1) + 1
  const ni = value.indexOf("\n", ta.selectionEnd)
  const le = ni === -1 ? value.length : ni
  ta.focus({ preventScroll: true })
  ta.setSelectionRange(ls, le)
}

async function copySelection(ta: HTMLTextAreaElement): Promise<boolean> {
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd)
  if (!sel) return false
  try {
    await navigator.clipboard.writeText(sel)
    return true
  } catch {
    return document.execCommand("copy")
  }
}

async function cutSelection(ta: HTMLTextAreaElement): Promise<boolean> {
  const s = ta.selectionStart
  const e = ta.selectionEnd
  if (s === e) return false
  const ok = await copySelection(ta)
  if (ok) setTa(ta, ta.value.slice(0, s) + ta.value.slice(e), s, s)
  return ok
}

async function readClipboardText(): Promise<string | null> {
  try {
    const text = await navigator.clipboard.readText()
    return text || null
  } catch {
    /* clipboard permission denied */
  }
  return null
}

async function pasteInto(ta: HTMLTextAreaElement, plain = false): Promise<boolean> {
  const text = await readClipboardText()
  if (text !== null) {
    const body = plain ? text.replace(/[\u200B-\u200D\uFEFF]/g, "") : text
    const s = ta.selectionStart
    const e = ta.selectionEnd
    setTa(ta, ta.value.slice(0, s) + body + ta.value.slice(e), s + body.length, s + body.length)
    return true
  }
  // clipboard API unavailable — try execCommand (native Edit menu in Electron)
  const s = ta.selectionStart
  const before = ta.value
  document.execCommand("paste")
  if (ta.value !== before) {
    ta.focus({ preventScroll: true })
    return true
  }
  toast("Press Ctrl+V to paste")
  ta.focus({ preventScroll: true })
  ta.setSelectionRange(s, s)
  return false
}

// ─── Link detection ──────────────────────────────────────────────────────────

export interface CaretLink {
  kind: "internal" | "external"
  /** wikilink target, or the URL */
  target: string
  /** heading / block subpath including #, when present */
  subpath: string | null
}

/** Is the caret inside a [[wikilink]] / [md](link) / bare URL? */
export function linkAtCaret(value: string, pos: number): CaretLink | null {
  const win = 300
  const from = Math.max(0, pos - win)
  const zone = value.slice(from, Math.min(value.length, pos + win))
  const rp = pos - from

  // wikilinks
  const wl = /\[\[([^\[\]\n]*)\]\]/g
  let m: RegExpExecArray | null
  while ((m = wl.exec(zone))) {
    if (rp >= m.index && rp <= m.index + m[0].length) {
      const inner = m[1]
      const hash = inner.indexOf("#")
      const target = hash === -1 ? inner : inner.slice(0, hash)
      return { kind: "internal", target: target.trim(), subpath: hash === -1 ? null : inner.slice(hash) }
    }
  }
  // markdown links
  const ml = /\[([^\[\]\n]*)\]\(([^()\n]*)\)/g
  while ((m = ml.exec(zone))) {
    if (rp >= m.index && rp <= m.index + m[0].length) {
      const url = m[2].trim()
      if (/^https?:\/\//i.test(url)) return { kind: "external", target: url, subpath: null }
      return { kind: "internal", target: decodeURIComponent(url.replace(/\.md$/i, "")), subpath: null }
    }
  }
  // bare URLs
  const urlRe = /https?:\/\/[^\s<>()[\]]+/g
  while ((m = urlRe.exec(zone))) {
    if (rp >= m.index && rp <= m.index + m[0].length) return { kind: "external", target: m[0], subpath: null }
  }
  return null
}

// ─── Open in new window (desktop: real second window; web: new browser tab) ─

export async function openNoteInNewWindow(ref: string, subpath?: string | null) {
  const ws = useWorkspace.getState()
  const entry = ws.linkIndex.find((e) => e.name.toLowerCase() === ref.toLowerCase() || e.id === ref || e.id === `${ref}.md`)
  if (!entry) {
    toast(`No note found for "${ref}"`)
    return
  }
  try {
    const { api } = await import("../api")
    await api.openNoteWindow(entry.id, subpath ?? null)
  } catch (err) {
    toast(String((err as Error).message ?? err))
  }
}

// ─── Link menu (shared: reading view + editor + page preview) ───────────────

export function linkMenuItems(link: CaretLink): MenuItem[] {
  const ws = useWorkspace.getState()
  const openExternal = (url: string) => {
    const desktop = (window as unknown as { desktop?: { openExternal: (u: string) => void } }).desktop
    if (desktop) desktop.openExternal(url)
    else window.open(url, "_blank", "noopener")
  }
  if (link.kind === "external") {
    return [
      { label: "Open", onClick: () => openExternal(link.target) },
      { type: "separator" },
      { label: "Copy URL", onClick: () => void navigator.clipboard.writeText(link.target).catch(() => undefined) },
    ]
  }
  const open = (newTab: boolean, side = false) => {
    if (side) ws.splitCurrentPane("row")
    ws.openNote(link.target, { newTab, subpath: link.subpath })
  }
  return [
    { label: "Open", onClick: () => open(false) },
    { label: "Open in new tab", onClick: () => open(true) },
    { label: "Open in new window", onClick: () => void openNoteInNewWindow(link.target, link.subpath) },
    { label: "Open to the side", onClick: () => open(true, true) },
    { type: "separator" },
    {
      label: "Copy link",
      onClick: () => void navigator.clipboard.writeText(`[[${link.target}${link.subpath ?? ""}]]`).catch(() => undefined),
    },
  ]
}

// ─── Note Composer: extract the selection into its own note ─────────────────

/** obsidian's "Extract current selection" — self-contained so both the block
 *  editor and the source editor can use it without extra plumbing. */
export async function extractSelectionToNote(text: string) {
  const ws = useWorkspace.getState()
  if (!ws.vaultId || !text.trim()) return
  const suggested = text.split("\n")[0].replace(/^[#>*\-\s]+/, "").slice(0, 48).trim() || "Untitled"
  const { useUi } = await import("../stores/ui")
  useUi.getState().openPrompt({
    title: "Extract to new note",
    placeholder: "Note name…",
    initialValue: suggested,
    confirmLabel: "Extract",
    onSubmit: async (name) => {
      if (!ws.vaultId) return
      const { api } = await import("../api")
      const { useDocs } = await import("../stores/docs")
      const created = await api.createNote(ws.vaultId, name.trim(), null, text.trim() + "\n")
      useDocs.getState().primeDoc(created.id, created.content ?? "")
      window.dispatchEvent(new CustomEvent("obs-invalidate", { detail: { vaultId: ws.vaultId, kinds: ["tree", "index", "graph"] } }))
      ws.openNote(created.id, { newTab: true })
    },
  })
}

// ─── The editor menu (live preview + source mode) ───────────────────────────

export function openEditorContextMenu(
  e: React.MouseEvent,
  ta: HTMLTextAreaElement,
  opts?: { onExtractSelection?: (text: string) => void },
) {
  const ws = useWorkspace.getState()
  const hasSel = ta.selectionStart !== ta.selectionEnd
  const link = linkAtCaret(ta.value, ta.selectionStart)

  const items: MenuItem[] = []

  if (link) items.push(...linkMenuItems(link), { type: "separator" })

  items.push(
    { label: "Cut", hotkey: "Ctrl+X", disabled: !hasSel, onClick: () => void cutSelection(ta) },
    { label: "Copy", hotkey: "Ctrl+C", disabled: !hasSel, onClick: () => void copySelection(ta) },
    { label: "Paste", hotkey: "Ctrl+V", onClick: () => void pasteInto(ta) },
    { label: "Paste as plain text", hotkey: "Ctrl+Shift+V", onClick: () => void pasteInto(ta, true) },
    { type: "separator" },
    {
      label: "Format",
      sub: [
        { label: "Bold", hotkey: "Ctrl+B", onClick: () => applyInlineFormat(ta, "**") },
        { label: "Italic", hotkey: "Ctrl+I", onClick: () => applyInlineFormat(ta, "*") },
        { label: "Strikethrough", onClick: () => applyInlineFormat(ta, "~~") },
        { label: "Highlight", onClick: () => applyInlineFormat(ta, "==") },
        { label: "Code", onClick: () => applyInlineFormat(ta, "`") },
        { type: "separator" },
        { label: "Clear formatting", onClick: () => clearInlineFormatting(ta) },
      ],
    },
    {
      label: "Paragraph",
      sub: [
        { label: "Text", onClick: () => applyParagraphStyle(ta, "text") },
        { type: "separator" },
        { label: "Heading 1", onClick: () => applyParagraphStyle(ta, "h1") },
        { label: "Heading 2", onClick: () => applyParagraphStyle(ta, "h2") },
        { label: "Heading 3", onClick: () => applyParagraphStyle(ta, "h3") },
        { label: "Heading 4", onClick: () => applyParagraphStyle(ta, "h4") },
        { label: "Heading 5", onClick: () => applyParagraphStyle(ta, "h5") },
        { label: "Heading 6", onClick: () => applyParagraphStyle(ta, "h6") },
        { type: "separator" },
        { label: "Quote", onClick: () => applyParagraphStyle(ta, "quote") },
        { label: "Callout", onClick: () => applyParagraphStyle(ta, "callout") },
      ],
    },
    {
      label: "Insert",
      sub: [
        {
          label: "Table",
          onClick: () =>
            insertBlock(ta, "| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n| Text     | Text     | Text     |\n| Text     | Text     | Text     |"),
        },
        { type: "separator" },
        { label: "Bullet list", onClick: () => applyParagraphStyle(ta, "bullet") },
        { label: "Numbered list", onClick: () => applyParagraphStyle(ta, "number") },
        { label: "Task list (checkbox)", onClick: () => applyParagraphStyle(ta, "task") },
        { type: "separator" },
        { label: "Horizontal rule", onClick: () => insertBlock(ta, "---") },
        { label: "Code block", onClick: () => insertBlock(ta, "```\n\n```") },
        { label: "Math block", onClick: () => insertBlock(ta, "$$\n\n$$") },
      ],
    },
    { type: "separator" },
    { label: "Select line", onClick: () => selectLine(ta) },
  )

  if (ws.settings.corePlugins.noteComposer) {
    items.push(
      { type: "separator" },
      {
        label: "Extract current selection",
        disabled: !hasSel,
        onClick: () => {
          const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd)
          if (opts?.onExtractSelection) opts.onExtractSelection(sel)
          else void extractSelectionToNote(sel)
        },
      },
      {
        label: "Merge current note with another note",
        onClick: () => {
          const tab = useWorkspace.getState().getActiveTab()
          const ui = useUi.getState()
          if (tab?.noteId) ui.openMerge(tab.noteId)
        },
      },
    )
  }

  showMenuAt(e, items)
}

// ─── Reading view menu ───────────────────────────────────────────────────────

export function openReadingContextMenu(e: React.MouseEvent) {
  const target = e.target as HTMLElement
  const hasSel = !!window.getSelection()?.toString()

  // internal link
  const link = target.closest("a.internal-link, a.internal-embed-chip") as HTMLElement | null
  if (link) {
    const href = link.dataset.href ?? ""
    const subpath = link.dataset.subpath || null
    showMenuAt(e, linkMenuItems({ kind: "internal", target: href, subpath }))
    return
  }
  // external link
  const ext = target.closest("a") as HTMLAnchorElement | null
  if (ext && /^https?:\/\//i.test(ext.getAttribute("href") ?? "")) {
    showMenuAt(e, linkMenuItems({ kind: "external", target: ext.getAttribute("href")!, subpath: null }))
    return
  }
  // embedded vault image
  const img = target.closest("img[data-vault-file]") as HTMLImageElement | null
  if (img) {
    const fid = img.dataset.vaultFile
    const ws = useWorkspace.getState()
    if (fid) {
      showMenuAt(e, [
        { label: "Open in new tab", onClick: () => ws.openAttachment(fid, { newTab: true }) },
        { label: "Open with default app", onClick: () => void apiOpenWithDefault(fid) },
        { label: "Reveal in system explorer", onClick: () => void apiRevealItem(fid) },
      ])
      return
    }
  }

  const items: MenuItem[] = [
    { label: "Copy", hotkey: "Ctrl+C", disabled: !hasSel, onClick: () => void navigator.clipboard.writeText(window.getSelection()?.toString() ?? "").catch(() => undefined) },
    { label: "Select all", onClick: () => document.execCommand("selectAll") },
  ]
  showMenuAt(e, items)
}

async function apiOpenWithDefault(fileId: string) {
  const ws = useWorkspace.getState()
  if (!ws.vaultId) return
  try {
    const { api } = await import("../api")
    const res = await api.openWithDefaultApp(ws.vaultId, fileId)
    if (res === "unavailable") toast("Opening with the default app requires the desktop edition")
  } catch (err) {
    toast(String((err as Error).message ?? err))
  }
}

async function apiRevealItem(fileId: string) {
  const ws = useWorkspace.getState()
  if (!ws.vaultId) return
  try {
    const { api } = await import("../api")
    const res = await api.revealItem(ws.vaultId, fileId)
    if (res === "unavailable") toast("Revealing files requires the desktop edition")
  } catch (err) {
    toast(String((err as Error).message ?? err))
  }
}

/** Is the desktop bridge present (→ desktop edition)? */
function isDesktop(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { desktop?: unknown }).desktop
}

/** obsidian's "Copy path" submenu. */
function copyPathItems(vaultRelPath: string): MenuItem[] {
  const items: MenuItem[] = [
    {
      label: "Copy vault path",
      onClick: () => void navigator.clipboard.writeText(vaultRelPath).catch(() => undefined),
    },
  ]
  if (isDesktop()) {
    const ws = useWorkspace.getState()
    if (ws.vaultId) {
      // on desktop the vault id IS the absolute vault folder
      const sep = ws.vaultId.includes("\\") ? "\\" : "/"
      const abs = ws.vaultId.replace(/[\\/]+$/, "") + sep + vaultRelPath.split("/").join(sep)
      items.push({
        label: "Copy absolute path",
        onClick: () => void navigator.clipboard.writeText(abs).catch(() => undefined),
      })
    }
  }
  return items
}

// ─── File explorer menus (obsidian-exact) ───────────────────────────────────

export function noteMenuItems(opts: {
  /** vault-relative path, e.g. "Journal/2026-11-11.md" */
  path: string
  isMarkdown: boolean
  actions: {
    openNewTab: () => void
    openRight: () => void
    openNewWindow: () => void
    makeCopy?: () => void
    move: () => void
    merge?: () => void
    bookmark?: () => void
    versionHistory?: () => void
    openWithDefault?: () => void
    reveal?: () => void
    rename: () => void
    delete: () => void
  }
}): MenuItem[] {
  const a = opts.actions
  const items: MenuItem[] = [
    { label: "Open in new tab", onClick: a.openNewTab },
    { label: "Open to the right", onClick: a.openRight },
    { label: "Open in new window", onClick: a.openNewWindow },
    { type: "separator" },
  ]
  if (a.makeCopy) items.push({ label: "Make a copy", onClick: a.makeCopy })
  items.push({ label: "Move file to…", onClick: a.move })
  if (a.merge) items.push({ type: "separator" }, { label: "Merge entire file with…", onClick: a.merge })
  if (a.bookmark) items.push({ type: "separator" }, { label: "Bookmark…", onClick: a.bookmark })
  items.push({ type: "separator" }, { label: "Copy path", sub: copyPathItems(opts.path) })
  if (a.versionHistory) items.push({ label: "Open version history", onClick: a.versionHistory })
  items.push({ type: "separator" })
  if (a.openWithDefault) items.push({ label: "Open with default app", onClick: a.openWithDefault })
  if (a.reveal) items.push({ label: "Reveal in system explorer", onClick: a.reveal })
  items.push(
    { type: "separator" },
    { label: "Rename…", hotkey: "F2", onClick: a.rename },
    { label: "Delete", hotkey: "Del", danger: true, onClick: a.delete },
  )
  return items
}

export function folderMenuItems(opts: {
  path: string
  actions: {
    newNote: () => void
    newFolder: () => void
    newCanvas?: () => void
    move?: () => void
    searchInFolder?: () => void
    bookmark?: () => void
    reveal?: () => void
    rename: () => void
    delete: () => void
  }
}): MenuItem[] {
  const a = opts.actions
  const items: MenuItem[] = [
    { label: "New note", onClick: a.newNote },
    { label: "New folder", onClick: a.newFolder },
  ]
  if (a.newCanvas) items.push({ label: "New canvas", onClick: a.newCanvas })
  items.push({ type: "separator" })
  if (a.move) items.push({ label: "Move folder to…", onClick: a.move }, { type: "separator" })
  if (a.searchInFolder) items.push({ label: "Search in folder…", onClick: a.searchInFolder }, { type: "separator" })
  if (a.bookmark) items.push({ label: "Bookmark…", onClick: a.bookmark }, { type: "separator" })
  items.push({ label: "Copy path", sub: copyPathItems(opts.path) })
  if (a.reveal) items.push({ label: "Reveal in system explorer", onClick: a.reveal })
  items.push(
    { type: "separator" },
    { label: "Rename…", hotkey: "F2", onClick: a.rename },
    { label: "Delete", hotkey: "Del", danger: true, onClick: a.delete },
  )
  return items
}

export function rootMenuItems(actions: { newNote: () => void; newFolder: () => void; newCanvas?: () => void }): MenuItem[] {
  const items: MenuItem[] = [
    { label: "New note", onClick: actions.newNote },
    { label: "New folder", onClick: actions.newFolder },
  ]
  if (actions.newCanvas) items.push({ label: "New canvas", onClick: actions.newCanvas })
  return items
}

// ─── Tab menu (obsidian-exact) ──────────────────────────────────────────────

export function tabMenuItems(opts: {
  pinned: boolean
  /** the tab's note, when it is a note/canvas tab (graph tabs get fewer items) */
  noteId: string | null
  isGraph: boolean
  actions: {
    pin: () => void
    close: () => void
    closeOthers: () => void
    closeAll: () => void
    splitRight: () => void
    splitDown: () => void
    moveToNewWindow: () => void
    onRename?: () => void
    onMoveFile?: () => void
    onDelete?: () => void
  }
}): MenuItem[] {
  const a = opts.actions
  const items: MenuItem[] = [
    { label: opts.pinned ? "Unpin" : "Pin", onClick: a.pin },
    { type: "separator" },
    { label: "Close", hotkey: "Ctrl+W", onClick: a.close },
    { label: "Close others", onClick: a.closeOthers },
    { label: "Close all", onClick: a.closeAll },
    { type: "separator" },
    { label: "Split right", onClick: a.splitRight },
    { label: "Split down", onClick: a.splitDown },
  ]
  if (opts.noteId) items.push({ label: "Move to new window", onClick: a.moveToNewWindow })
  if (opts.noteId && !opts.isGraph && a.onRename) {
    items.push(
      { type: "separator" },
      { label: "Rename…", onClick: a.onRename },
      { label: "Move file to…", onClick: a.onMoveFile },
      { label: "Delete file", danger: true, onClick: a.onDelete },
    )
  }
  return items
}
