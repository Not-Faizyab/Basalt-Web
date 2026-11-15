"use client"

// ─── Autocomplete popup for [[wikilinks and #tags (editors share this) ──────
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { FileText, Hash } from "lucide-react"
import { fuzzyMatch, fuzzyRank } from "@/lib/obsidian/fuzzy"
import { useIndex, useTagCounts } from "../hooks"

export type SuggestKind = "link" | "tag" | null

export interface SuggestState {
  kind: SuggestKind
  query: string
}

export interface CaretViewportPos {
  top: number
  left: number
  bottom: number
}

export function detectSuggest(text: string, caret: number): SuggestState {
  const before = text.slice(0, caret)
  const linkMatch = before.match(/\[\[([^\]\n[]*)$/)
  if (linkMatch) return { kind: "link", query: linkMatch[1] }
  // Require at least one valid tag-start char so bare "#" (e.g. "# Heading") does not open tag popup
  const tagMatch = before.match(/(?:^|\s)#([A-Za-z_\u00C0-\u024F/-][^\s#]*)$/)
  if (tagMatch) return { kind: "tag", query: tagMatch[1] }
  return { kind: null, query: "" }
}

/** Measure viewport pixel rect at caret index inside a textarea/input via a hidden mirror div. */
export function getCaretViewportPos(el: HTMLTextAreaElement | HTMLInputElement | null, caretPos: number): CaretViewportPos | null {
  if (!el || typeof window === "undefined") return null
  const rect = el.getBoundingClientRect()
  const cs = window.getComputedStyle(el)
  const div = document.createElement("div")
  const copyProps = [
    "boxSizing",
    "width",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "borderTopStyle",
    "borderRightStyle",
    "borderBottomStyle",
    "borderLeftStyle",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "fontVariant",
    "letterSpacing",
    "lineHeight",
    "textTransform",
    "wordSpacing",
    "textIndent",
    "tabSize",
    "direction",
  ] as const
  for (const p of copyProps) {
    div.style[p] = cs[p]
  }
  div.style.position = "fixed"
  div.style.top = "-9999px"
  div.style.left = "-9999px"
  div.style.visibility = "hidden"
  div.style.pointerEvents = "none"
  div.style.whiteSpace = el.tagName === "TEXTAREA" ? "pre-wrap" : "pre"
  div.style.wordWrap = "break-word"
  div.style.overflowWrap = "break-word"
  div.textContent = el.value.slice(0, Math.max(0, caretPos))
  const span = document.createElement("span")
  span.textContent = el.value.slice(caretPos, caretPos + 1) || "\u200b"
  div.appendChild(span)
  document.body.appendChild(div)
  try {
    const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 20
    const left = Math.min(rect.right - 8, Math.max(rect.left, rect.left + span.offsetLeft - el.scrollLeft))
    const top = Math.min(rect.bottom, Math.max(rect.top, rect.top + span.offsetTop - el.scrollTop))
    return { top, left, bottom: top + lineH }
  } finally {
    document.body.removeChild(div)
  }
}

function HighlightLabel({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const match = fuzzyMatch(query, text)
  if (!match || match.positions.length === 0) return <>{text}</>
  const hitSet = new Set(match.positions.filter((p) => p >= 0 && p < text.length))
  return (
    <>
      {Array.from(text).map((ch, i) =>
        hitSet.has(i) ? (
          <strong key={i} className="font-semibold" style={{ color: "var(--text-accent)" }}>
            {ch}
          </strong>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  )
}

export interface SuggestItem {
  label: string
  sub: string
  value: string
}

/** Items for the current suggest state (shared by popup + keyboard handler). */
export function useSuggestItems(state: SuggestState): SuggestItem[] {
  const { data: index } = useIndex()
  const { data: tags } = useTagCounts()
  return useMemo(() => {
    if (state.kind === "link") {
      const all = (index ?? []).map((e) => ({ label: e.name, sub: e.path, value: e.name }))
      return fuzzyRank(state.query, all, (x) => x.label + " " + x.sub).slice(0, 8).map((r) => r.item)
    }
    if (state.kind === "tag") {
      const all = (tags ?? []).map((t) => ({ label: t.tag, sub: `${t.count} notes`, value: t.tag }))
      return fuzzyRank(state.query, all, (x) => x.label).slice(0, 8).map((r) => r.item)
    }
    return []
  }, [state, index, tags])
}

export function AutocompletePopup({
  state,
  items,
  selected,
  onSelect,
  anchorRef,
  caretPos,
  onHoverIndex,
}: {
  state: SuggestState
  items: SuggestItem[]
  selected: number
  onSelect: (insert: string, isTag: boolean) => void
  anchorRef: React.RefObject<HTMLElement | null>
  caretPos?: CaretViewportPos | null
  onHoverIndex?: (idx: number) => void
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const anchorRect = anchorRef.current?.getBoundingClientRect()
    const raw = caretPos ?? (anchorRect ? { top: anchorRect.top, left: anchorRect.left, bottom: anchorRect.bottom } : null)
    if (!raw) return
    const popupW = 340
    const estH = Math.min(300, Math.max(48, items.length * (state.kind === "link" ? 42 : 30) + 12))
    const left = Math.max(8, Math.min(raw.left, window.innerWidth - popupW - 8))
    const fitsBelow = raw.bottom + 4 + estH <= window.innerHeight - 8
    const top = fitsBelow
      ? raw.bottom + 4
      : Math.max(8, raw.top - estH - 4)
    setPos({ top, left })
  }, [anchorRef, caretPos, items.length, state.kind, state.query])

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${selected}"]`)?.scrollIntoView({ block: "nearest" })
  }, [selected])

  if (!state.kind || pos === null) return null

  return (
    <div
      className="obs-suggest fixed"
      style={{ top: pos.top, left: pos.left, width: 340, maxHeight: 300, zIndex: 70 }}
    >
      <div ref={listRef} className="overflow-y-auto max-h-[296px] p-1">
        {items.length === 0 && (
          <div className="px-3 py-2 text-[0.8rem]" style={{ color: "var(--text-faint)" }}>
            {state.kind === "link" ? "No matching notes" : "No matching tags"}
          </div>
        )}
        {items.map((item, i) => (
          <div
            key={item.value + i}
            data-idx={i}
            className={`obs-tree-row !text-[0.85rem] ${state.kind === "link" ? "!items-start !py-1.5" : ""}`}
            style={i === selected ? { background: "var(--background-modifier-active-hover)" } : undefined}
            onMouseEnter={() => onHoverIndex?.(i)}
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect(item.value, state.kind === "tag")
            }}
          >
            {state.kind === "link" ? (
              <FileText size={13} className="mt-0.5 shrink-0 opacity-60" />
            ) : (
              <Hash size={13} className="shrink-0 opacity-60" />
            )}
            {state.kind === "link" ? (
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  <HighlightLabel text={item.label} query={state.query} />
                </div>
                {item.sub && (
                  <div className="truncate text-[0.72rem]" style={{ color: "var(--text-faint)" }}>
                    {item.sub}
                  </div>
                )}
              </div>
            ) : (
              <>
                <span className="truncate">
                  <HighlightLabel text={item.label} query={state.query} />
                </span>
                <span className="ml-auto truncate pl-2 text-[0.72rem]" style={{ color: "var(--text-faint)" }}>
                  {item.sub}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
