"use client"

// ─── Slides presenter (core plugin) ──────────────────────────────────────────
// Renders the active note split on `---` separators as fullscreen slides with
// keyboard navigation — exactly like obsidian's Slides plugin, fully local.
import { useEffect, useMemo, useState } from "react"
import { renderMarkdown } from "@/lib/obsidian/markdown"
import { MarkdownBody } from "./markdown-render"
import { useWorkspace } from "../stores/workspace"
import { useUi } from "../stores/ui"
import { useDocs } from "../stores/docs"
import { useAttachmentRenderOpts } from "../hooks"
import { useQuery } from "@tanstack/react-query"
import { api } from "../api"
import { ChevronLeft, ChevronRight, X } from "lucide-react"

export function SlidesPresenter() {
  const slidesActive = useUi((s) => s.slidesActive)
  if (!slidesActive) return null
  return <SlidesPresenterInner />
}

function SlidesPresenterInner() {
  const active = useWorkspace((s) => s.getActiveTab())
  const noteId = active?.noteId ?? null
  const stop = useUi((s) => s.stopSlides)
  const docs = useDocs((s) => s.docs)
  const [idx, setIdx] = useState(0)

  const { data: note } = useQuery({
    queryKey: ["note", noteId],
    queryFn: () => api.note(noteId!),
    enabled: !!noteId,
  })
  const { data: index } = useQuery({
    queryKey: ["index", useWorkspace((s) => s.vaultId)],
    queryFn: () => api.index(useWorkspace.getState().vaultId!),
    enabled: !!useWorkspace((s) => s.vaultId),
    staleTime: 10_000,
  })

  const attachOpts = useAttachmentRenderOpts()
  const content = (noteId && docs[noteId]?.content) || note?.content || ""

  const slides = useMemo(() => {
    if (!content.trim()) return []
    // frontmatter off, then split on --- rules (outside matching ```/~~~ code fences)
    const fm = content.match(/^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/)
    const body = fm ? content.slice(fm[0].length) : content
    const parts: string[] = []
    let buf: string[] = []
    let fence: { char: string; len: number } | null = null
    for (const line of body.split(/\r?\n/)) {
      const m = line.match(/^\s*(`{3,}|~{3,})(.*)$/)
      if (m) {
        const ch = m[1][0]
        const len = m[1].length
        if (!fence) fence = { char: ch, len }
        else if (fence.char === ch && len >= fence.len && m[2].trim() === "") fence = null
      }
      if (!fence && /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        parts.push(buf.join("\n"))
        buf = []
      } else {
        buf.push(line)
      }
    }
    parts.push(buf.join("\n"))
    return parts.map((s) => s.trim()).filter((s) => s !== "")
  }, [content])

  const clampedIdx = Math.min(idx, Math.max(0, slides.length - 1))

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop()
      else if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault()
        setIdx((i) => Math.min(i + 1, Math.max(0, slides.length - 1)))
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault()
        setIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === "Home") setIdx(0)
      else if (e.key === "End") setIdx(Math.max(0, slides.length - 1))
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [slides.length, stop])

  const current = slides[clampedIdx]
  const result = useMemo(
    () => (current ? renderMarkdown(current, { index: index ?? [], ...attachOpts }) : null),
    [current, index, attachOpts],
  )

  return (
    <div className="fixed inset-0 z-[90] flex flex-col" style={{ background: "var(--background-primary)" }}>
      <div className="flex flex-1 items-center justify-center overflow-hidden px-14 py-10">
        {result ? (
          <div className="w-full max-w-4xl" style={{ fontSize: "1.35rem" }}>
            <MarkdownBody result={result} index={index ?? []} />
          </div>
        ) : (
          <div className="text-[1.1rem]" style={{ color: "var(--text-faint)" }}>
            {slides.length === 0 ? "This note has no slides — separate them with ---" : ""}
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-4 pb-5 text-[0.8rem]" style={{ color: "var(--text-muted)" }}>
        <button className="obs-icon-btn" title="Previous (←)" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={clampedIdx === 0}>
          <ChevronLeft size={16} />
        </button>
        <span>
          {slides.length === 0 ? 0 : clampedIdx + 1} / {slides.length}
        </span>
        <button className="obs-icon-btn" title="Next (→)" onClick={() => setIdx((i) => Math.min(slides.length - 1, i + 1))} disabled={clampedIdx >= slides.length - 1}>
          <ChevronRight size={16} />
        </button>
        <button className="obs-icon-btn" title="Exit (Esc)" onClick={stop}>
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
