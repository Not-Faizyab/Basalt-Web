"use client"

// ─── MarkdownView: renders segments, recursive embeds, media, clicks ────────
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { FileAudio, FileText, Film, Link2 } from "lucide-react"
import { renderMarkdown } from "@/lib/obsidian/markdown"
import { buildIndexMap, extractSection, resolveLink } from "@/lib/obsidian/links"
import type { AttachmentRef, IndexEntry, RenderResult, VaultFileMeta } from "@/lib/obsidian/types"
import { api } from "../api"
import { useWorkspace } from "../stores/workspace"
import { useDocs } from "../stores/docs"
import { useUi } from "../stores/ui"
import { useAttachmentRenderOpts } from "../hooks"
import { openReadingContextMenu } from "./context-menu"

// ─── Click intent plumbing ───────────────────────────────────────────────────

export interface MarkdownNav {
  onOpenNote: (target: string, subpath: string | null, newTab: boolean) => void
  onTag: (tag: string) => void
  onOpenAttachment: (fileId: string, newTab: boolean) => void
}

function useNav(): MarkdownNav {
  const openNote = useWorkspace((s) => s.openNote)
  const openAttachment = useWorkspace((s) => s.openAttachment)
  return {
    onOpenNote: (target, subpath, newTab) => {
      openNote(target, { newTab, subpath })
    },
    onTag: (tag) => {
      useUi.getState().setSearchQuery("tag:#" + tag)
      useWorkspace.getState().setLeftTab("search")
    },
    onOpenAttachment: (fileId, newTab) => {
      openAttachment(fileId, { newTab })
    },
  }
}

// ─── HTML segment with delegated interactions ────────────────────────────────

interface HtmlSegmentProps {
  html: string
  onToggleTask?: (taskIndex: number) => void
  findQuery?: string | null
  findCase?: boolean
  activeFindIndex?: number
  scrollAnchorRef?: React.RefObject<HTMLDivElement | null>
}

export function HtmlSegment({ html, onToggleTask, findQuery, findCase = false, activeFindIndex, scrollAnchorRef }: HtmlSegmentProps) {
  const nav = useNav()
  const ref = useRef<HTMLDivElement>(null)
  const { data: index } = useQuery({
    queryKey: ["index", useWorkspace((s) => s.vaultId)],
    queryFn: () => api.index(useWorkspace.getState().vaultId!),
    enabled: !!useWorkspace((s) => s.vaultId),
    staleTime: 10_000,
  })

  // search-term highlighting in reading view (always unwrap prior marks first)
  useEffect(() => {
    const el = scrollAnchorRef?.current ?? ref.current
    if (!el) return
    el.querySelectorAll("mark.search-find-match").forEach((mark) => {
      const parent = mark.parentNode
      if (!parent) return
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
      parent.removeChild(mark)
    })
    el.normalize()

    if (!findQuery || findQuery.trim() === "") return
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const textNodes: Text[] = []
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text)
    const needle = findCase ? findQuery : findQuery.toLowerCase()
    let matchNo = 0
    for (const node of textNodes) {
      const text = node.nodeValue ?? ""
      const hay = findCase ? text : text.toLowerCase()
      let idx = hay.indexOf(needle)
      if (idx === -1) continue
      const frag = document.createDocumentFragment()
      let last = 0
      while (idx !== -1) {
        if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)))
        const mark = document.createElement("mark")
        mark.className = "search-find-match" + (matchNo === activeFindIndex ? " is-active" : "")
        mark.textContent = text.slice(idx, idx + needle.length)
        frag.appendChild(mark)
        matchNo++
        last = idx + needle.length
        idx = hay.indexOf(needle, last)
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
      node.parentNode?.replaceChild(frag, node)
    }
    if (activeFindIndex !== undefined && activeFindIndex >= 0) {
      const active = el.querySelector(".search-find-match.is-active")
      active?.scrollIntoView({ block: "center" })
    } else {
      const first = el.querySelector(".search-find-match")
      first?.scrollIntoView({ block: "center" })
    }
  }, [findQuery, findCase, activeFindIndex, html, scrollAnchorRef])

  // collapse foldable callouts initially
  useEffect(() => {
    const el = scrollAnchorRef?.current ?? ref.current
    if (!el) return
    el.querySelectorAll<HTMLElement>(".obs-callout[data-callout-fold='-']").forEach((c) => {
      if (!c.dataset.userToggled) c.dataset.collapsed = "true"
    })
  }, [html, scrollAnchorRef])

  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement

    // checkbox toggle
    const checkbox = target.closest('input[type="checkbox"][data-task]') as HTMLInputElement | null
    if (checkbox) {
      e.preventDefault()
      onToggleTask?.(parseInt(checkbox.dataset.task ?? "0", 10))
      return
    }

    // callout fold (do not intercept interactive links/tags/buttons inside the callout title)
    const callout = target.closest(".obs-callout[data-callout-fold]") as HTMLElement | null
    if (callout && target.closest(".obs-callout-title") && !target.closest("a, button, input")) {
      callout.dataset.userToggled = "1"
      callout.dataset.collapsed = callout.dataset.collapsed === "true" ? "false" : "true"
      return
    }

    // internal link
    const link = target.closest("a.internal-link, a.internal-embed-chip") as HTMLAnchorElement | null
    if (link) {
      e.preventDefault()
      const attachId = link.dataset.attachment
      if (attachId) {
        nav.onOpenAttachment(attachId, e.ctrlKey || e.metaKey)
        return
      }
      const href = link.dataset.href ?? ""
      const subpath = link.dataset.subpath || null
      nav.onOpenNote(href, subpath, e.ctrlKey || e.metaKey)
      return
    }

    // embedded vault image → open in a viewer tab
    const img = target.closest("img[data-vault-file]") as HTMLImageElement | null
    if (img) {
      const fid = img.dataset.vaultFile
      if (fid) nav.onOpenAttachment(fid, e.ctrlKey || e.metaKey)
      return
    }

    // tag
    const tag = target.closest("a.tag") as HTMLAnchorElement | null
    if (tag) {
      e.preventDefault()
      nav.onTag(tag.dataset.tag ?? "")
      return
    }

    // embed title click → open note
    const embedTitle = target.closest(".obs-embed-title") as HTMLElement | null
    if (embedTitle) {
      const href = embedTitle.dataset.href
      if (href) nav.onOpenNote(href, null, e.ctrlKey || e.metaKey)
      return
    }

    // footnote
    const fn = target.closest(".obs-footnote-ref") as HTMLElement | null
    if (fn) {
      e.preventDefault()
      const rootEl = scrollAnchorRef?.current ?? ref.current ?? document
      const targetEl = rootEl.querySelector(`#fn-${fn.dataset.footnote}`) ?? document.getElementById("fn-" + fn.dataset.footnote)
      targetEl?.scrollIntoView({ behavior: "smooth", block: "center" })
      return
    }
    const fnBack = target.closest(".obs-footnote-backref") as HTMLElement | null
    if (fnBack) {
      e.preventDefault()
      const fnIdx = fnBack.dataset.fnBack
      const rootEl = scrollAnchorRef?.current ?? ref.current
      const refTarget = fnIdx ? (rootEl?.querySelector(`#fn-ref-${fnIdx}`) ?? document.getElementById(`fn-ref-${fnIdx}`)) : null
      if (refTarget) {
        refTarget.scrollIntoView({ behavior: "smooth", block: "center" })
      } else {
        const scroller = rootEl?.closest(".obs-editor-scroll")
        if (scroller) scroller.scrollTo({ top: 0, behavior: "smooth" })
        else rootEl?.scrollIntoView({ behavior: "smooth", block: "start" })
      }
      return
    }
  }

  return (
    <div
      ref={scrollAnchorRef ?? ref}
      className="obs-md"
      onClick={handleClick}
      onContextMenu={openReadingContextMenu}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// ─── Embed component (recursive, depth-limited) ──────────────────────────────

const EmbedView = memo(function EmbedView({
  target,
  subpath,
  depth,
  stack,
}: {
  target: string
  subpath: string | null
  depth: number
  stack: string[]
}) {
  const { data: index } = useQuery({
    queryKey: ["index", useWorkspace((s) => s.vaultId)],
    queryFn: () => api.index(useWorkspace.getState().vaultId!),
    enabled: !!useWorkspace((s) => s.vaultId),
    staleTime: 10_000,
  })
  const maps = useMemo(() => buildIndexMap(index ?? []), [index])
  const entry: IndexEntry | null = useMemo(() => (index ? resolveLink(target, maps) : null), [target, maps, index])

  const { data: note } = useQuery({
    queryKey: ["note", entry?.id],
    queryFn: () => api.note(entry!.id),
    enabled: !!entry,
    staleTime: 5_000,
  })

  const openNote = useWorkspace((s) => s.openNote)
  const docs = useDocs((s) => s.docs)
  const attachOpts = useAttachmentRenderOpts()

  if (!entry) {
    return (
      <div className="obs-md">
        <div className="obs-embed">
          <div className="flex items-center gap-2 text-[0.85em]" style={{ color: "var(--text-faint)" }}>
            <Link2 size={13} />
            <span>
              <a
                className="internal-link is-unresolved"
                data-href={target}
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  openNote(target)
                }}
              >
                {target}
              </a>{" "}
              — no note found. Click to create.
            </span>
          </div>
        </div>
      </div>
    )
  }

  if (depth > 3 || stack.includes(entry.id)) {
    return (
      <div className="obs-md">
        <div className="obs-embed" style={{ color: "var(--text-faint)", fontSize: "0.85em" }}>
          <em>Circular embed detected for &quot;{entry.name}&quot; — not expanded.</em>
        </div>
      </div>
    )
  }

  const docContent = docs[entry.id]?.content
  const isLoaded = docContent !== undefined || note !== undefined
  const content = docContent !== undefined ? docContent : (note?.content ?? "")
  const section = subpath ? extractSection(content, subpath) : content
  const result: RenderResult | null = isLoaded ? renderMarkdown(section, { index: index ?? [], ...attachOpts }) : null

  return (
    <div className="obs-md">
      <div className="obs-embed">
        <div className="obs-embed-title" data-href={target} onClick={() => openNote(entry.id, { subpath })}>
          <FileText size={12} />
          <span>
            {entry.name}
            {subpath ? subpath.replace("#", " › #") : ""}
          </span>
        </div>
        {result ? (
          result.segments.length > 0 ? (
            <MarkdownBody result={result} index={index ?? []} depth={depth + 1} stack={[...stack, entry.id]} />
          ) : (
            <div style={{ color: "var(--text-faint)", fontSize: "0.85em" }}>
              <em>(Empty)</em>
            </div>
          )
        ) : (
          <div style={{ color: "var(--text-faint)", fontSize: "0.85em" }}>Loading embed…</div>
        )}
      </div>
    </div>
  )
})

// ─── Media embed: ![[file.png]] / ![[song.mp3]] / ![[doc.pdf]] standalone ───

const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "flac", "opus", "aac", "oga"])
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv", "m4v", "ogv"])
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico"])

export const MediaEmbed = memo(function MediaEmbed({ media }: { media: AttachmentRef }) {
  const vaultId = useWorkspace((s) => s.vaultId)
  const openAttachment = useWorkspace((s) => s.openAttachment)
  const file = media.file
  if (!file) return null
  const url = vaultId ? api.attachmentUrl(vaultId, file.id) : null
  const label = `${file.name}.${file.ext}`
  const sizeStyle: React.CSSProperties | undefined =
    media.size || media.height
      ? {
          ...(media.size ? { maxWidth: media.size, width: media.height ? media.size : undefined } : {}),
          ...(media.height ? { height: media.height, objectFit: "contain" } : {}),
        }
      : undefined

  if (!url) {
    // platforms without file access (web edition) — honest placeholder
    return (
      <div className="obs-media-embed obs-media-unavailable">
        <span className="opacity-70">{label}</span>
        <span className="text-[0.72rem]" style={{ color: "var(--text-faint)" }}>
          — vault file (desktop edition)
        </span>
      </div>
    )
  }

  if (IMAGE_EXTS.has(file.ext)) {
    return (
      <div className="obs-media-embed">
        <img
          src={url}
          alt={file.name}
          style={sizeStyle}
          onClick={(e) => openAttachment(file.id, { newTab: e.ctrlKey || e.metaKey })}
          title={`${label} — click to open`}
        />
      </div>
    )
  }
  if (AUDIO_EXTS.has(file.ext)) {
    return (
      <div className="obs-media-embed obs-media-audio">
        <div className="flex items-center gap-2 text-[0.8rem]" style={{ color: "var(--text-muted)" }}>
          <FileAudio size={14} className="shrink-0" />
          <span className="truncate">{label}</span>
        </div>
        <audio controls src={url} preload="metadata" />
      </div>
    )
  }
  if (VIDEO_EXTS.has(file.ext)) {
    return (
      <div className="obs-media-embed obs-media-video">
        <div className="flex items-center gap-2 text-[0.8rem]" style={{ color: "var(--text-muted)" }}>
          <Film size={14} className="shrink-0" />
          <span className="truncate">{label}</span>
        </div>
        <video controls src={url} preload="metadata" style={{ maxWidth: "100%" }} />
      </div>
    )
  }
  if (file.ext === "pdf") {
    return (
      <div className="obs-media-embed obs-media-pdf">
        <div className="flex items-center justify-between text-[0.8rem]" style={{ color: "var(--text-muted)" }}>
          <span className="flex items-center gap-2 truncate">
            <FileText size={14} className="shrink-0" />
            {label}
          </span>
          <button
            className="obs-text-btn !px-2 !py-0 !text-[0.72rem]"
            onClick={() => void api.openWithDefaultApp(vaultId!, file.id)}
          >
            Open with default app
          </button>
        </div>
        <embed type="application/pdf" src={url} style={{ width: "100%", height: "60vh" }} />
      </div>
    )
  }
  return (
    <div className="obs-media-embed obs-media-file" onClick={(e) => openAttachment(file.id, { newTab: e.ctrlKey || e.metaKey })}>
      <span className="opacity-70">{label}</span>
      <span className="text-[0.72rem]" style={{ color: "var(--text-faint)" }}>
        — click to open
      </span>
    </div>
  )
})

// ─── Body: segments → html/embeds/media ───────────────────────────────────────

export const MarkdownBody = memo(function MarkdownBody({
  result,
  index,
  onToggleTask,
  depth = 0,
  stack = [],
  findQuery,
  findCase = false,
  activeFindIndex,
  scrollAnchorRef,
  cssClasses,
}: {
  result: RenderResult
  index: IndexEntry[]
  onToggleTask?: (taskIndex: number) => void
  depth?: number
  stack?: string[]
  findQuery?: string | null
  findCase?: boolean
  activeFindIndex?: number
  scrollAnchorRef?: React.RefObject<HTMLDivElement | null>
  cssClasses?: string[]
}) {
  const cls = cssClasses && cssClasses.length > 0 ? ["obs-md-body", ...cssClasses].join(" ") : "obs-md-body"
  return (
    <div className={cls}>
      {result.segments.map((seg, i) =>
        seg.kind === "html" ? (
          <HtmlSegment
            key={i}
            html={seg.html}
            onToggleTask={onToggleTask}
            findQuery={findQuery}
            findCase={findCase}
            activeFindIndex={activeFindIndex}
            scrollAnchorRef={scrollAnchorRef}
          />
        ) : seg.kind === "media" ? (
          <MediaEmbed key={i} media={seg.media} />
        ) : (
          <EmbedView key={i} target={seg.embed.target} subpath={seg.embed.subpath} depth={depth} stack={stack} />
        ),
      )}
    </div>
  )
})

// ─── Top-level view: content → render → body ─────────────────────────────────

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export const MarkdownView = memo(function MarkdownView({
  content,
  noteId,
  onToggleTask,
  findQuery,
  findCase = false,
  activeFindIndex,
  scrollAnchorRef,
}: {
  content: string
  noteId?: string
  onToggleTask?: (taskIndex: number) => void
  findQuery?: string | null
  findCase?: boolean
  activeFindIndex?: number
  scrollAnchorRef?: React.RefObject<HTMLDivElement | null>
}) {
  const { data: index } = useQuery({
    queryKey: ["index", useWorkspace((s) => s.vaultId)],
    queryFn: () => api.index(useWorkspace.getState().vaultId!),
    enabled: !!useWorkspace((s) => s.vaultId),
    staleTime: 10_000,
  })
  const strictLineBreaks = useWorkspace((s) => s.settings.editor.strictLineBreaks)
  const attachOpts = useAttachmentRenderOpts()

  const renderedContent = useDebouncedValue(content, 120)
  const result = useMemo(
    () => renderMarkdown(renderedContent, { index: index ?? [], strictLineBreaks, ...attachOpts }),
    [renderedContent, index, strictLineBreaks, attachOpts],
  )

  return (
    <MarkdownBody
      result={result}
      index={index ?? []}
      onToggleTask={onToggleTask}
      stack={noteId ? [noteId] : []}
      findQuery={findQuery}
      findCase={findCase}
      activeFindIndex={activeFindIndex}
      scrollAnchorRef={scrollAnchorRef}
      cssClasses={result.cssClasses}
    />
  )
})
