"use client"

// ─── In-file find & replace bar (Ctrl+F / Ctrl+H) ────────────────────────────
import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronUp, Replace, X } from "lucide-react"

export function FindBar({
  query,
  onQuery,
  count,
  activeIndex,
  onPrev,
  onNext,
  onClose,
  showReplace,
  onReplace,
  onReplaceAll,
  replaceValue,
  onReplaceValue,
  caseSensitive,
  onToggleCase,
  focusTrigger,
}: {
  query: string
  onQuery: (q: string) => void
  count: number
  activeIndex: number
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  showReplace: boolean
  onReplace: () => void
  onReplaceAll: () => void
  replaceValue: string
  onReplaceValue: (v: string) => void
  caseSensitive: boolean
  onToggleCase: () => void
  focusTrigger?: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [replaceOpen, setReplaceOpen] = useState(showReplace)

  useEffect(() => {
    setReplaceOpen(showReplace)
  }, [showReplace])

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusTrigger])

  return (
    <div className="absolute right-4 top-2 z-30 obs-suggest" style={{ borderRadius: 8, minWidth: 320 }}>
      <div className="flex items-center gap-1 p-1.5">
        <button className="obs-icon-btn !h-6 !w-6" title="Toggle replace" onClick={() => setReplaceOpen(!replaceOpen)}>
          <Replace size={13} />
        </button>
        <button
          className="obs-icon-btn !h-6 !w-6 !text-[11px] font-semibold"
          title="Match case"
          style={caseSensitive ? { color: "var(--interactive-accent)", background: "var(--background-modifier-active-hover)" } : undefined}
          onClick={onToggleCase}
        >
          Aa
        </button>
        <input
          ref={inputRef}
          className="obs-input !py-1 text-[0.85rem]"
          placeholder="Find…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              if (e.shiftKey) onPrev()
              else onNext()
            }
            if (e.key === "Escape") {
              e.preventDefault()
              onClose()
            }
          }}
        />
        <span className="text-[0.72rem] px-1 shrink-0" style={{ color: "var(--text-faint)", minWidth: 52, textAlign: "center" }}>
          {count > 0 ? `${activeIndex + 1} of ${count}` : "No results"}
        </span>
        <button className="obs-icon-btn !h-6 !w-6" title="Previous match" onClick={onPrev}>
          <ChevronUp size={13} />
        </button>
        <button className="obs-icon-btn !h-6 !w-6" title="Next match" onClick={onNext}>
          <ChevronDown size={13} />
        </button>
        <button className="obs-icon-btn !h-6 !w-6" title="Close" onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      {replaceOpen && (
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          <input
            className="obs-input !py-1 text-[0.85rem]"
            placeholder="Replace with…"
            value={replaceValue}
            onChange={(e) => onReplaceValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                if (e.ctrlKey || e.metaKey) onReplaceAll()
                else onReplace()
              }
              if (e.key === "Escape") {
                e.preventDefault()
                onClose()
              }
            }}
          />
          <button className="obs-text-btn !px-2 !text-[0.8rem]" onClick={onReplace}>
            Replace
          </button>
          <button className="obs-text-btn !px-2 !text-[0.8rem]" onClick={onReplaceAll}>
            All
          </button>
        </div>
      )}
    </div>
  )
}
