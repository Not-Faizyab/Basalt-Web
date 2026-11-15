"use client"

// ─── Page preview: hover popover over internal links (core plugin) ──────────
import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { buildIndexMap, extractSection, resolveLink } from "@/lib/obsidian/links"
import { renderMarkdown } from "@/lib/obsidian/markdown"
import { MarkdownBody } from "./markdown-render"
import { openReadingContextMenu } from "./context-menu"
import { api } from "../api"
import { useAttachmentRenderOpts } from "../hooks"
import { useWorkspace } from "../stores/workspace"
import { useUi } from "../stores/ui"
import type { IndexEntry } from "@/lib/obsidian/types"

export function PagePreview() {
  const [preview, setPreview] = useState<{ target: string; subpath: string | null; x: number; y: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const vaultId = useWorkspace((s) => s.vaultId)
  const openNote = useWorkspace((s) => s.openNote)
  const enabled = useWorkspace((s) => s.settings.corePlugins.pagePreview)
  const attachOpts = useAttachmentRenderOpts()

  const { data: index } = useQuery({
    queryKey: ["index", vaultId],
    queryFn: () => api.index(vaultId!),
    enabled: !!vaultId,
    staleTime: 10_000,
  })

  useEffect(() => {
    if (!enabled) {
      setPreview(null)
      return
    }

    const onMouseOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest("a.internal-link") as HTMLAnchorElement | null
      if (!el) {
        if (timerRef.current) clearTimeout(timerRef.current)
        return
      }
      // In edit mode obsidian requires Ctrl/Cmd held; links inside reading view work without modifier.
      const inReading = !!el.closest(".obs-md")
      if (!inReading && !(e.ctrlKey || e.metaKey)) return
      if (inReading && el.closest(".obs-block-editor") && !(e.ctrlKey || e.metaKey)) {
        return
      }

      const target = el.dataset.href
      if (!target) return
      const subpath = el.dataset.subpath || null
      if (closeTimer.current) clearTimeout(closeTimer.current)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        setPreview({ target, subpath, x: e.clientX, y: e.clientY })
      }, 350)
    }

    const onMouseOut = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest("a.internal-link")
      if (el) {
        if (timerRef.current) clearTimeout(timerRef.current)
        closeTimer.current = setTimeout(() => setPreview(null), 250)
      }
    }

    document.addEventListener("mouseover", onMouseOver)
    document.addEventListener("mouseout", onMouseOut)
    return () => {
      document.removeEventListener("mouseover", onMouseOver)
      document.removeEventListener("mouseout", onMouseOut)
      if (timerRef.current) clearTimeout(timerRef.current)
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [enabled])

  const maps = index ? buildIndexMap(index) : null
  const entry: IndexEntry | null = preview && maps ? resolveLink(preview.target, maps) : null

  const { data: note } = useQuery({
    queryKey: ["note", entry?.id],
    queryFn: () => api.note(entry!.id),
    enabled: !!entry,
    staleTime: 5_000,
  })

  if (!preview || !entry) return null

  const bodySource = note ? (preview.subpath ? extractSection(note.content, preview.subpath) : note.content.slice(0, 1600)) : ""
  const result = note ? renderMarkdown(bodySource, { index: index ?? [], ...attachOpts }) : null

  // position: below-right of cursor, clamped cleanly to viewport on all edges
  const style: React.CSSProperties = (() => {
    const w = Math.min(440, Math.max(240, window.innerWidth - 24))
    const h = Math.min(300, Math.max(180, window.innerHeight - 24))
    let x = preview.x + 16
    let y = preview.y + 18
    if (x + w > window.innerWidth - 12) x = preview.x - w - 16
    x = Math.max(12, Math.min(x, window.innerWidth - w - 12))
    if (y + h > window.innerHeight - 12) y = preview.y - h - 12
    y = Math.max(12, Math.min(y, window.innerHeight - h - 12))
    return { left: x, top: y, width: w, maxHeight: h }
  })()

  return (
    <div
      ref={popRef}
      className="obs-modal obs-anim-in fixed z-[70] overflow-y-auto p-3"
      style={style}
      onMouseEnter={() => {
        if (closeTimer.current) clearTimeout(closeTimer.current)
      }}
      onMouseLeave={() => setPreview(null)}
      onContextMenu={openReadingContextMenu}
    >
      <button
        className="mb-1.5 flex items-center gap-1.5 text-[0.85rem] font-semibold"
        style={{ color: "var(--text-accent)" }}
        onClick={() => {
          openNote(entry.id, { subpath: preview.subpath })
          setPreview(null)
        }}
      >
        {entry.name}
        {preview.subpath ? <span className="opacity-70 font-normal">{preview.subpath.replace("#", " › #")}</span> : null}
      </button>
      {result ? (
        <div style={{ fontSize: "0.85em" }}>
          <MarkdownBody result={result} index={index ?? []} />
        </div>
      ) : (
        <div className="py-4 text-center text-[0.8rem]" style={{ color: "var(--text-faint)" }}>
          Loading preview…
        </div>
      )}
    </div>
  )
}

void useUi
