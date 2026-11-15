// ─── Wikilink / tag engine: parsing, resolution, mutations ───────────────────
import type { IndexEntry, Wikilink } from "./types"
import { parseFrontmatter } from "./frontmatter"

// ![[target]]  [[target|alias]]  [[target#heading]]  [[target#^blockid]]
export const WIKILINK_RE = /(!?)\[\[([^\[\]]+?)\]\]/g

export function parseWikilink(raw: string): Wikilink | null {
  const m = raw.match(/^(!?)\[\[([^\[\]]+?)\]\]$/)
  if (!m) return null
  const embed = m[1] === "!"
  let inner = m[2]
  let alias: string | null = null
  const pipe = inner.indexOf("|")
  if (pipe !== -1) {
    alias = inner.slice(pipe + 1).trim()
    inner = inner.slice(0, pipe)
  }
  let subpath: string | null = null
  const hash = inner.indexOf("#")
  if (hash !== -1) {
    subpath = inner.slice(hash)
    inner = inner.slice(0, hash)
  }
  return { target: inner.trim(), subpath, alias, embed, raw }
}

export function extractLinks(content: string): Wikilink[] {
  const out: Wikilink[] = []
  const cleaned = stripCode(content)
  for (const m of cleaned.matchAll(WIKILINK_RE)) {
    const link = parseWikilink(m[0])
    if (link && link.target) out.push(link)
  }
  return out
}

export function extractMarkdownLinks(content: string): { text: string; target: string; raw: string }[] {
  const out: { text: string; target: string; raw: string }[] = []
  const cleaned = stripCode(content)
  for (const m of cleaned.matchAll(/(?<!!)\[([^\]\n]*)\]\(([^)\n]*)\)/g)) {
    const hrefRaw = m[2].trim()
    const href = hrefRaw.startsWith("<")
      ? hrefRaw.slice(1, hrefRaw.indexOf(">") >= 0 ? hrefRaw.indexOf(">") : hrefRaw.length).trim()
      : hrefRaw.split(/\s+/)[0]
    if (!href || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith("#")) continue
    const hash = href.indexOf("#")
    const body = hash >= 0 ? href.slice(0, hash) : href
    let target = body
    try {
      target = decodeURIComponent(body)
    } catch {
      /* keep raw */
    }
    if (target) out.push({ text: m[1], target, raw: m[0] })
  }
  return out
}

export function extractLinkTargets(content: string): string[] {
  return extractLinks(content)
    .filter((l) => !l.embed)
    .map((l) => l.target)
}

const TAG_BODY = /[^\s#!"'`.,:;()\[\]{}]+/
export const TAG_RE = new RegExp(`(^|[\\s(>])#(${TAG_BODY.source}(?:[-_/]${TAG_BODY.source})*)`, "g")

/** Extract #tags including frontmatter tags (obsidian's tag pane counts both). */
export function extractTags(content: string): string[] {
  const tags = new Set<string>()
  const { data, body } = parseFrontmatter(content)
  const fmTags = data["tags"] ?? data["tag"]
  if (typeof fmTags === "string") {
    fmTags
      .split(/[\s,]+/)
      .map((s) => s.trim().replace(/^#/, ""))
      .filter(Boolean)
      .forEach((t) => tags.add(t))
  } else if (Array.isArray(fmTags)) {
    fmTags
      .filter((t) => typeof t === "string")
      .map((t) => (t as string).trim().replace(/^#/, ""))
      .filter(Boolean)
      .forEach((t) => tags.add(t))
  }
  const stripped = stripCode(body)
    .replace(/\[[^\]\n]*\]\([^)\n]*\)/g, (m) => " ".repeat(m.length))
    .replace(/https?:\/\/[^\s)>\]]+/gi, (m) => " ".repeat(m.length))
  for (const m of stripped.matchAll(TAG_RE)) {
    const tag = m[2]
    if (tag && !/^[-_/]|[-_/]$/.test(tag) && /[a-zA-Z\u00c0-\uffff]/.test(tag)) tags.add(tag)
  }
  return [...tags]
}

/** Mask fenced code blocks (respecting fence char/length) and inline code spans with spaces while preserving newlines & string length. */
export function stripCode(content: string): string {
  const lines = content.split("\n")
  const maskedLines: string[] = []
  let fenceChar: "`" | "~" | null = null
  let fenceLen = 0
  let skippedFm = false

  // Also ignore YAML frontmatter lines at start of document for code/link scanning
  let startIdx = 0
  if (lines[0]?.replace(/\r$/, "") === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].replace(/\r$/, "") === "---") {
        for (let k = 0; k <= i; k++) maskedLines.push(lines[k].replace(/[^\r]/g, " "))
        startIdx = i + 1
        skippedFm = true
        break
      }
    }
  }
  void skippedFm

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]
    const bare = line.replace(/\r$/, "")
    if (!fenceChar) {
      const open = bare.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
      if (open && (open[1][0] !== "`" || !open[2].includes("`"))) {
        fenceChar = open[1][0] as "`" | "~"
        fenceLen = open[1].length
        maskedLines.push(line.replace(/[^\r]/g, " "))
        continue
      }
      maskedLines.push(line)
    } else {
      const close = bare.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)
      maskedLines.push(line.replace(/[^\r]/g, " "))
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
        fenceChar = null
        fenceLen = 0
      }
    }
  }

  return maskedLines.join("\n").replace(/(`+)[\s\S]*?\1/g, (m) => m.replace(/[^\r\n]/g, " "))
}

// ─── Resolution ──────────────────────────────────────────────────────────────

export interface ResolvedLink {
  entry: IndexEntry | null
}

export function buildIndexMap(index: IndexEntry[]): {
  byPath: Map<string, IndexEntry>
  byLowerName: Map<string, IndexEntry[]>
  byLowerAlias: Map<string, IndexEntry[]>
} {
  const byPath = new Map<string, IndexEntry>()
  const byLowerName = new Map<string, IndexEntry[]>()
  const byLowerAlias = new Map<string, IndexEntry[]>()
  for (const e of index) {
    byPath.set(e.path, e)
    byPath.set(e.path.toLowerCase(), e)
    const ext = e.kind === "canvas" ? ".canvas" : ".md"
    byPath.set(e.path + ext, e)
    byPath.set((e.path + ext).toLowerCase(), e)
    if (e.id !== e.path + ext) {
      byPath.set(e.id, e)
      byPath.set(e.id.toLowerCase(), e)
    }
    const n = e.name.toLowerCase()
    if (!byLowerName.has(n)) byLowerName.set(n, [])
    byLowerName.get(n)!.push(e)
    for (const a of e.aliases) {
      const al = a.toLowerCase()
      if (!byLowerAlias.has(al)) byLowerAlias.set(al, [])
      byLowerAlias.get(al)!.push(e)
    }
  }
  return { byPath, byLowerName, byLowerAlias }
}

/** Resolve a link target the way obsidian does: exact path → name → alias. */
export function resolveLink(
  target: string,
  maps: ReturnType<typeof buildIndexMap>,
): IndexEntry | null {
  const t = target.trim().replace(/\\/g, "/").replace(/^\/+/, "")
  if (!t) return null
  // exact path (with or without .md / .canvas)
  const byPath =
    maps.byPath.get(t) ??
    maps.byPath.get(t + ".md") ??
    maps.byPath.get(t + ".canvas") ??
    maps.byPath.get(t.toLowerCase()) ??
    maps.byPath.get((t + ".md").toLowerCase()) ??
    maps.byPath.get((t + ".canvas").toLowerCase())
  if (byPath) return byPath

  const lowerNoExt = t.replace(/\.(?:md|markdown|canvas)$/i, "").toLowerCase()
  const pickShortest = (list: IndexEntry[] | undefined): IndexEntry | null => {
    if (!list || list.length === 0) return null
    return [...list].sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))[0]
  }
  return pickShortest(maps.byLowerName.get(lowerNoExt)) ?? pickShortest(maps.byLowerAlias.get(t.toLowerCase()))
}

// ─── Path helpers ────────────────────────────────────────────────────────────

export function parentPath(path: string): string {
  const i = path.lastIndexOf("/")
  return i === -1 ? "" : path.slice(0, i)
}

export function baseName(path: string): string {
  const i = path.lastIndexOf("/")
  return i === -1 ? path : path.slice(i + 1)
}

// ─── Snippets ────────────────────────────────────────────────────────────────

export function makeSnippet(
  content: string,
  index: number,
  length: number,
  pad = 36,
): { before: string; match: string; after: string } {
  const start = Math.max(0, index - pad)
  const end = Math.min(content.length, index + length + pad)
  let before = content.slice(start, index).replace(/\s+/g, " ")
  const match = content.slice(index, index + length)
  const after = content.slice(index + length, end).replace(/\s+/g, " ")
  if (start > 0) before = "…" + before
  const afterText = end < content.length ? after + "…" : after
  return { before, match, after: afterText }
}

// ─── Source mutations ────────────────────────────────────────────────────────

export const TASK_LINE_RE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/

/** Compute a per-line boolean mask indicating lines inside frontmatter or fenced code blocks. */
export function codeOrFmLineMask(content: string): boolean[] {
  const lines = content.split("\n")
  const mask = new Array<boolean>(lines.length).fill(false)
  let i = 0
  if (lines[0]?.replace(/\r$/, "") === "---") {
    for (let j = 1; j < lines.length; j++) {
      if (lines[j].replace(/\r$/, "") === "---") {
        for (let k = 0; k <= j; k++) mask[k] = true
        i = j + 1
        break
      }
    }
  }
  let fenceChar: "`" | "~" | null = null
  let fenceLen = 0
  for (; i < lines.length; i++) {
    const bare = lines[i].replace(/\r$/, "")
    if (!fenceChar) {
      const open = bare.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
      if (open && (open[1][0] !== "`" || !open[2].includes("`"))) {
        fenceChar = open[1][0] as "`" | "~"
        fenceLen = open[1].length
        mask[i] = true
      }
    } else {
      mask[i] = true
      const close = bare.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
        fenceChar = null
        fenceLen = 0
      }
    }
  }
  return mask
}

/** Toggle the nth checkbox task in markdown source (skipping frontmatter and code fences). */
export function toggleTaskInSource(content: string, taskIndex: number): string {
  let count = -1
  const lines = content.split("\n")
  const masked = codeOrFmLineMask(content)
  for (let i = 0; i < lines.length; i++) {
    if (masked[i]) continue
    const m = lines[i].match(TASK_LINE_RE)
    if (m) {
      count++
      if (count === taskIndex) {
        const checked = m[2] !== " "
        lines[i] = lines[i].replace(/\[([ xX])\]/, checked ? "[ ]" : "[x]")
        return lines.join("\n")
      }
    }
  }
  return content
}

/** Wrap the nth unlinked bare occurrence of `needle` in a wikilink (unlinked-mention linking). */
export function linkOccurrence(
  content: string,
  needle: string,
  occurrenceIndex: number,
  noteName: string,
): string {
  const re = new RegExp(`(?<![\\w-])${escapeRegExp(needle)}(?![\\w-])`, "gi")
  let count = 0
  return content.replace(re, (match, offset: number) => {
    // skip occurrences inside an existing link, frontmatter, or code without counting them
    if (isInsideLinkOrCode(content, offset, match.length)) {
      return match
    }
    if (count === occurrenceIndex) {
      count++
      return match === noteName ? `[[${noteName}]]` : `[[${noteName}|${match}]]`
    }
    count++
    return match
  })
}

export function isInsideLinkOrCode(content: string, offset: number, length: number): boolean {
  const lineStart = content.lastIndexOf("\n", offset - 1) + 1
  const lineNum = content.slice(0, lineStart).split("\n").length - 1
  const masked = codeOrFmLineMask(content)
  if (masked[lineNum]) return true
  const lineEnd = content.indexOf("\n", offset)
  const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
  const posInLine = offset - lineStart
  // inside inline code (`...`)
  for (const m of line.matchAll(/(`+)([^\n]*?)\1/g)) {
    const idx = m.index ?? 0
    if (posInLine >= idx && posInLine + length <= idx + m[0].length) return true
  }
  // inside a wikilink on this line
  for (const m of line.matchAll(WIKILINK_RE)) {
    const idx = m.index ?? 0
    if (posInLine >= idx && posInLine + length <= idx + m[0].length) return true
  }
  // inside an md link
  for (const m of line.matchAll(/\[[^\]]*\]\([^)]*\)/g)) {
    const idx = m.index ?? 0
    if (posInLine >= idx && posInLine + length <= idx + m[0].length) return true
  }
  return false
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Extract a section (heading or ^block) from markdown body (ignoring code fences). */
export function extractSection(body: string, subpath: string | null): string {
  if (!subpath) return body
  const lines = body.split("\n")
  const masked = codeOrFmLineMask(body)

  if (subpath.startsWith("#^")) {
    const blockId = subpath.slice(2)
    for (let i = 0; i < lines.length; i++) {
      if (masked[i]) continue
      const idMatch = lines[i].match(/\s\^([A-Za-z0-9-]+)\s*$/)
      if (idMatch && idMatch[1] === blockId) {
        const cur = lines[i]
        const listMatch = cur.match(/^(\s*)(?:[-*+]|\d+[.)])\s+/)
        if (listMatch) {
          // Single list item (+ deeper indented child lines only)
          const baseIndent = listMatch[1].length
          let end = i
          while (end + 1 < lines.length && lines[end + 1].trim() !== "" && !masked[end + 1]) {
            const nxt = lines[end + 1]
            const indent = nxt.match(/^(\s*)/)?.[1].length ?? 0
            if (indent > baseIndent) end++
            else break
          }
          return lines
            .slice(i, end + 1)
            .join("\n")
            .replace(/\s+\^([A-Za-z0-9-]+)\s*$/, "")
        }
        let start = i
        while (start > 0 && lines[start - 1].trim() !== "" && !masked[start - 1]) start--
        let end = i
        while (end + 1 < lines.length && lines[end + 1].trim() !== "" && !masked[end + 1]) end++
        return lines
          .slice(start, end + 1)
          .join("\n")
          .replace(/\s*\^([A-Za-z0-9-]+)\s*$/, "")
      }
    }
    return `*Block not found: ${subpath}*`
  }

  // heading path: #H1#H2 or direct #SubHeading
  const parts = subpath.slice(1).split("#").filter((p) => p !== "")
  let headingLine = -1
  let targetLevel = 0
  if (parts.length === 1) {
    const wanted = parts[0].toLowerCase()
    for (let i = 0; i < lines.length; i++) {
      if (masked[i]) continue
      const h = lines[i].match(/^(#{1,6})\s+(.*)$/)
      if (h && h[2].trim().replace(/\s*$/, "").toLowerCase() === wanted) {
        headingLine = i
        targetLevel = h[1].length
        break
      }
    }
  } else {
    let matched = 0
    for (let i = 0; i < lines.length; i++) {
      if (masked[i]) continue
      const h = lines[i].match(/^(#{1,6})\s+(.*)$/)
      if (h) {
        const level = h[1].length
        const text = h[2].trim().replace(/\s*$/, "")
        if (text.toLowerCase() === parts[matched]?.toLowerCase() && (matched === 0 || level > targetLevel)) {
          targetLevel = level
          matched++
          if (matched === parts.length) {
            headingLine = i
            break
          }
        } else if (matched > 0 && level <= targetLevel) {
          matched = text.toLowerCase() === parts[0]?.toLowerCase() ? 1 : 0
          targetLevel = matched ? level : 0
        }
      }
    }
  }
  if (headingLine === -1) return `*Section not found: ${subpath}*`
  let end = lines.length
  for (let i = headingLine + 1; i < lines.length; i++) {
    if (masked[i]) continue
    const h = lines[i].match(/^(#{1,6})\s+/)
    if (h && h[1].length <= targetLevel) {
      end = i
      break
    }
  }
  return lines.slice(headingLine, end).join("\n").trim()
}

/** Toggle bold/italic/etc. around a selection — used by editor hotkeys. */
export function wrapSelection(text: string, start: number, end: number, wrap: string): { text: string; selStart: number; selEnd: number } {
  const selected = text.slice(start, end)
  const before = text.slice(0, start)
  const after = text.slice(end)
  if (before.endsWith(wrap) && after.startsWith(wrap)) {
    return {
      text: before.slice(0, -wrap.length) + selected + after.slice(wrap.length),
      selStart: start - wrap.length,
      selEnd: end - wrap.length,
    }
  }
  if (selected.startsWith(wrap) && selected.endsWith(wrap) && selected.length >= 2 * wrap.length) {
    return {
      text: before + selected.slice(wrap.length, -wrap.length) + after,
      selStart: start,
      selEnd: end - 2 * wrap.length,
    }
  }
  return {
    text: before + wrap + selected + wrap + after,
    selStart: start + wrap.length,
    selEnd: end + wrap.length,
  }
}
