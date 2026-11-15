"use client"

// ─── Command palette (Ctrl+P) + Quick switcher (Ctrl+O) ──────────────────────
import { useEffect, useMemo, useRef, useState } from "react"
import { FileText, LayoutDashboard, Search } from "lucide-react"
import { fuzzyRank, highlightRanges } from "@/lib/obsidian/fuzzy"
import { buildCommands, resolveNewNoteFolderId, type Command } from "../../commands"
import { useUi } from "../../stores/ui"
import { useWorkspace } from "../../stores/workspace"
import { useDocs } from "../../stores/docs"
import { useIndex } from "../../hooks"
import { api } from "../../api"

function useEscClose(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])
}

// ─── Command palette ─────────────────────────────────────────────────────────

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  if (!open) return null
  return <PaletteInner key="palette" />
}

function PaletteInner() {
  const closeAll = useUi((s) => s.closeAllModals)
  const [query, setQuery] = useState("")
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const commands = useMemo<Command[]>(() => buildCommands(), [])

  const ranked = useMemo(() => {
    if (!query.trim()) return commands.map((c) => ({ item: c, result: { score: 0, positions: [] as number[] } }))
    return fuzzyRank(query, commands, (c) => c.name)
  }, [query, commands])

  useEscClose(closeAll)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" })
  }, [sel])

  const run = (c: Command) => {
    closeAll()
    setTimeout(() => void c.run(), 20)
  }

  return (
    <div className="obs-modal-bg fixed inset-0 z-[80] flex items-start justify-center pt-[12vh]" onMouseDown={closeAll}>
      <div className="obs-modal obs-anim-in w-[560px] max-w-[92vw] overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b px-3 py-2.5" style={{ borderColor: "var(--background-modifier-border)" }}>
          <Search size={15} style={{ color: "var(--text-faint)" }} />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-[0.95rem] outline-none"
            placeholder="Type a command…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSel(0)
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setSel((s) => Math.min(s + 1, ranked.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setSel((s) => Math.max(s - 1, 0))
              } else if (e.key === "Enter") {
                e.preventDefault()
                if (ranked[sel]) run(ranked[sel].item)
              }
            }}
          />
          <span className="obs-kbd">Esc</span>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
          {ranked.length === 0 && (
            <div className="px-3 py-3 text-[0.85rem]" style={{ color: "var(--text-faint)" }}>
              No commands found
            </div>
          )}
          {ranked.map(({ item, result }, i) => (
            <div
              key={item.id}
              data-idx={i}
              className="obs-tree-row !min-h-[34px] !text-[0.875rem]"
              style={i === sel ? { background: "var(--background-modifier-active-hover)" } : undefined}
              onMouseEnter={() => setSel(i)}
              onClick={() => run(item)}
            >
              <span className="truncate">
                {highlightRanges(item.name, result.positions).map((r, j) => (
                  <span key={j} style={r.matched ? { color: "var(--text-accent)" } : undefined}>
                    {r.text}
                  </span>
                ))}
              </span>
              {item.hotkey && <span className="obs-kbd ml-auto shrink-0">{item.hotkey}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Quick switcher ──────────────────────────────────────────────────────────

export function QuickSwitcher() {
  const open = useUi((s) => s.switcherOpen)
  if (!open) return null
  return <SwitcherInner key="switcher" />
}

function SwitcherInner() {
  const closeAll = useUi((s) => s.closeAllModals)
  const [query, setQuery] = useState("")
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { data: index } = useIndex()
  const openNote = useWorkspace((s) => s.openNote)
  const vaultId = useWorkspace((s) => s.vaultId)

  useEscClose(closeAll)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" })
  }, [sel])

  const results = useMemo(() => {
    if (!index) return []
    if (!query.trim()) return index.slice(0, 12).map((e) => ({ item: e, result: { score: 0, positions: [] as number[] } }))
    return fuzzyRank(query, index, (e) => `${e.name} ${(e.aliases ?? []).join(" ")} ${e.path}`).slice(0, 12)
  }, [index, query])

  const noMatch = query.trim() !== "" && results.length === 0

  const openAt = (i: number, newTab: boolean) => {
    if (noMatch) {
      const name = query.trim()
      closeAll()
      void (async () => {
        if (!vaultId) return
        const folderId = await resolveNewNoteFolderId()
        const note = await api.createNote(vaultId, name, folderId, "")
        useDocs.getState().primeDoc(note.id, note.content ?? "")
        window.dispatchEvent(new CustomEvent("obs-invalidate", { detail: { vaultId, kinds: ["tree", "index", "graph", "tags"] } }))
        useWorkspace.getState().openNote(note.id, { newTab })
      })()
      return
    }
    const hit = results[i]
    if (hit) {
      closeAll()
      openNote(hit.item.id, { newTab })
    }
  }

  return (
    <div className="obs-modal-bg fixed inset-0 z-[80] flex items-start justify-center pt-[12vh]" onMouseDown={closeAll}>
      <div className="obs-modal obs-anim-in w-[560px] max-w-[92vw] overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b px-3 py-2.5" style={{ borderColor: "var(--background-modifier-border)" }}>
          <FileText size={15} style={{ color: "var(--text-faint)" }} />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-[0.95rem] outline-none"
            placeholder="Find or create a note…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSel(0)
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setSel((s) => Math.min(s + 1, Math.max(0, results.length - 1)))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setSel((s) => Math.max(s - 1, 0))
              } else if (e.key === "Enter") {
                e.preventDefault()
                openAt(sel, e.ctrlKey || e.metaKey)
              }
            }}
          />
          <span className="obs-kbd">Esc</span>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
          {noMatch ? (
            <div
              className="obs-tree-row !min-h-[34px] !text-[0.875rem]"
              style={{ color: "var(--text-accent)" }}
              onMouseEnter={() => setSel(0)}
              onClick={() => openAt(0, false)}
            >
              <FileText size={14} /> Create note: {query.trim()}
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-[0.85rem]" style={{ color: "var(--text-faint)" }}>
              No notes in this vault yet
            </div>
          ) : (
            results.map(({ item, result }, i) => (
              <div
                key={item.id}
                data-idx={i}
                className="obs-tree-row !min-h-[34px] !text-[0.875rem]"
                style={i === sel ? { background: "var(--background-modifier-active-hover)" } : undefined}
                onMouseEnter={() => setSel(i)}
                onClick={(e) => openAt(i, e.ctrlKey || e.metaKey)}
              >
                {item.id.endsWith(".canvas") ? (
                  <LayoutDashboard size={14} className="shrink-0 opacity-60" />
                ) : (
                  <FileText size={14} className="shrink-0 opacity-60" />
                )}
                <span className="truncate font-medium">
                  {highlightRanges(item.name, result.positions).map((r, j) => (
                    <span key={j} style={r.matched ? { color: "var(--text-accent)" } : undefined}>
                      {r.text}
                    </span>
                  ))}
                </span>
                <span className="ml-auto max-w-45 truncate pl-2 text-[0.72rem]" style={{ color: "var(--text-faint)" }}>
                  {item.path}
                </span>
              </div>
            ))
          )}
        </div>
        <div className="border-t px-3 py-1.5 text-[0.7rem]" style={{ borderColor: "var(--background-modifier-border)", color: "var(--text-faint)" }}>
          <span className="obs-kbd">Enter</span> open · <span className="obs-kbd">Ctrl+Enter</span> new tab · <span className="obs-kbd">↑↓</span> navigate
        </div>
      </div>
    </div>
  )
}
