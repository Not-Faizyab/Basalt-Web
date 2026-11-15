"use client"

// ─── Editor pane: view header + inline title + properties + modes ───────────
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BookOpen,
  ChevronRight,
  Code,
  MoreHorizontal,
  Pencil,
  Bookmark,
  SplitSquareHorizontal,
  SplitSquareVertical,
  FilePlus2,
  Trash2,
  Copy,
  TextCursorInput,
  FileInput,
  ArrowLeft,
  ArrowRight,
} from "lucide-react"
import type { Tab } from "@/lib/obsidian/types"
import { parseBlocks, serializeBlocks, extractOutline } from "@/lib/obsidian/blocks"
import { parseFrontmatter } from "@/lib/obsidian/frontmatter"
import { toggleTaskInSource } from "@/lib/obsidian/links"
import { api } from "../api"
import { useWorkspace } from "../stores/workspace"
import { useDocs } from "../stores/docs"
import { useUi } from "../stores/ui"
import { useNoteMutations, useBookmarkMutations, useIndex, useTree } from "../hooks"
import { BlockEditor } from "./block-editor"
import { SourceEditor } from "./source-editor"
import { MarkdownView } from "./markdown-render"
import { CanvasEditor } from "./canvas-editor"
import { PropertiesPanel } from "./properties"
import { FindBar } from "./find-bar"
import { toast } from "sonner"

export const EditorPane = memo(function EditorPane({ tab }: { tab: Tab }) {
  const noteId = tab.noteId
  const vaultId = useWorkspace((s) => s.vaultId)
  const settings = useWorkspace((s) => s.settings)
  const openNote = useWorkspace((s) => s.openNote)
  const setTabMode = useWorkspace((s) => s.setTabMode)
  const splitPane = useWorkspace((s) => s.splitCurrentPane)
  const { data: note } = useQuery({
    queryKey: ["note", noteId],
    queryFn: () => api.note(noteId!),
    enabled: !!noteId,
  })
  const { data: tree } = useTree()
  const { data: index } = useIndex()
  const docs = useDocs((s) => s.docs)

  const loadDoc = useDocs((s) => s.load)
  const setDoc = useDocs((s) => s.setDoc)
  useEffect(() => {
    if (noteId) void loadDoc(noteId)
  }, [noteId, loadDoc])

  const docEntry = noteId ? docs[noteId] : undefined
  const content = docEntry?.content ?? note?.content ?? ""
  const isCanvas =
    !!noteId &&
    (/\.canvas$/i.test(noteId) ||
      note?.name?.endsWith(".canvas") === true ||
      note?.path?.endsWith(".canvas") === true ||
      index?.some((e) => e.id === noteId && (e.name.endsWith(".canvas") || e.path.endsWith(".canvas"))) === true)

  const onChange = (next: string) => {
    if (noteId) setDoc(noteId, next)
  }

  // full ancestor folder chain for interactive View Header breadcrumbs
  const folderChain = useMemo(() => {
    if (!tree || !note?.folderId) return [] as { id: string; name: string }[]
    const chain: { id: string; name: string }[] = []
    let curId: string | null = note.folderId
    const seen = new Set<string>()
    while (curId && !seen.has(curId)) {
      seen.add(curId)
      const folder = tree.folders.find((f) => f.id === curId)
      if (!folder) break
      chain.unshift({ id: folder.id, name: folder.name })
      curId = folder.parentId
    }
    return chain
  }, [tree, note?.folderId])

  // cssclass / cssclasses wide-page support via real YAML parser
  const cssClasses = useMemo(() => {
    const raw = parseFrontmatter(content).data.cssclasses ?? parseFrontmatter(content).data.cssclass
    if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean)
    if (typeof raw === "string") return raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    return [] as string[]
  }, [content])

  const wide = cssClasses.includes("wide-page")
  const readable = settings.appearance.readableLineLength && !wide

  // task toggling
  const onToggleTask = (n: number) => {
    onChange(toggleTaskInSource(content, n))
  }

  // ── find & replace state ──────────────────────────────────────────────────
  const findRequest = useUi((s) => s.findRequest)
  const [findOpen, setFindOpen] = useState(false)
  const [findFocusNonce, setFindFocusNonce] = useState(0)
  const [findQuery, setFindQuery] = useState("")
  const [findCase, setFindCase] = useState(false)
  const [replaceValue, setReplaceValue] = useState("")
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [activeMatch, setActiveMatch] = useState(0)
  const [blockFocus, setBlockFocus] = useState<{ blockIndex: number; start: number; end: number; nonce: number } | null>(null)
  const [sourceFocus, setSourceFocus] = useState<{ start: number; end: number; nonce: number } | null>(null)
  const paneRootRef = useRef<HTMLDivElement>(null)
  const focusBodyRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!findRequest || findRequest.tabId !== tab.id) return
    setFindOpen(true)
    setFindFocusNonce((n) => n + 1)
    if (findRequest.query !== undefined && findRequest.query !== "") setFindQuery(findRequest.query)
    if (findRequest.showReplace) setReplaceOpen(true)
    setActiveMatch(0)
  }, [findRequest, tab.id])

  const matches = useMemo(() => {
    if (!findOpen || findQuery.trim() === "") return [] as { blockIndex: number; start: number; end: number }[]
    const out: { blockIndex: number; start: number; end: number }[] = []
    const hay = findCase ? content : content.toLowerCase()
    const needle = findCase ? findQuery : findQuery.toLowerCase()
    if (tab.mode === "source") {
      let idx = hay.indexOf(needle)
      while (idx !== -1 && out.length < 500) {
        out.push({ blockIndex: 0, start: idx, end: idx + needle.length })
        idx = hay.indexOf(needle, idx + needle.length)
      }
    } else {
      const blocks = parseBlocks(content)
      blocks.forEach((b, bi) => {
        if (tab.mode === "live" && b.type === "frontmatter") return
        const bhay = findCase ? b.text : b.text.toLowerCase()
        let idx = bhay.indexOf(needle)
        while (idx !== -1 && out.length < 500) {
          out.push({ blockIndex: bi, start: idx, end: idx + needle.length })
          idx = bhay.indexOf(needle, idx + needle.length)
        }
      })
    }
    return out
  }, [findOpen, findQuery, findCase, content, tab.mode])

  const clampedMatch = matches.length > 0 ? Math.min(activeMatch, matches.length - 1) : 0

  const gotoMatch = (delta: number | "reset") => {
    if (matches.length === 0) return
    const next = delta === "reset" ? 0 : (clampedMatch + delta + matches.length) % matches.length
    setActiveMatch(next)
    const m = matches[next]
    if (tab.mode === "source") {
      setSourceFocus({ start: m.start, end: m.end, nonce: Date.now() })
    } else if (tab.mode === "live") {
      setBlockFocus({ blockIndex: m.blockIndex, start: m.start, end: m.end, nonce: Date.now() })
    }
  }

  const doReplaceAll = () => {
    if (!findQuery) return
    window.dispatchEvent(new CustomEvent("obs-flush-active-draft"))
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const re = new RegExp(escaped, findCase ? "g" : "gi")
    const latest = (noteId ? useDocs.getState().docs[noteId]?.content : undefined) ?? content
    const count = (latest.match(re) ?? []).length
    onChange(latest.replace(re, () => replaceValue))
    toast(`Replaced ${count} occurrence${count === 1 ? "" : "s"}`)
  }

  const doReplaceOne = () => {
    if (!findQuery || matches.length === 0) return
    window.dispatchEvent(new CustomEvent("obs-flush-active-draft"))
    const latest = (noteId ? useDocs.getState().docs[noteId]?.content : undefined) ?? content
    const m = matches[clampedMatch]
    let absStart = m.start
    if (tab.mode !== "source") {
      const blocks = parseBlocks(latest)
      let cursor = 0
      for (let i = 0; i < m.blockIndex && i < blocks.length; i++) {
        const found = latest.indexOf(blocks[i].text, cursor)
        cursor = (found === -1 ? cursor : found) + blocks[i].text.length
      }
      const bText = blocks[m.blockIndex]?.text ?? ""
      const blockStart = latest.indexOf(bText, cursor)
      absStart = blockStart === -1 ? -1 : blockStart + m.start
      if (absStart < 0) return
    }
    const next = latest.slice(0, absStart) + replaceValue + latest.slice(absStart + findQuery.length)
    onChange(next)
    toast("Replaced 1 occurrence")
  }

  // ── scroll-to-subpath (Reading + Live Preview + Source modes) ─────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { noteId: string; subpath: string; index?: number }
      if (!detail || detail.noteId !== noteId) return
      const container = paneRootRef.current?.querySelector(".obs-editor-scroll") as HTMLElement | null
      if (!container || tab.mode === "source") return
      if (detail.subpath.startsWith("#^")) {
        const blockId = detail.subpath.slice(2)
        const el = container.querySelector(`[data-block-ref="${CSS.escape(blockId)}"]`)
        el?.scrollIntoView({ block: "center" })
        return
      }
      if (detail.subpath.startsWith("#")) {
        const parts = detail.subpath.slice(1).split("#").filter(Boolean)
        const heading = (parts[parts.length - 1] ?? "").toLowerCase()
        const norm = (s: string) => s.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-")
        const outline = extractOutline(content)
        const targetItem =
          typeof detail.index === "number" && outline[detail.index]
            ? outline[detail.index]
            : outline.find((h) => h.text.toLowerCase() === heading) ?? outline.find((h) => norm(h.text) === norm(heading))
        if (targetItem) {
          const el =
            container.querySelector(`[data-heading-index="${targetItem.index}"]`) ??
            container.querySelector(`#h-${targetItem.index}`)
          el?.scrollIntoView({ block: "start" })
        }
      }
    }
    window.addEventListener("obs-scroll-to", handler)
    return () => window.removeEventListener("obs-scroll-to", handler)
  }, [noteId, content, tab.mode])

  // ── more menu actions ─────────────────────────────────────────────────────
  const { deleteNote } = useNoteMutations()
  const { addBookmark } = useBookmarkMutations()
  const ui = useUi.getState()
  const lastBlockRef = useRef<{ index: number; text: string } | null>(null)
  const onActiveBlock = (index: number, text: string) => {
    lastBlockRef.current = { index, text }
  }

  const onExtractBlock = (blockIndex: number, text: string) => {
    const suggested = text.split("\n")[0].replace(/^[#>*\-\s]+/, "").slice(0, 48).trim() || "Untitled"
    useUi.getState().openPrompt({
      title: "Extract to new note",
      placeholder: "Note name…",
      initialValue: suggested,
      confirmLabel: "Extract",
      onSubmit: async (name) => {
        if (!vaultId) return
        window.dispatchEvent(new CustomEvent("obs-flush-active-draft"))
        const created = await api.createNote(vaultId, name.trim(), null, text.trim() + "\n")
        useDocs.getState().primeDoc(created.id, created.content ?? "")
        const blocks = parseBlocks(content)
        const nextBlocks = blocks.map((b, i) => (i === blockIndex ? { ...b, text: `[[${name.trim()}]]` } : b))
        onChange(serializeBlocks(nextBlocks))
        window.dispatchEvent(new CustomEvent("obs-invalidate", { detail: { vaultId, kinds: ["tree", "index", "graph"] } }))
        openNote(created.id, { newTab: true })
      },
    })
  }

  if (!noteId) return null
  const noteMeta = index?.find((e) => e.id === noteId)

  return (
    <div ref={paneRootRef} className="flex h-full flex-col" style={{ background: "var(--background-primary)" }}>
      {/* View header */}
      <div className="flex items-center justify-between gap-2 px-3 pt-1.5 pb-0 shrink-0" style={{ minHeight: 36 }}>
        <div className="flex w-16 shrink-0 items-center gap-0.5">
          <button
            className="obs-icon-btn !h-6 !w-6"
            title="Navigate back (Alt+←)"
            disabled={tab.historyIndex <= 0}
            style={tab.historyIndex <= 0 ? { opacity: 0.35, pointerEvents: "none" } : undefined}
            onClick={() => useWorkspace.getState().navigateTabHistory(tab.id, -1)}
          >
            <ArrowLeft size={14} />
          </button>
          <button
            className="obs-icon-btn !h-6 !w-6"
            title="Navigate forward (Alt+→)"
            disabled={tab.historyIndex >= tab.history.length - 1}
            style={tab.historyIndex >= tab.history.length - 1 ? { opacity: 0.35, pointerEvents: "none" } : undefined}
            onClick={() => useWorkspace.getState().navigateTabHistory(tab.id, 1)}
          >
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden text-[0.8125rem]" style={{ color: "var(--text-muted)" }}>
          {folderChain.map((f) => (
            <span key={f.id} className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                className="truncate max-w-36 opacity-80 hover:opacity-100 hover:underline"
                title={f.name}
                onClick={() => window.dispatchEvent(new CustomEvent("obs-reveal-folder", { detail: { folderId: f.id } }))}
              >
                {f.name}
              </button>
              <ChevronRight size={12} className="opacity-50 shrink-0" />
            </span>
          ))}
          <span className="truncate font-medium" style={{ color: "var(--text-normal)" }} title={noteMeta?.path}>
            {note?.name ?? noteMeta?.name ?? "…"}
          </span>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-0.5">
          {!isCanvas && (
            <>
              {tab.mode !== "read" && (
                <button
                  className="obs-icon-btn"
                  title={tab.mode === "source" ? "Switch to Live Preview" : "Switch to Source mode"}
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent("obs-flush-active-draft"))
                    setTabMode(tab.id, tab.mode === "source" ? "live" : "source")
                  }}
                >
                  <Code size={15} className={tab.mode === "source" ? "text-[var(--interactive-accent)]" : "opacity-70"} />
                </button>
              )}
              <button
                className="obs-icon-btn"
                title={tab.mode === "read" ? "Edit (Ctrl+E)" : "Reading view (Ctrl+E)"}
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("obs-flush-active-draft"))
                  setTabMode(tab.id, tab.mode === "read" ? settings.editor.defaultEditMode : "read")
                }}
              >
                {tab.mode === "read" ? <Pencil size={15} /> : <BookOpen size={15} />}
              </button>
            </>
          )}
          <MoreMenu
            tabMode={tab.mode}
            isCanvas={isCanvas}
            onToggleSourceLive={() => {
              window.dispatchEvent(new CustomEvent("obs-flush-active-draft"))
              setTabMode(tab.id, tab.mode === "source" ? "live" : "source")
            }}
            onRename={() => ui.openRename({ kind: "note", id: noteId, currentName: note?.name ?? "" })}
            onBookmark={() =>
              addBookmark.mutate({
                vaultId: vaultId!,
                itemType: "note",
                itemId: noteId,
                title: note?.name ?? "",
                subtitle: noteMeta?.path ?? "",
              })
            }
            onMove={() => ui.openMove({ kind: "note", id: noteId, currentName: note?.name ?? "" })}
            onOpenWindow={() =>
              void import("./context-menu").then(({ openNoteInNewWindow }) => openNoteInNewWindow(noteId))
            }
            onExportPdf={() => {
              window.dispatchEvent(new CustomEvent("obs-flush-active-draft"))
              void import("../commands").then(({ exportNoteToPdf }) => exportNoteToPdf(noteId))
            }}
            onDelete={() => {
              useUi.getState().openConfirm({
                title: `Delete "${note?.name ?? "note"}"?`,
                message: "Are you sure you want to delete this file?",
                confirmLabel: "Delete",
                danger: true,
                onConfirm: () => deleteNote.mutate(noteId),
              })
            }}
            onSplitH={() => splitPane("row")}
            onSplitV={() => splitPane("column")}
            onExtract={() => {
              window.dispatchEvent(new CustomEvent("obs-flush-active-draft"))
              const blocks = parseBlocks(content)
              const target = lastBlockRef.current ?? {
                index: blocks.findIndex((b) => b.type === "paragraph"),
                text: blocks.find((b) => b.type === "paragraph")?.text ?? "",
              }
              if (target.index >= 0) onExtractBlock(target.index, target.text)
            }}
            onMakeCopy={async () => {
              window.dispatchEvent(new CustomEvent("obs-flush-active-draft"))
              const copy = await api.createNote(vaultId!, `${note?.name} copy`, note?.folderId ?? null, content)
              useDocs.getState().primeDoc(copy.id, copy.content ?? "")
              window.dispatchEvent(new CustomEvent("obs-invalidate", { detail: { vaultId, kinds: ["tree", "index", "graph"] } }))
              openNote(copy.id)
            }}
          />
        </div>
      </div>

      {/* Canvas fills its pane edge-to-edge without outer scrolling or maxWidth cap */}
      {docEntry?.missing ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <div className="text-[0.95rem] font-medium" style={{ color: "var(--text-normal)" }}>
            File not found
          </div>
          <div className="text-[0.8rem]" style={{ color: "var(--text-faint)" }}>
            This note may have been deleted or moved outside Basalt.
          </div>
        </div>
      ) : isCanvas ? (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <CanvasEditor content={content} onChange={onChange} noteId={noteId} />
        </div>
      ) : (
        <div
          className="obs-editor-scroll relative flex-1 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget && (tab.mode === "live" || tab.mode === "source")) {
              focusBodyRef.current?.()
            }
          }}
        >
          {findOpen && (
            <FindBar
              query={findQuery}
              onQuery={(q) => {
                setFindQuery(q)
                setActiveMatch(0)
              }}
              count={matches.length}
              activeIndex={clampedMatch}
              onPrev={() => gotoMatch(-1)}
              onNext={() => gotoMatch(1)}
              onClose={() => {
                setFindOpen(false)
                focusBodyRef.current?.()
              }}
              showReplace={replaceOpen}
              onReplace={doReplaceOne}
              onReplaceAll={doReplaceAll}
              replaceValue={replaceValue}
              onReplaceValue={setReplaceValue}
              caseSensitive={findCase}
              onToggleCase={() => setFindCase(!findCase)}
              focusTrigger={findFocusNonce}
            />
          )}

          <div
            className="mx-auto flex min-h-full flex-col px-8 pt-2"
            style={{
              maxWidth: readable ? 750 : 1200,
              fontSize: `${settings.appearance.baseFontSize}px`,
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget && (tab.mode === "live" || tab.mode === "source")) {
                focusBodyRef.current?.()
              }
            }}
          >
            {settings.appearance.showInlineTitle && (
              <h1 className="obs-inline-title">
                {note?.name ?? noteMeta?.name ?? (/\.(md|canvas)$/i.test(noteId) ? noteId.split("/").pop()!.replace(/\.(md|canvas)$/i, "") : undefined)}
              </h1>
            )}

            {settings.editor.showProperties === "visible" && settings.corePlugins.properties && !(docEntry?.loading && content === "") && (
              <PropertiesPanel content={content} onChange={onChange} />
            )}

            {docEntry?.loading && content === "" ? (
              <div className="py-8 text-center text-[0.85rem]" style={{ color: "var(--text-faint)" }}>
                Loading…
              </div>
            ) : tab.mode === "read" ? (
              <MarkdownView
                content={content}
                onToggleTask={onToggleTask}
                findQuery={findOpen ? findQuery : null}
                activeFindIndex={clampedMatch}
              />
            ) : tab.mode === "source" ? (
              <SourceEditor
                key={noteId}
                noteId={noteId}
                content={content}
                onChange={onChange}
                findFocusRequest={sourceFocus}
                noteFolderId={note?.folderId ?? null}
                focusEndRef={focusBodyRef}
              />
            ) : (
              <BlockEditor
                key={noteId}
                content={content}
                onChange={onChange}
                onToggleTask={onToggleTask}
                onExtractBlock={onExtractBlock}
                onActiveBlock={onActiveBlock}
                findFocusRequest={blockFocus}
                noteName={note?.name}
                noteFolderId={note?.folderId ?? null}
                focusEndRef={focusBodyRef}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
})

function MoreMenu({
  tabMode,
  isCanvas,
  onToggleSourceLive,
  onRename,
  onBookmark,
  onMove,
  onOpenWindow,
  onExportPdf,
  onDelete,
  onSplitH,
  onSplitV,
  onExtract,
  onMakeCopy,
}: {
  tabMode?: Tab["mode"]
  isCanvas?: boolean
  onToggleSourceLive?: () => void
  onRename: () => void
  onBookmark: () => void
  onMove: () => void
  onOpenWindow: () => void
  onExportPdf: () => void
  onDelete: () => void
  onSplitH: () => void
  onSplitV: () => void
  onExtract: () => void
  onMakeCopy: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])

  const items: { icon: React.ReactNode; label: string; action: () => void; danger?: boolean }[] = [
    ...(!isCanvas && tabMode !== "read" && onToggleSourceLive
      ? [
          {
            icon: <Code size={14} />,
            label: tabMode === "source" ? "Switch to Live Preview" : "Switch to Source mode",
            action: onToggleSourceLive,
          },
        ]
      : []),
    { icon: <TextCursorInput size={14} />, label: "Rename…", action: onRename },
    { icon: <Copy size={14} />, label: "Make a copy", action: onMakeCopy },
    { icon: <FileInput size={14} />, label: "Move file to folder…", action: onMove },
    { icon: <FileInput size={14} />, label: "Open in new window", action: onOpenWindow },
    { icon: <FilePlus2 size={14} />, label: "Split right", action: onSplitH },
    { icon: <FileInput size={14} />, label: "Split down", action: onSplitV },
    { icon: <Bookmark size={14} />, label: "Bookmark", action: onBookmark },
    { icon: <FileInput size={14} />, label: "Extract current paragraph", action: onExtract },
    { icon: <Copy size={14} />, label: "Export to PDF…", action: onExportPdf },
    { icon: <Trash2 size={14} />, label: "Delete file", action: onDelete, danger: true },
  ]
  return (
    <div className="relative" ref={ref}>
      <button className="obs-icon-btn" title="More options" onClick={() => setOpen(!open)}>
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div className="obs-modal absolute right-0 top-8 z-50 min-w-52 p-1 obs-anim-in">
          {items.map((item) => (
            <button
              key={item.label}
              className="obs-tree-row w-full !text-[0.85rem]"
              style={item.danger ? { color: "var(--text-error)" } : undefined}
              onClick={() => {
                setOpen(false)
                item.action()
              }}
            >
              <span className="opacity-70">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SplitButtons() {
  return (
    <>
      <SplitSquareHorizontal size={14} />
      <SplitSquareVertical size={14} />
    </>
  )
}
void SplitButtons
