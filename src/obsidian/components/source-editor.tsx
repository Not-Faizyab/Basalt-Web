"use client"

// ─── Source mode: raw markdown textarea with autocomplete + slash + paste ─────
import { memo, useEffect, useRef, useState } from "react"
import { AutocompletePopup, detectSuggest, getCaretViewportPos, useSuggestItems, type CaretViewportPos, type SuggestState } from "./autocomplete"
import { SlashMenu, extractSlashQuery, filterSlashItems } from "./slash-menu"
import { openEditorContextMenu } from "./context-menu"
import { extractOutline } from "@/lib/obsidian/blocks"
import { savePastedFiles } from "../paste-attachment"
import { useWorkspace } from "../stores/workspace"
import { toast } from "sonner"

export const SourceEditor = memo(function SourceEditor({
  noteId,
  content,
  onChange,
  findFocusRequest,
  noteFolderId,
  focusEndRef,
}: {
  noteId?: string
  content: string
  onChange: (next: string) => void
  findFocusRequest?: { start: number; end: number; nonce: number } | null
  noteFolderId?: string | null
  focusEndRef?: React.MutableRefObject<(() => void) | null>
}) {
  const [suggest, setSuggest] = useState<SuggestState>({ kind: null, query: "" })
  const [suggestSel, setSuggestSel] = useState(0)
  const suggestItems = useSuggestItems(suggest)
  const [slash, setSlash] = useState<{ query: string; lineStart: number; prefix: string } | null>(null)
  const [slashSel, setSlashSel] = useState(0)
  const [caretPos, setCaretPos] = useState<CaretViewportPos | null>(null)
  const slashItems = filterSlashItems(slash?.query ?? "")
  const spellcheck = useWorkspace((s) => s.settings.editor.spellcheck)
  const indentWithTabs = useWorkspace((s) => s.settings.editor.indentWithTabs)
  const tabSize = useWorkspace((s) => s.settings.editor.tabSize)
  const ref = useRef<HTMLTextAreaElement>(null)
  const lastFindNonce = useRef(0)

  const commitValue = (next: string, caretStart: number, caretEnd = caretStart) => {
    onChange(next)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(caretStart, caretEnd)
    })
  }

  useEffect(() => {
    if (!findFocusRequest || findFocusRequest.nonce === lastFindNonce.current) return
    lastFindNonce.current = findFocusRequest.nonce
    const el = ref.current
    if (el) {
      el.focus()
      el.setSelectionRange(findFocusRequest.start, findFocusRequest.end)
      const before = el.value.slice(0, findFocusRequest.start)
      const lineIdx = before.split("\n").length - 1
      const totalLines = Math.max(1, el.value.split("\n").length)
      const scroller = el.closest(".obs-editor-scroll") as HTMLElement | null
      if (scroller) {
        scroller.scrollTop = Math.max(0, (lineIdx / totalLines) * scroller.scrollHeight - scroller.clientHeight / 2)
      }
    }
  }, [findFocusRequest])

  // Outline & block-ref jump support in Source mode
  useEffect(() => {
    if (!noteId) return
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { noteId: string; subpath: string; index?: number }
      if (!detail || detail.noteId !== noteId) return
      const el = ref.current
      if (!el) return
      const text = el.value
      let targetOffset = -1
      if (detail.subpath.startsWith("#^")) {
        const refId = detail.subpath.slice(2)
        const m = new RegExp(`(?:^|\\s)\\^${refId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "m").exec(text)
        if (m) targetOffset = m.index
      } else if (detail.subpath.startsWith("#")) {
        const outline = extractOutline(text)
        const parts = detail.subpath.slice(1).split("#").filter(Boolean)
        const wanted = (parts[parts.length - 1] ?? "").toLowerCase()
        const norm = (s: string) => s.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-")
        const targetItem =
          typeof detail.index === "number" && outline[detail.index]
            ? outline[detail.index]
            : outline.find((h) => h.text.toLowerCase() === wanted) ?? outline.find((h) => norm(h.text) === norm(wanted))
        if (targetItem) {
          const lines = text.split("\n")
          let seen = 0
          let pos = 0
          let inFence = false
          let fenceChar = ""
          let fenceLen = 0
          for (const line of lines) {
            if (inFence) {
              const close = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/)
              if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) inFence = false
            } else {
              const fm = line.match(/^ {0,3}(`{3,}|~{3,})([^\n\r]*)\r?$/)
              if (fm && !(fm[1][0] === "`" && fm[2].includes("`"))) {
                inFence = true
                fenceChar = fm[1][0]
                fenceLen = fm[1].length
              } else if (/^#{1,6}[ \t]+\S/.test(line)) {
                if (seen === targetItem.index) {
                  targetOffset = pos
                  break
                }
                seen++
              }
            }
            pos += line.length + 1
          }
        }
      }
      if (targetOffset >= 0) {
        el.focus()
        el.setSelectionRange(targetOffset, targetOffset)
        const lineIdx = text.slice(0, targetOffset).split("\n").length - 1
        const totalLines = Math.max(1, text.split("\n").length)
        const scroller = el.closest(".obs-editor-scroll") as HTMLElement | null
        if (scroller) {
          scroller.scrollTop = Math.max(0, (lineIdx / totalLines) * scroller.scrollHeight - 80)
        }
      }
    }
    window.addEventListener("obs-scroll-to", handler)
    return () => window.removeEventListener("obs-scroll-to", handler)
  }, [noteId])

  const updateSuggest = () => {
    const el = ref.current
    if (!el) return
    const state = detectSuggest(el.value, el.selectionStart)
    setSuggest((prev) => {
      if (prev.kind !== state.kind || prev.query !== state.query) setSuggestSel(0)
      return state
    })
    const lineStart = el.value.lastIndexOf("\n", el.selectionStart - 1) + 1
    const nlIdx = el.value.indexOf("\n", lineStart)
    const line = el.value.slice(lineStart, nlIdx === -1 ? undefined : nlIdx)
    const sq = extractSlashQuery(line)
    if (sq && el.selectionStart >= lineStart + line.length) {
      setSlash((prev) => {
        if (prev?.query !== sq.query || prev?.lineStart !== lineStart) setSlashSel(0)
        return { query: sq.query, lineStart, prefix: sq.prefix }
      })
    } else if (slash !== null) {
      setSlash(null)
    }
    if (state.kind || (sq && el.selectionStart >= lineStart + line.length)) {
      setCaretPos(getCaretViewportPos(el, el.selectionStart))
    }
  }

  /** Apply a slash item to the line that contains "/query". */
  const acceptSlash = (item: { apply: () => { text: string; caret: number } }) => {
    const el = ref.current
    if (!el || !slash) return
    const cur = el.value
    const { lineStart } = slash
    const nlIdx = cur.indexOf("\n", lineStart)
    const lineEnd = nlIdx === -1 ? cur.length : nlIdx
    const { text, caret } = item.apply()
    const next = cur.slice(0, lineStart) + text + cur.slice(lineEnd)
    setSlash(null)
    commitValue(next, lineStart + caret)
  }

  const acceptSuggest = (value: string, isTag: boolean) => {
    const el = ref.current
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
    setSuggest({ kind: null, query: "" })
    commitValue(newBefore + after, newBefore.length)
  }

  const onPasteFiles = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files ?? [])
    if (files.length === 0) return
    e.preventDefault()
    const el = e.currentTarget
    const at = el.selectionStart
    void (async () => {
      try {
        const embeds = await savePastedFiles(files, noteFolderId ?? null)
        if (embeds.length === 0) return
        const insert = embeds.map((n) => `![[${n}]]`).join(" ") + " "
        const liveVal = ref.current?.value ?? el.value
        const safeAt = Math.min(at, liveVal.length)
        const next = liveVal.slice(0, safeAt) + insert + liveVal.slice(safeAt)
        commitValue(next, safeAt + insert.length)
      } catch (err) {
        toast(String((err as Error).message ?? err))
      }
    })()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
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

    // Tab / Shift+Tab — indent or outdent without leaving the editor
    if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      const value = el.value
      const unit = indentWithTabs ? "\t" : " ".repeat(Math.max(1, tabSize))
      const start = el.selectionStart
      const end = el.selectionEnd
      if (!e.shiftKey && start === end && !value.slice(value.lastIndexOf("\n", start - 1) + 1, start).match(/^\s*([-*+]|\d+[.)])/)) {
        const next = value.slice(0, start) + unit + value.slice(end)
        commitValue(next, start + unit.length)
        return
      }
      const lineStart = value.lastIndexOf("\n", start - 1) + 1
      const nlAfterEnd = value.indexOf("\n", Math.max(start, end > start && value[end - 1] === "\n" ? end - 1 : end))
      const blockEnd = nlAfterEnd === -1 ? value.length : nlAfterEnd
      const slice = value.slice(lineStart, blockEnd)
      const lines = slice.split("\n")
      const spaceRe = new RegExp(`^ {1,${Math.max(1, tabSize)}}`)
      let firstDelta = 0
      let totalDelta = 0
      const updated = lines.map((l, idx) => {
        if (e.shiftKey) {
          let nextL = l
          if (l.startsWith("\t")) nextL = l.slice(1)
          else nextL = l.replace(spaceRe, "")
          const d = nextL.length - l.length
          if (idx === 0) firstDelta = d
          totalDelta += d
          return nextL
        } else {
          if (idx === 0) firstDelta = unit.length
          totalDelta += unit.length
          return unit + l
        }
      })
      const next = value.slice(0, lineStart) + updated.join("\n") + value.slice(blockEnd)
      const nextStart = Math.max(lineStart, start + firstDelta)
      const nextEnd = Math.max(nextStart, end + totalDelta)
      commitValue(next, nextStart, nextEnd)
      return
    }

    // Enter — continue or exit list / task / blockquote marker
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const value = el.value
      const caret = el.selectionStart
      if (caret === el.selectionEnd) {
        const lineStart = value.lastIndexOf("\n", caret - 1) + 1
        const nlIdx = value.indexOf("\n", lineStart)
        const lineEnd = nlIdx === -1 ? value.length : nlIdx
        const line = value.slice(lineStart, lineEnd)
        if (/^\s*(?:[-*+]|\d+[.)]|>)(?:\s+\[[ xX/-]\])?[ \t]*$/.test(line) && caret === lineEnd) {
          e.preventDefault()
          const next = value.slice(0, lineStart) + value.slice(lineEnd)
          commitValue(next, lineStart)
          return
        }
        const lm = line.match(/^(\s*)([-*+]|\d+[.)])\s+(\[[ xX/-]\]\s+)?/)
        const qm = line.match(/^(\s*)>\s?/)
        const prefixLen = lm ? lm[0].length : qm ? qm[0].length : 0
        if (prefixLen > 0 && caret >= lineStart + prefixLen) {
          e.preventDefault()
          const marker = lm
            ? lm[1] + (/^\d/.test(lm[2]) ? `${parseInt(lm[2], 10) + 1}${lm[2].replace(/^\d+/, "")}` : lm[2]) + " " + (lm[3] ? "[ ] " : "")
            : `${qm![1]}> `
          const insert = "\n" + marker
          const next = value.slice(0, caret) + insert + value.slice(caret)
          commitValue(next, caret + insert.length)
          return
        }
      }
    }

    // Ctrl+K — insert link around the selection and open autocomplete
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
      e.preventDefault()
      const value = el.value
      const start = el.selectionStart
      const end = el.selectionEnd
      const selected = value.slice(start, end)
      const useWikilinks = useWorkspace.getState().settings.files.useWikilinks
      let next: string
      let caretPosIdx: number
      if (useWikilinks) {
        next = value.slice(0, start) + `[[${selected}]]` + value.slice(end)
        caretPosIdx = selected ? start + 2 + selected.length : start + 2
      } else {
        next = value.slice(0, start) + `[${selected}]()` + value.slice(end)
        caretPosIdx = start + selected.length + 3
      }
      onChange(next)
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(caretPosIdx, caretPosIdx)
        updateSuggest()
      })
      return
    }

    // Ctrl+D — delete current line
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault()
      const value = el.value
      const lineStart = value.lastIndexOf("\n", el.selectionStart - 1) + 1
      const nlIdx = value.indexOf("\n", el.selectionEnd)
      const removeStart = lineStart > 0 && nlIdx === -1 ? lineStart - 1 : lineStart
      const removeEnd = nlIdx === -1 ? value.length : nlIdx + 1
      const next = value.slice(0, removeStart) + value.slice(removeEnd)
      commitValue(next, Math.min(removeStart, next.length))
      return
    }

    // Ctrl+L — toggle or cycle task checkbox on current line
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "l") {
      e.preventDefault()
      const value = el.value
      const caret = el.selectionStart
      const lineStart = value.lastIndexOf("\n", caret - 1) + 1
      const lineEnd = value.indexOf("\n", lineStart)
      const endPos = lineEnd === -1 ? value.length : lineEnd
      const line = value.slice(lineStart, endPos)
      const taskMatch = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX/-])(\]\s*)/)
      const bulletMatch = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/)
      let nextLine: string
      let caretDelta = 0
      if (taskMatch) {
        const checked = taskMatch[2] !== " "
        nextLine = line.replace(/\[([ xX/-])\]/, checked ? "[ ]" : "[x]")
      } else if (bulletMatch) {
        nextLine = `${bulletMatch[1]}[ ] ${bulletMatch[2]}`
        caretDelta = 4
      } else {
        const lead = line.match(/^(\s*)/)?.[1] ?? ""
        nextLine = `${lead}- [ ] ${line.slice(lead.length)}`
        caretDelta = 6
      }
      const next = value.slice(0, lineStart) + nextLine + value.slice(endPos)
      commitValue(next, Math.max(lineStart, caret + caretDelta))
      return
    }
  }

  if (focusEndRef) {
    focusEndRef.current = () => {
      const el = ref.current
      if (!el) return
      el.focus()
      const end = el.value.length
      el.setSelectionRange(end, end)
    }
  }

  return (
    <div className="relative flex flex-1 flex-col">
      <textarea
        ref={ref}
        className="obs-block-textarea flex-1"
        style={{ padding: "4px 0 40vh", minHeight: "100%", lineHeight: 1.55, whiteSpace: "pre-wrap" }}
        value={content}
        spellCheck={spellcheck}
        onChange={(e) => {
          onChange(e.target.value)
          updateSuggest()
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={updateSuggest}
        onClick={updateSuggest}
        onPaste={onPasteFiles}
        onContextMenu={(e) => openEditorContextMenu(e, e.currentTarget)}
      />
      {suggest.kind && (
        <AutocompletePopup
          state={suggest}
          items={suggestItems}
          selected={suggestSel}
          onSelect={acceptSuggest}
          anchorRef={ref}
          caretPos={caretPos}
          onHoverIndex={setSuggestSel}
        />
      )}
      {slash !== null && ref.current && (
        <SlashMenu
          items={slashItems}
          selected={slashSel}
          onSelect={acceptSlash}
          onHover={setSlashSel}
          top={(caretPos?.bottom ?? ref.current.getBoundingClientRect().top + 22) + 4}
          left={caretPos?.left ?? ref.current.getBoundingClientRect().left}
        />
      )}
    </div>
  )
})
