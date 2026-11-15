"use client"

// ─── Live Preview: block-based WYSIWYG editor (obsidian's default mode) ──────
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { parseBlocks, serializeBlocks, type Block } from "@/lib/obsidian/blocks"
import { renderMarkdown } from "@/lib/obsidian/markdown"
import type { IndexEntry, RenderResult } from "@/lib/obsidian/types"
import { MarkdownBody } from "./markdown-render"
import { AutocompletePopup, detectSuggest, getCaretViewportPos, useSuggestItems, type CaretViewportPos, type SuggestState } from "./autocomplete"
import { SlashMenu, extractSlashQuery, filterSlashItems } from "./slash-menu"
import { savePastedFiles } from "../paste-attachment"
import { useWorkspace } from "../stores/workspace"
import { useQuery } from "@tanstack/react-query"
import { api } from "../api"
import { useAttachmentRenderOpts } from "../hooks"
import { openEditorContextMenu, showMenuAt, linkMenuItems } from "./context-menu"
import { toast } from "sonner"

function countTasks(text: string): number {
  return (text.match(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/gm) ?? []).length
}

/** Estimate raw draft character index corresponding to a click point inside a rendered block. */
function estimateOffsetFromClick(blockEl: HTMLElement | null, clientX: number, clientY: number, draftText: string): number {
  if (!blockEl || typeof document === "undefined" || !draftText) return draftText.length
  try {
    const caretRangeFn = document.caretRangeFromPoint?.bind(document)
    const range = caretRangeFn ? caretRangeFn(clientX, clientY) : null
    if (!range || !blockEl.contains(range.startContainer)) return draftText.length
    const prefixRange = document.createRange()
    prefixRange.setStart(blockEl, 0)
    prefixRange.setEnd(range.startContainer, range.startOffset)
    const renderedPrefix = prefixRange.toString()
    const fullRendered = blockEl.textContent ?? ""
    if (!fullRendered.length) return draftText.length
    const ratio = Math.max(0, Math.min(1, renderedPrefix.length / fullRendered.length))
    return Math.round(ratio * draftText.length)
  } catch {
    return draftText.length
  }
}

/** id of the synthetic paragraph used for empty documents */
const VIRTUAL_EMPTY_ID = "virtual-empty-paragraph"
/** id of the synthetic continuation paragraph created by Enter at block end */
const VIRTUAL_CONT_ID = "virtual-continuation-paragraph"

const isVirtualId = (id: string | null | undefined) => id === VIRTUAL_EMPTY_ID || id === VIRTUAL_CONT_ID

/** Keep the line-ending style of the original block text when committing a draft. */
function preserveLineEndings(original: string, draft: string): string {
  if (!/\r/.test(original)) return draft
  // textareas normalize every newline to \n — restore \r\n for CRLF blocks
  let out = draft.replace(/([^\r])\n/g, "$1\r\n")
  // restore a stripped trailing CR (the CRLF tail of the block's last line)
  if (original.endsWith("\r") && !out.endsWith("\r")) out += "\r"
  return out
}

/** The textarea works with \n only; drop \r (both real \r\n breaks and lone tails). */
function toDraft(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "")
}

interface BlockEditorProps {
  content: string
  onChange: (next: string) => void
  onToggleTask?: (taskIndex: number) => void
  onExtractBlock?: (blockIndex: number, text: string) => void
  onExtractSelection?: (text: string) => void
  onActiveBlock?: (blockIndex: number, text: string) => void
  findFocusRequest?: { blockIndex: number; start: number; end: number; nonce: number } | null
  noteName?: string
  noteFolderId?: string | null
  focusEndRef?: React.MutableRefObject<(() => void) | null>
}

export const BlockEditor = memo(function BlockEditor({
  content,
  onChange,
  onToggleTask,
  onExtractBlock,
  onExtractSelection,
  onActiveBlock,
  findFocusRequest,
  noteName,
  noteFolderId,
  focusEndRef,
}: BlockEditorProps) {
  const [pendingEmptyAfter, setPendingEmptyAfter] = useState<number | null>(null)
  const spellcheck = useWorkspace((s) => s.settings.editor.spellcheck)
  const indentWithTabs = useWorkspace((s) => s.settings.editor.indentWithTabs)
  const tabSize = useWorkspace((s) => s.settings.editor.tabSize)
  const vaultId = useWorkspace((s) => s.vaultId)
  const attachOpts = useAttachmentRenderOpts()
  const blocks = useMemo(() => {
    const parsed = parseBlocks(content)
    const hasBody = parsed.some((b) => b.type !== "frontmatter")
    if (!hasBody) {
      const fm = parsed.find((b) => b.type === "frontmatter")
      const virtual: Block = { id: VIRTUAL_EMPTY_ID, type: "paragraph", text: "" }
      return fm ? [fm, virtual] : [virtual]
    }
    if (pendingEmptyAfter !== null) {
      const idx = Math.min(pendingEmptyAfter, parsed.length - 1)
      const out = [...parsed]
      out.splice(idx + 1, 0, { id: VIRTUAL_CONT_ID, type: "paragraph", text: "" })
      return out
    }
    return parsed
  }, [content, pendingEmptyAfter])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [suggest, setSuggest] = useState<SuggestState>({ kind: null, query: "" })
  const [suggestSel, setSuggestSel] = useState(0)
  const [slash, setSlash] = useState<{ query: string; lineStart: number } | null>(null)
  const [slashSel, setSlashSel] = useState(0)
  const [caretPos, setCaretPos] = useState<CaretViewportPos | null>(null)
  const suggestItems = useSuggestItems(suggest)
  const slashItems = useMemo(() => (slash !== null ? filterSlashItems(slash.query) : []), [slash])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  const blurTimerRef = useRef<number | null>(null)
  const editingRef = useRef<string | null>(null)
  useEffect(() => {
    editingRef.current = editingId
  }, [editingId])

  const clearBlurTimer = () => {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
    }
  }

  // live refs so unmount / flush / async paste always sees latest values
  const draftRef = useRef(draft)
  draftRef.current = draft
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const contentRef = useRef(content)
  contentRef.current = content
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const commitDraftRef = useRef<(nextEditing?: string | null) => string>(() => "")

  useEffect(() => {
    const flushNow = () => {
      clearBlurTimer()
      if (editingRef.current !== null) commitDraftRef.current(null)
    }
    window.addEventListener("obs-flush-active-draft", flushNow)
    return () => {
      window.removeEventListener("obs-flush-active-draft", flushNow)
      clearBlurTimer()
      const cur = editingRef.current
      if (cur === null) return
      const bs = blocksRef.current
      const curBlock = bs.find((b) => b.id === cur)
      if (!curBlock) return
      const d = draftRef.current
      if (isVirtualId(cur) && d === "") return
      const draftText = preserveLineEndings(curBlock.text, d)
      if (draftText === curBlock.text) return
      const nextBlocks = bs.map((b) => (b.id === cur ? { ...b, text: draftText } : b))
      const real = nextBlocks.filter((b) => !isVirtualId(b.id) || b.text !== "")
      const next = serializeBlocks(real)
      if (next !== contentRef.current) onChangeRef.current(next)
    }
  }, [])

  const { data: index } = useQuery({
    queryKey: ["index", vaultId],
    queryFn: () => api.index(vaultId!),
    enabled: !!vaultId,
    staleTime: 10_000,
  })

  // ── commit / navigate ────────────────────────────────────────────────────

  const isVirtual = (b: Pick<Block, "id" | "text">) => isVirtualId(b.id)

  const commitBlocks = (nextBlocks: Block[], baseContent = contentRef.current): string | null => {
    const real = nextBlocks.filter((b) => !isVirtual(b) || b.text !== "")
    const next = serializeBlocks(real)
    return next === baseContent ? null : next
  }

  const commitDraft = useCallback((nextEditing: string | null = null): string => {
    clearBlurTimer()
    const cur = editingRef.current
    const bs = blocksRef.current
    const curDraft = draftRef.current
    if (cur === null) return curDraft
    const curBlock = bs.find((b) => b.id === cur)
    if (curBlock && isVirtualId(cur) && curDraft === "") {
      if (cur === VIRTUAL_CONT_ID) setPendingEmptyAfter(null)
      editingRef.current = nextEditing
      setEditingId(nextEditing)
      if (nextEditing === null) {
        setSuggest({ kind: null, query: "" })
        setSlash(null)
      }
      return curDraft
    }
    const draftText = curBlock ? preserveLineEndings(curBlock.text, curDraft) : curDraft
    if (curBlock && draftText === curBlock.text) {
      if (cur === VIRTUAL_CONT_ID) setPendingEmptyAfter(null)
      editingRef.current = nextEditing
      setEditingId(nextEditing)
      if (nextEditing === null) {
        setSuggest({ kind: null, query: "" })
        setSlash(null)
      }
      return curDraft
    }
    const nextBlocks = bs.map((b) => (b.id === cur ? { ...b, text: draftText } : b))
    const next = commitBlocks(nextBlocks)
    if (next !== null) {
      onChangeRef.current(next)
      if (cur === VIRTUAL_CONT_ID) setPendingEmptyAfter(null)
    }
    editingRef.current = nextEditing
    setEditingId(nextEditing)
    if (nextEditing === null) {
      setSuggest({ kind: null, query: "" })
      setSlash(null)
    }
    return curDraft
  }, [])
  commitDraftRef.current = commitDraft

  const startEdit = (block: Block, caret: "start" | "end" | number = "end") => {
    clearBlurTimer()
    if (block.type === "frontmatter") return
    const sameBlock = editingRef.current === block.id
    if (editingRef.current && !sameBlock) {
      const cur = editingRef.current
      const curBlock = blocksRef.current.find((b) => b.id === cur)
      const curDraft = draftRef.current
      const draftText = curBlock ? preserveLineEndings(curBlock.text, curDraft) : curDraft
      if (curBlock && draftText !== curBlock.text && !(isVirtualId(cur) && curDraft === "")) {
        const nextBlocks = blocksRef.current.map((b) => (b.id === cur ? { ...b, text: draftText } : b))
        const next = commitBlocks(nextBlocks)
        if (next !== null) {
          onChange(next)
        }
      }
      if (cur === VIRTUAL_CONT_ID && block.id !== VIRTUAL_CONT_ID) {
        setPendingEmptyAfter(null)
      }
    }
    if (!sameBlock) {
      editingRef.current = block.id
      setEditingId(block.id)
      const bIdx = blocksRef.current.findIndex((b) => b.id === block.id)
      const leadGap = block.gapBefore && !block.text.startsWith(block.gapBefore) ? block.gapBefore : ""
      const fullText = (bIdx === 0 ? leadGap : "") + block.text
      setDraft(toDraft(fullText))
      setSuggest({ kind: null, query: "" })
      setSlash(null)
    }
    const blockIdx = blocksRef.current.findIndex((b) => b.id === block.id)
    if (blockIdx >= 0) onActiveBlock?.(blockIdx, block.text)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        const pos =
          typeof caret === "number"
            ? Math.max(0, Math.min(caret, el.value.length))
            : caret === "start"
              ? 0
              : el.value.length
        el.setSelectionRange(pos, pos)
      }
    })
  }

  const editBlockAtIndex = (idx: number, caret: "start" | "end" = "end") => {
    const bs = blocksRef.current
    if (idx < 0 || idx >= bs.length) return
    let i = idx
    while (i > 0 && bs[i] && bs[i].type === "frontmatter") i--
    const b = bs[i]
    if (b && b.type !== "frontmatter") startEdit(b, caret)
  }

  // find-focus request (from global find bar)
  const lastFindNonce = useRef(0)
  useEffect(() => {
    if (!findFocusRequest || findFocusRequest.nonce === lastFindNonce.current) return
    lastFindNonce.current = findFocusRequest.nonce
    const req = findFocusRequest
    clearBlurTimer()
    const raf = requestAnimationFrame(() => {
      const b = blocksRef.current[req.blockIndex]
      if (!b || b.type === "frontmatter") return
      startEdit(b)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (el) {
          el.focus()
          el.setSelectionRange(req.start, req.end)
          el.scrollIntoView({ block: "nearest" })
        }
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [findFocusRequest])

  // auto-resize textarea
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = "auto"
      el.style.height = el.scrollHeight + "px"
    }
  }, [draft, editingId])

  // ── keyboard handling ─────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, blockIdx: number) => {
    const el = e.currentTarget
    const value = el.value
    const caret = el.selectionStart

    // autocomplete navigation takes priority
    if (suggest.kind) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSuggestSel((s) => Math.min(s + 1, Math.max(0, suggestItems.length - 1)))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSuggestSel((s) => Math.max(s - 1, 0))
        return
      }
      if ((e.key === "Enter" || e.key === "Tab") && suggestItems.length > 0) {
        e.preventDefault()
        acceptSuggest(suggestItems[suggestSel]?.value ?? "", suggest.kind === "tag")
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setSuggest({ kind: null, query: "" })
        return
      }
    }

    // slash-command menu navigation
    if (slash !== null) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSlashSel((s) => Math.min(s + 1, Math.max(0, slashItems.length - 1)))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSlashSel((s) => Math.max(s - 1, 0))
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (slashItems.length > 0) {
          e.preventDefault()
          acceptSlash(slashItems[slashSel])
          return
        }
        setSlash(null)
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setSlash(null)
        return
      }
    }

    if (e.key === "Escape") {
      e.preventDefault()
      commitDraft(null)
      el.blur()
      return
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      commitDraft(null)
      return
    }

    // Tab / Shift+Tab — indent or outdent active line(s)
    if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      const unit = indentWithTabs ? "\t" : " ".repeat(Math.max(1, tabSize))
      const start = el.selectionStart
      const end = el.selectionEnd
      const block = blocks[blockIdx]
      if (!e.shiftKey && start === end && block?.type !== "list") {
        const next = value.slice(0, start) + unit + value.slice(end)
        setDraft(next)
        draftRef.current = next
        requestAnimationFrame(() => el.setSelectionRange(start + unit.length, start + unit.length))
        return
      }
      const lineStart = value.lastIndexOf("\n", start - 1) + 1
      const nlAfter = value.indexOf("\n", Math.max(start, end > start && value[end - 1] === "\n" ? end - 1 : end))
      const blockEnd = nlAfter === -1 ? value.length : nlAfter
      const lines = value.slice(lineStart, blockEnd).split("\n")
      const spaceRe = new RegExp(`^ {1,${Math.max(1, tabSize)}}`)
      let firstDelta = 0
      let totalDelta = 0
      const updated = lines.map((l, idx) => {
        if (e.shiftKey) {
          const nextL = l.startsWith("\t") ? l.slice(1) : l.replace(spaceRe, "")
          const d = nextL.length - l.length
          if (idx === 0) firstDelta = d
          totalDelta += d
          return nextL
        }
        if (idx === 0) firstDelta = unit.length
        totalDelta += unit.length
        return unit + l
      })
      const next = value.slice(0, lineStart) + updated.join("\n") + value.slice(blockEnd)
      setDraft(next)
      draftRef.current = next
      const ns = Math.max(lineStart, start + firstDelta)
      const ne = Math.max(ns, end + totalDelta)
      requestAnimationFrame(() => el.setSelectionRange(ns, ne))
      return
    }

    // Ctrl+K — insert link around the selection (obsidian)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
      e.preventDefault()
      insertLinkAtSelection(el)
      return
    }

    // Ctrl+A — select all text in the note (merges multi-block body into active editor if needed)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "a") {
      const nonFmBlocks = blocks.filter((b) => b.type !== "frontmatter")
      if (nonFmBlocks.length > 1) {
        e.preventDefault()
        const fm = blocks.find((b) => b.type === "frontmatter")
        const fullBody = serializeBlocks(nonFmBlocks).replace(/\n$/, "")
        setDraft(fullBody)
        draftRef.current = fullBody
        const activeBlock = blocks[blockIdx]
        const unifiedBlock: Block = {
          id: activeBlock ? activeBlock.id : "unified-body",
          type: "paragraph",
          text: fullBody,
        }
        const updated = fm ? [fm, unifiedBlock] : [unifiedBlock]
        blocksRef.current = updated
        requestAnimationFrame(() => {
          const tael = textareaRef.current
          if (tael) {
            tael.value = fullBody
            tael.focus()
            tael.setSelectionRange(0, fullBody.length)
          }
        })
        return
      }
    }

    const atStart = caret === 0 && el.selectionEnd === 0
    const firstLine = value.slice(0, caret).indexOf("\n") === -1
    const lastLine = value.slice(caret).indexOf("\n") === -1

    if (e.key === "ArrowUp" && firstLine && !suggest.kind) {
      const hasPrevEditable = blocks.slice(0, blockIdx).some((b) => b.type !== "frontmatter")
      if (!hasPrevEditable) return
      e.preventDefault()
      commitDraft(null)
      editBlockAtIndex(blockIdx - 1, "end")
      return
    }
    if (e.key === "ArrowDown" && lastLine && !suggest.kind) {
      if (blockIdx + 1 >= blocks.length) return
      e.preventDefault()
      commitDraft(null)
      editBlockAtIndex(blockIdx + 1, "start")
      return
    }
    if (e.key === "Backspace" && atStart) {
      if (isVirtualId(editingId) && value.trim() === "") {
        e.preventDefault()
        setPendingEmptyAfter(null)
        editingRef.current = null
        setEditingId(null)
        const real = blocks.filter((b) => !isVirtualId(b.id))
        const prev = real[Math.min(blockIdx - 1, real.length - 1)]
        if (prev && prev.type !== "frontmatter") requestAnimationFrame(() => startEdit(prev, "end"))
        return
      }
      if (value === "") {
        e.preventDefault()
        const nextBlocks = blocks.filter((_, i) => i !== blockIdx)
        const next = commitBlocks(nextBlocks)
        if (next !== null) onChange(next)
        editingRef.current = null
        setEditingId(null)
        const prev = nextBlocks[Math.max(0, blockIdx - 1)]
        if (prev && prev.type !== "frontmatter") requestAnimationFrame(() => startEdit(prev, "end"))
        return
      }
      let pi = blockIdx - 1
      while (pi >= 0 && blocks[pi].type === "frontmatter") pi--
      const prevBlock = pi >= 0 ? blocks[pi] : null
      if (prevBlock && prevBlock.type === "hr") {
        e.preventDefault()
        const nextBlocks = blocks.filter((_, i) => i !== pi)
        const next = commitBlocks(nextBlocks)
        if (next !== null) onChange(next)
        return
      }
      if (prevBlock && prevBlock.type !== "code" && prevBlock.type !== "table" && prevBlock.type !== "math" && !isVirtualId(prevBlock.id)) {
        e.preventDefault()
        const prevText = prevBlock.text
        const merged = prevText + preserveLineEndings(prevText, value)
        const nextBlocks = blocks
          .filter((_, i) => i !== blockIdx)
          .map((b) => (b.id === prevBlock.id ? { ...b, text: merged } : b))
        const next = commitBlocks(nextBlocks)
        if (next !== null) {
          onChange(next)
          const reparsed = parseBlocks(next)
          const target = reparsed[pi]
          editingRef.current = target?.id ?? prevBlock.id
          setEditingId(target?.id ?? prevBlock.id)
          setDraft(target ? toDraft(target.text) : merged)
          const caretAt = toDraft(prevText).length
          requestAnimationFrame(() => {
            const tael = textareaRef.current
            if (tael) {
              tael.focus()
              tael.setSelectionRange(caretAt, caretAt)
            }
          })
        }
        return
      }
    }

    // Enter — list continuation, empty marker exit, blank line creation, or block split
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const block = blocks[blockIdx]
      if (block) {
        if (block.type === "code" || block.type === "table" || block.type === "math") {
          // multi-line raw editing — keep default newline
          return
        }

        const lineStart = value.lastIndexOf("\n", caret - 1) + 1
        const nlIdx = value.indexOf("\n", lineStart)
        const lineEnd = nlIdx === -1 ? value.length : nlIdx
        const line = value.slice(lineStart, lineEnd)

        // 1. Exit when Enter pressed on an empty list / quote marker line
        if (/^\s*(?:[-*+]|\d+[.)]|>)(?:\s+\[[ xX/-]\])?[ \t]*$/.test(line) && caret === lineEnd) {
          e.preventDefault()
          const next = value.slice(0, lineStart) + value.slice(lineEnd)
          setDraft(next)
          draftRef.current = next
          requestAnimationFrame(() => {
            const tael = textareaRef.current
            if (tael) {
              tael.focus()
              tael.setSelectionRange(lineStart, lineStart)
            }
          })
          return
        }

        // 2. Continue list marker (bullet, numbered, todo) or blockquote on Enter
        const lm = line.match(/^(\s*)([-*+]|\d+[.)])\s+(\[[ xX/-]\]\s+)?/)
        const qm = line.match(/^(\s*)>\s?/)
        const prefixLen = lm ? lm[0].length : qm ? qm[0].length : 0
        const marker = lm
          ? lm[1] + (/^\d/.test(lm[2]) ? `${parseInt(lm[2], 10) + 1}${lm[2].replace(/^\d+/, "")}` : lm[2]) + " " + (lm[3] ? "[ ] " : "")
          : qm
            ? `${qm[1]}> `
            : null
        if (marker && caret >= lineStart + prefixLen) {
          e.preventDefault()
          const insert = "\n" + marker
          const next = value.slice(0, el.selectionEnd) + insert + value.slice(el.selectionEnd)
          setDraft(next)
          draftRef.current = next
          const pos = el.selectionEnd + insert.length
          requestAnimationFrame(() => {
            const tael = textareaRef.current
            if (tael) {
              tael.focus()
              tael.setSelectionRange(pos, pos)
            }
          })
          return
        }

        // 3. Regular Enter: insert newline in draft without unmounting or jumping cursor
        e.preventDefault()
        const next = value.slice(0, caret) + "\n" + value.slice(el.selectionEnd)
        setDraft(next)
        draftRef.current = next
        const pos = caret + 1
        requestAnimationFrame(() => {
          const tael = textareaRef.current
          if (tael) {
            tael.focus()
            tael.setSelectionRange(pos, pos)
          }
        })
        return
      }
    }

    // Ctrl+D — delete active line (or empty single-line block)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault()
      const lineStart = value.lastIndexOf("\n", caret - 1) + 1
      const nlIdx = value.indexOf("\n", el.selectionEnd)
      if (lineStart === 0 && nlIdx === -1) {
        if (isVirtualId(editingId)) {
          setPendingEmptyAfter(null)
          editingRef.current = null
          setEditingId(null)
          return
        }
        const nextBlocks = blocks.filter((_, i) => i !== blockIdx)
        const next = commitBlocks(nextBlocks)
        if (next !== null) onChange(next)
        editingRef.current = null
        setEditingId(null)
        const fallback = nextBlocks[Math.min(blockIdx, nextBlocks.length - 1)]
        if (fallback && fallback.type !== "frontmatter") requestAnimationFrame(() => startEdit(fallback, "start"))
        return
      }
      const removeStart = lineStart > 0 && nlIdx === -1 ? lineStart - 1 : lineStart
      const removeEnd = nlIdx === -1 ? value.length : nlIdx + 1
      const next = value.slice(0, removeStart) + value.slice(removeEnd)
      setDraft(next)
      draftRef.current = next
      const pos = Math.min(removeStart, next.length)
      requestAnimationFrame(() => el.setSelectionRange(pos, pos))
      return
    }

    // Ctrl+L toggle / cycle checkbox on current line
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "l") {
      e.preventDefault()
      const lineStart = value.lastIndexOf("\n", caret - 1) + 1
      const lineEnd = value.indexOf("\n", lineStart)
      const endPos = lineEnd === -1 ? value.length : lineEnd
      const line = value.slice(lineStart, endPos)
      const taskMatch = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX/-])(\]\s*)/)
      const bulletMatch = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/)
      let nextLine: string
      let delta = 0
      if (taskMatch) {
        const checked = taskMatch[2] !== " "
        nextLine = line.replace(/\[([ xX/-])\]/, checked ? "[ ]" : "[x]")
      } else if (bulletMatch) {
        nextLine = `${bulletMatch[1]}[ ] ${bulletMatch[2]}`
        delta = 4
      } else {
        const lead = line.match(/^(\s*)/)?.[1] ?? ""
        nextLine = `${lead}- [ ] ${line.slice(lead.length)}`
        delta = 6
      }
      const next = value.slice(0, lineStart) + nextLine + value.slice(endPos)
      setDraft(next)
      draftRef.current = next
      const pos = Math.max(lineStart, caret + delta)
      requestAnimationFrame(() => el.setSelectionRange(pos, pos))
      return
    }
    void onExtractBlock
  }

  // ── suggest detection on caret move / typing ──────────────────────────────

  const updateSuggest = () => {
    const el = textareaRef.current
    if (!el) return
    const state = detectSuggest(el.value, el.selectionStart)
    setSuggest((prev) => {
      if (prev.kind !== state.kind || prev.query !== state.query) setSuggestSel(0)
      return state
    })
    const lineStart = el.value.lastIndexOf("\n", el.selectionStart - 1) + 1
    const nlIdx = el.value.indexOf("\n", lineStart)
    const lineEnd = nlIdx === -1 ? el.value.length : nlIdx
    const line = el.value.slice(lineStart, lineEnd)
    const sq = extractSlashQuery(line)
    if (sq && el.selectionStart >= lineEnd) {
      setSlash((prev) => {
        if (prev?.query !== sq.query || prev?.lineStart !== lineStart) setSlashSel(0)
        return { query: sq.query, lineStart }
      })
    } else if (slash !== null) {
      setSlash(null)
    }
    if (state.kind || (sq && el.selectionStart >= lineEnd)) {
      setCaretPos(getCaretViewportPos(el, el.selectionStart))
    }
  }

  /** Apply a slash-command item to the active line. */
  const acceptSlash = (item: { apply: () => { text: string; caret: number } }) => {
    const el = textareaRef.current
    const curVal = el?.value ?? draftRef.current
    const lineStart = slash?.lineStart ?? 0
    const nlIdx = curVal.indexOf("\n", lineStart)
    const lineEnd = nlIdx === -1 ? curVal.length : nlIdx
    const { text, caret } = item.apply()
    const next = curVal.slice(0, lineStart) + text + curVal.slice(lineEnd)
    setDraft(next)
    draftRef.current = next
    setSlash(null)
    const pos = lineStart + caret
    requestAnimationFrame(() => {
      const tael = el ?? textareaRef.current
      if (tael) {
        tael.focus()
        tael.setSelectionRange(pos, pos)
      }
    })
  }

  /** Ctrl+K — wikilink or markdown link around the selection. */
  const insertLinkAtSelection = (el: HTMLTextAreaElement) => {
    const value = el.value
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end)
    const useWikilinks = useWorkspace.getState().settings.files.useWikilinks
    let next: string
    let pos: number
    if (useWikilinks) {
      next = value.slice(0, start) + `[[${selected}]]` + value.slice(end)
      pos = selected ? start + 2 + selected.length : start + 2
    } else {
      next = value.slice(0, start) + `[${selected}]()` + value.slice(end)
      pos = start + selected.length + 3
    }
    setDraft(next)
    draftRef.current = next
    requestAnimationFrame(() => {
      const tael = textareaRef.current
      if (tael) {
        tael.focus()
        tael.setSelectionRange(pos, pos)
      }
      updateSuggest()
    })
  }

  const insertSavedFiles = (files: File[], at: number) => {
    const activeId = editingRef.current
    void (async () => {
      try {
        const embeds = await savePastedFiles(files, noteFolderId ?? null)
        if (embeds.length === 0) return
        const insert = embeds.map((n) => `![[${n}]]`).join(" ") + " "
        const liveDraft = textareaRef.current?.value ?? draftRef.current
        const safeAt = Math.min(at, liveDraft.length)
        const next = liveDraft.slice(0, safeAt) + insert + liveDraft.slice(safeAt)
        setDraft(next)
        draftRef.current = next
        const bs = blocksRef.current
        const curBlock = bs.find((b) => b.id === activeId)
        const nextBlocks = bs.map((b) =>
          b.id === activeId ? { ...b, text: curBlock ? preserveLineEndings(curBlock.text, next) : next } : b,
        )
        const committed = commitBlocks(nextBlocks)
        if (committed !== null) onChangeRef.current(committed)
        requestAnimationFrame(() => {
          const tael = textareaRef.current
          if (tael) {
            tael.focus()
            tael.setSelectionRange(safeAt + insert.length, safeAt + insert.length)
          }
        })
      } catch (err) {
        toast(String((err as Error).message ?? err))
      }
    })()
  }

  /** Paste images/files → save into the vault, insert ![[name]] embeds. */
  const onPasteFiles = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files ?? [])
    if (files.length === 0) return
    e.preventDefault()
    insertSavedFiles(files, e.currentTarget.selectionStart)
  }

  /** Drag & drop files → same as paste. */
  const onDropFiles = (e: React.DragEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length === 0) return
    e.preventDefault()
    insertSavedFiles(files, e.currentTarget.selectionStart)
  }

  const acceptSuggest = (value: string, isTag: boolean) => {
    const el = textareaRef.current
    if (!el) return
    const before = el.value.slice(0, el.selectionStart)
    let after = el.value.slice(el.selectionStart)
    let newBefore: string
    if (isTag) {
      newBefore = before.replace(/([^\S\n]*)(#[^\s#]*)$/, (_m, ws) => `${ws}#${value} `)
    } else {
      const useWikilinks = useWorkspace.getState().settings.files.useWikilinks
      if (after.startsWith("]]")) after = after.slice(2)
      const replacement = useWikilinks ? `[[${value}]]` : `[${value}](${encodeURIComponent(value)}.md)`
      newBefore = before.replace(/\[\[([^\]\n[]*)$/, replacement)
    }
    const next = newBefore + after
    setDraft(next)
    draftRef.current = next
    setSuggest({ kind: null, query: "" })
    const pos = newBefore.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  // task offset for this note
  const taskOffsets = useMemo(() => {
    let acc = 0
    const offsets: number[] = []
    for (const b of blocks) {
      offsets.push(acc)
      acc += countTasks(b.text)
    }
    return offsets
  }, [blocks])

  // ── right-click on a rendered block: link/image menus, or the full editor
  //    menu after focusing the block (exactly obsidian's live preview) ────────
  const handleBlockContextMenu = (e: React.MouseEvent, block: Block) => {
    e.preventDefault()
    const target = e.target as HTMLElement
    const link = target.closest("a.internal-link, a.internal-embed-chip") as HTMLElement | null
    if (link) {
      showMenuAt(e, linkMenuItems({ kind: "internal", target: link.dataset.href ?? "", subpath: link.dataset.subpath || null }))
      return
    }
    const ext = target.closest("a") as HTMLAnchorElement | null
    if (ext && /^https?:\/\//i.test(ext.getAttribute("href") ?? "")) {
      showMenuAt(e, linkMenuItems({ kind: "external", target: ext.getAttribute("href")!, subpath: null }))
      return
    }
    const img = target.closest("img[data-vault-file]") as HTMLImageElement | null
    if (img?.dataset.vaultFile) {
      const fid = img.dataset.vaultFile
      const ws = useWorkspace.getState()
      showMenuAt(e, [
        { label: "Open in new tab", onClick: () => ws.openAttachment(fid, { newTab: true }) },
        {
          label: "Open with default app",
          onClick: () =>
            void api.openWithDefaultApp(ws.vaultId!, fid).then((r) => {
              if (r === "unavailable") toast("Opening with the default app requires the desktop edition")
            }),
        },
        {
          label: "Reveal in system explorer",
          onClick: () =>
            void api.revealItem(ws.vaultId!, fid).then((r) => {
              if (r === "unavailable") toast("Revealing files requires the desktop edition")
            }),
        },
      ])
      return
    }
    // plain text: focus the block for editing (obsidian moves the caret to the
    // clicked spot), then show the editor menu bound to the new textarea
    if (isVirtualId(block.id) || block.type === "frontmatter") return
    startEdit(block, "end")
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta) openEditorContextMenu(e, ta)
    })
  }

  const focusLastBlock = () => {
    let last = blocks[blocks.length - 1]
    if (!last || last.type === "frontmatter") {
      last = [...blocks].reverse().find((b) => b.type !== "frontmatter") ?? last
    }
    if (last) startEdit(last, "end")
  }
  if (focusEndRef) focusEndRef.current = focusLastBlock

  return (
    <div
      className="obs-block-editor flex-1"
      style={{ paddingBottom: "40vh" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          focusLastBlock()
        }
      }}
    >
      {blocks.map((block, i) => {
        if (block.id === editingId) {
          const cls =
            block.type === "code" || block.type === "math"
              ? "obs-block-textarea"
              : block.type === "heading"
                ? `obs-block-textarea obs-h${block.headingLevel}-input`
                : "obs-block-textarea"
          return (
            <div
              key={block.id}
              ref={activeRef}
              className="obs-block is-editing"
              data-block-index={i}
              data-block-type={block.type}
              data-block-ref={block.blockRefId}
              data-heading-index={block.headingIndex}
            >
              <textarea
                ref={textareaRef}
                className={cls}
                value={draft}
                spellCheck={spellcheck}
                onChange={(e) => {
                  setDraft(e.target.value)
                  draftRef.current = e.target.value
                  updateSuggest()
                }}
                onKeyDown={(e) => handleKeyDown(e, i)}
                onKeyUp={updateSuggest}
                onClick={updateSuggest}
                onPaste={onPasteFiles}
                onDrop={onDropFiles}
                onContextMenu={(e) => openEditorContextMenu(e, e.currentTarget, { onExtractSelection })}
                onBlur={(e) => {
                  const rel = e.relatedTarget as HTMLElement | null
                  if (rel?.closest(".obs-suggest")) return
                  clearBlurTimer()
                  blurTimerRef.current = window.setTimeout(() => {
                    blurTimerRef.current = null
                    if (window.__obsMenuActive) return
                    if (document.activeElement?.closest(".obs-suggest")) return
                    if (editingRef.current === block.id) commitDraftRef.current(block.id)
                  }, 120)
                }}
                style={
                  block.type === "code" || block.type === "math"
                    ? { fontFamily: "var(--font-mono)", fontSize: "0.86em", lineHeight: 1.5, background: "var(--code-background)", borderRadius: 8, padding: "14px 16px", border: "1px solid var(--code-border)" }
                    : block.type === "heading"
                      ? { fontWeight: 700, fontSize: `${[1.875, 1.5, 1.25, 1.125, 1, 1][(block.headingLevel ?? 1) - 1]}em`, lineHeight: 1.35, letterSpacing: "-0.015em" }
                      : undefined
                }
              />
            </div>
          )
        }
        return (
          <RenderedBlock
            key={block.id}
            block={block}
            blockIndex={i}
            index={index ?? []}
            attachOpts={attachOpts}
            onOpenEdit={(caret) => startEdit(block, caret)}
            onToggleTask={onToggleTask ? (n) => onToggleTask(taskOffsets[i] + n) : undefined}
            onContextMenuBlock={(e) => {
              const target = e.target as HTMLElement
              if (
                target.closest("a.internal-link, a.internal-embed-chip, a, img[data-vault-file]") ||
                isVirtualId(block.id) ||
                block.type === "frontmatter"
              ) {
                handleBlockContextMenu(e, block)
                return
              }
              e.preventDefault()
              const offset = estimateOffsetFromClick(e.currentTarget as HTMLElement, e.clientX, e.clientY, toDraft(block.text))
              startEdit(block, offset)
              requestAnimationFrame(() => {
                const ta = textareaRef.current
                if (ta) openEditorContextMenu(e, ta, { onExtractSelection })
              })
            }}
          />
        )
      })}
      {suggest.kind && (
        <AutocompletePopup
          state={suggest}
          items={suggestItems}
          selected={suggestSel}
          onSelect={acceptSuggest}
          anchorRef={activeRef}
          caretPos={caretPos}
          onHoverIndex={setSuggestSel}
        />
      )}
      {slash !== null && (caretPos || activeRef.current) && (
        <SlashMenu
          items={slashItems}
          selected={slashSel}
          onSelect={acceptSlash}
          onHover={setSlashSel}
          top={(caretPos?.bottom ?? activeRef.current!.getBoundingClientRect().bottom) + 4}
          left={caretPos?.left ?? activeRef.current!.getBoundingClientRect().left}
        />
      )}
    </div>
  )
})

// ─── One rendered (non-editing) block ────────────────────────────────────────

const RenderedBlock = memo(function RenderedBlock({
  block,
  blockIndex,
  index,
  attachOpts,
  onOpenEdit,
  onToggleTask,
  onContextMenuBlock,
}: {
  block: Block
  blockIndex: number
  index: IndexEntry[]
  attachOpts: { files?: import("@/lib/obsidian/types").VaultFileMeta[]; resolveAttachmentUrl?: (file: import("@/lib/obsidian/types").VaultFileMeta) => string | null }
  onOpenEdit: (caret: "start" | "end" | number) => void
  onToggleTask?: (n: number) => void
  onContextMenuBlock?: (e: React.MouseEvent) => void
}) {
  const result = useMemo<RenderResult | null>(() => {
    if (block.type === "frontmatter") return null
    return renderMarkdown(block.text, { index, ...attachOpts })
  }, [block.text, index, attachOpts, block.type])
  const blankLineCount = useMemo(() => {
    if (!block.gapBefore) return 0
    const count = (block.gapBefore.match(/\n/g) || []).length
    return Math.max(0, count - 1)
  }, [block.gapBefore])
  const leadingBlankLines = useMemo(() => {
    if (!block.text) return 0
    const m = block.text.match(/^\n+/)
    return m ? m[0].length : 0
  }, [block.text])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.querySelectorAll<HTMLElement>(".obs-callout[data-callout-fold='-']").forEach((c) => {
      if (!c.dataset.userToggled) c.dataset.collapsed = "true"
    })
  }, [result])

  if (block.type === "frontmatter") return null

  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (
      target.closest('input[type="checkbox"]') ||
      target.closest(".obs-callout[data-callout-fold] .obs-callout-title") ||
      target.closest("a") ||
      target.closest("button") ||
      target.closest(".obs-embed-title")
    ) {
      return
    }
    const offset = estimateOffsetFromClick(ref.current, e.clientX, e.clientY, toDraft(block.text))
    onOpenEdit(offset)
  }

  return (
    <div
      ref={ref}
      className="obs-block group relative"
      data-block-index={blockIndex}
      data-block-type={block.type}
      data-block-ref={block.blockRefId}
      data-heading-index={block.headingIndex}
      style={blankLineCount + leadingBlankLines > 0 ? { marginTop: `${(blankLineCount + leadingBlankLines) * 1.5}em` } : undefined}
      onClick={handleClick}
      onContextMenu={(e) => onContextMenuBlock?.(e)}
      title=""
    >
      <MarkdownBody result={result ?? { segments: [{ kind: "html", html: "" }], headings: [], taskCount: 0 }} index={index} onToggleTask={onToggleTask} />
    </div>
  )
})
