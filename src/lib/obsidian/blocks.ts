// ─── Block parser: splits markdown into edit/render blocks for Live Preview ──
import { parseFrontmatter } from "./frontmatter"

export type BlockType =
  | "frontmatter"
  | "heading"
  | "paragraph"
  | "list"
  | "code"
  | "math"
  | "quote"
  | "callout"
  | "hr"
  | "table"
  | "html"

export interface Block {
  id: string
  type: BlockType
  text: string // raw markdown of the block
  blockRefId?: string // trailing ^block-id
  headingLevel?: number
  headingText?: string
  /** sequential index of this block among "heading" blocks (for #subpath links) */
  headingIndex?: number
  /** exact whitespace between the previous block and this one (byte-preserving round-trip) */
  gapBefore?: string
  /** exact whitespace after this block when it is the LAST one (usually "\n" or "") */
  gapAfter?: string
}

const isBlank = (l: string) => l.trim() === ""
const isHeading = (l: string) => /^#{1,6}(?:[ \t]+.*|\s*)\r?$/.test(l)

/** Split a trailing ^block-ref off a block's raw text (must follow whitespace or start of line, not math x^2). */
function stripBlockRef(raw: string): { text: string; ref?: string } {
  const m = raw.match(/(?:^|[ \t]+)\^([A-Za-z0-9-]+)[ \t]*\r?$/)
  if (!m || m.index === undefined) return { text: raw }
  const stripped = raw.slice(0, m.index)
  const cr = raw.endsWith("\r") && !stripped.endsWith("\r") ? "\r" : ""
  return { text: stripped + cr, ref: m[1] }
}
const isHr = (l: string) => /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*\r?$/.test(l)
const isFenceStart = (l: string) => {
  const m = l.match(/^ {0,3}(`{3,}|~{3,})([^\n\r]*)\r?$/)
  if (!m) return null
  if (m[1][0] === "`" && m[2].includes("`")) return null
  return { char: m[1][0], len: m[1].length }
}
const isMathFenceStart = (l: string) => /^ {0,3}\$\$/.test(l)
const isListItem = (l: string) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(l)
const isListContinuation = (l: string) => /^\s{2,}\S/.test(l)
const isQuote = (l: string) => /^ {0,3}>/.test(l)
const isCalloutStart = (l: string) => /^ {0,3}>[ \t]*\[![A-Za-z-]+\]/.test(l)
const isTableRow = (l: string) => l.includes("|") && !isBlank(l)
const isTableSeparator = (l: string) =>
  /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*(?::?-+:?\s*)?\|?\s*$/.test(l) || /^\s*\|[ \t]*:?-+:?[ \t]*\|\s*$/.test(l)
const isHtmlBlock = (l: string) => /^ {0,3}<(?:div|p|span|img|br|hr|details|summary|table|video|audio|iframe)\b/i.test(l)

/** Parse note content (frontmatter stripped separately) into blocks. */
export function parseBlocks(content: string, includeFrontmatter = true): Block[] {
  const fm = parseFrontmatter(content)
  const lines = fm.body.split("\n")
  const blocks: Block[] = []

  // byte offset (within `content`) of lines[0] of the body
  const fmTextLen = fm.hasFrontmatter ? (content.match(/^---\r?\n[\s\S]*?\r?\n---/)?.[0].length ?? 0) : 0
  let off = 0

  if (fm.hasFrontmatter && includeFrontmatter) {
    blocks.push({
      id: `blk-fm-${fmTextLen}`,
      type: "frontmatter",
      text: content.slice(0, fmTextLen),
    })
  }
  if (fm.hasFrontmatter) off = content.length - fm.body.length

  // offset in `content` just past the previous block's text (gap starts here)
  let prevEnd = fm.hasFrontmatter ? fmTextLen : 0

  // offset of a given body line index within content
  const lineOffsets: number[] = []
  {
    let acc = off
    for (const l of lines) {
      lineOffsets.push(acc)
      acc += l.length + 1 // +1 for the "\n" we split on
    }
  }

  let i = 0
  let headingIndex = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      i++
      continue
    }
    const blockStart = lineOffsets[i]
    const pushBlock = (b: Omit<Block, "id" | "gapBefore">, rawLen?: number) => {
      const gap = content.slice(prevEnd, blockStart)
      blocks.push({
        // deterministic id (position + length + type): reparsing the same
        // content yields the same ids, so editing state survives commits
        id: `blk-${blockStart}-${b.text.length}-${b.type}`,
        gapBefore: /^\s*$/.test(gap) ? gap : "\n\n", // fallback if the scanner overlapped
        ...b,
      })
      // rawLen: the block's exact byte span in content — differs from
      // text.length when a ^block-ref was stripped from the text
      prevEnd = blockStart + (rawLen ?? b.text.length)
    }

    // Fenced code
    const fence = isFenceStart(line)
    if (fence) {
      const start = i
      i++
      while (i < lines.length) {
        const close = lines[i].match(/^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/)
        if (close && close[1][0] === fence.char && close[1].length >= fence.len) {
          i++
          break
        }
        i++
      }
      pushBlock({ type: "code", text: lines.slice(start, i).join("\n") })
      continue
    }

    // Standalone display math block ($$...$$ single-line or multi-line)
    if (isMathFenceStart(line)) {
      const start = i
      const rest = line.replace(/^ {0,3}\$\$/, "")
      if (/\$\$[ \t]*\r?$/.test(rest)) {
        i++
        pushBlock({ type: "math", text: line })
        continue
      }
      i++
      while (i < lines.length) {
        if (/\$\$[ \t]*\r?$/.test(lines[i])) {
          i++
          break
        }
        i++
      }
      pushBlock({ type: "math", text: lines.slice(start, i).join("\n") })
      continue
    }

    // Heading
    if (isHeading(line)) {
      const m = line.match(/^(#{1,6})(?:[ \t]+([^\r]*))?\r?$/)
      let hText = m?.[2] ?? ""
      let text = line
      let blockRef: string | undefined
      const stripped = stripBlockRef(line)
      if (stripped.ref) {
        blockRef = stripped.ref
        text = stripped.text
        hText = hText.replace(/[ \t]*\^[A-Za-z0-9-]+\s*$/, "").trimEnd()
      }
      pushBlock(
        {
          type: "heading",
          text,
          blockRefId: blockRef,
          headingLevel: m?.[1].length ?? 1,
          headingText: hText.trimEnd(),
          headingIndex: headingIndex++,
        },
        line.length,
      )
      i++
      continue
    }

    // HR
    if (isHr(line)) {
      pushBlock({ type: "hr", text: line })
      i++
      continue
    }

    // Table (| row + |---| separator)
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const start = i
      i += 2
      while (i < lines.length && isTableRow(lines[i])) i++
      pushBlock({ type: "table", text: lines.slice(start, i).join("\n") })
      continue
    }

    // Quote / callout (split adjacent sibling top-level callouts)
    if (isQuote(line)) {
      const start = i
      const startsCallout = isCalloutStart(line)
      i++
      while (i < lines.length) {
        const l = lines[i]
        if (isBlank(l) || isCalloutStart(l)) break
        if (isQuote(l) || /^\s{2,}/.test(l)) {
          i++
          continue
        }
        break
      }
      const text = lines.slice(start, i).join("\n")
      pushBlock({ type: startsCallout ? "callout" : "quote", text })
      continue
    }

    // List (with loose-list handling: blank line followed by list/continuation)
    if (isListItem(line)) {
      const start = i
      i++
      while (i < lines.length) {
        if (isListItem(lines[i]) || isListContinuation(lines[i])) {
          i++
        } else if (isBlank(lines[i])) {
          // look ahead: does the list continue?
          let j = i
          while (j < lines.length && isBlank(lines[j])) j++
          if (j < lines.length && (isListItem(lines[j]) || isListContinuation(lines[j]))) {
            i = j
          } else break
        } else break
      }
      pushBlock({ type: "list", text: lines.slice(start, i).join("\n") })
      continue
    }

    // HTML block
    if (isHtmlBlock(line)) {
      const start = i
      i++
      while (i < lines.length && !isBlank(lines[i])) i++
      pushBlock({ type: "html", text: lines.slice(start, i).join("\n") })
      continue
    }

    // Paragraph (until blank line or block-level start)
    const start = i
    i++
    while (i < lines.length) {
      const l = lines[i]
      if (
        isBlank(l) ||
        isHeading(l) ||
        isHr(l) ||
        isFenceStart(l) ||
        isMathFenceStart(l) ||
        isHtmlBlock(l) ||
        isQuote(l) ||
        (isTableRow(l) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) ||
        (isListItem(l) && !isListContinuation(l))
      ) {
        break
      }
      i++
    }
    const paraRaw = lines.slice(start, i).join("\n")
    let paraText = paraRaw
    let blockRef: string | undefined
    const stripped = stripBlockRef(paraRaw)
    if (stripped.ref) {
      blockRef = stripped.ref
      paraText = stripped.text.trimEnd() + (stripped.text.endsWith("\r") ? "\r" : "")
    }
    pushBlock({ type: "paragraph", text: paraText, blockRefId: blockRef }, paraRaw.length)
  }

  // capture the exact trailing whitespace of the file on the last block
  if (blocks.length > 0) {
    const last = blocks[blocks.length - 1]
    if (last.type !== "frontmatter") {
      last.gapAfter = content.slice(prevEnd)
    } else {
      // frontmatter-only file: trailing whitespace after the closing ---
      last.gapAfter = content.slice(fmTextLen)
    }
  }

  return blocks
}

/** Re-append a trailing ^block-id to a block's text (end of last non-empty content, keeping trailing whitespace). */
function appendBlockRef(text: string, ref: string): string {
  const trail = /\s*$/.exec(text)?.[0] ?? ""
  const body = text.slice(0, text.length - trail.length)
  return body + (body && !body.endsWith(" ") ? " " : "") + `^${ref}` + trail
}

/** Rebuild note content from blocks, byte-preserving the original separators. */
export function serializeBlocks(blocks: Block[]): string {
  if (blocks.length === 0) return ""
  const parts: string[] = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    let text = b.text
    if (b.blockRefId && !new RegExp(`\\^${b.blockRefId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`).test(text)) {
      text = appendBlockRef(text, b.blockRefId)
    }
    if (i === 0) parts.push((b.gapBefore && !text.startsWith(b.gapBefore) ? b.gapBefore : "") + text)
    else parts.push((b.gapBefore ?? "\n\n") + text)
  }
  // trailing whitespace: keep the original if the last block has it, else a single newline
  const last = blocks[blocks.length - 1]
  parts.push(last.gapAfter !== undefined ? last.gapAfter : "\n")
  return parts.join("")
}

/** Extract outline headings (code-aware, CRLF-safe) for the outline panel. */
export function extractOutline(content: string): { level: number; text: string; index: number }[] {
  const fm = parseFrontmatter(content)
  const out: { level: number; text: string; index: number }[] = []
  const lines = fm.body.split("\n")
  let inFence = false
  let fenceChar = ""
  let fenceLen = 0
  let idx = 0
  for (const line of lines) {
    if (inFence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/)
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) inFence = false
      continue
    }
    const fence = isFenceStart(line)
    if (fence) {
      inFence = true
      fenceChar = fence.char
      fenceLen = fence.len
      continue
    }
    const h = line.match(/^(#{1,6})[ \t]+([^\r]*?)[ \t]*\r?$/)
    if (h) {
      const text = h[2].replace(/[ \t]*\^[A-Za-z0-9-]+\s*$/, "").trim()
      if (text) out.push({ level: h[1].length, text, index: idx++ })
    }
  }
  return out
}

export function wordCount(content: string): number {
  const fm = parseFrontmatter(content)
  const words = fm.body
    .replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1[ \t]*\r?$/gm, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[\[[^\]]*\]\]/g, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, " $2 ")
    .replace(/\[\[([^\]#]+)(?:#[^\]]*)?\]\]/g, " $1 ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, " $1 ")
    .replace(/[#>*_~`|-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0)
  return words.length
}

export function charCount(content: string): number {
  const fm = parseFrontmatter(content)
  return fm.body.replace(/\r?\n/g, "").length
}
