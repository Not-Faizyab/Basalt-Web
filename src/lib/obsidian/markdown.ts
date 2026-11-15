// ─── obsidian-flavoured Markdown rendering pipeline ──────────────────────────
// marked + custom extensions: [[wikilinks]], ![[embeds]] (notes + attachments),
// ==highlights==, #tags, > [!callouts], footnotes, task checkboxes, prism code
// highlighting, $math$ / $$math$$ (KaTeX, offline).
import { Marked, type Tokens } from "marked"
import Prism from "prismjs"
import katex from "katex"
import "prismjs/components/prism-typescript"
import "prismjs/components/prism-jsx"
import "prismjs/components/prism-tsx"
import "prismjs/components/prism-python"
import "prismjs/components/prism-bash"
import "prismjs/components/prism-json"
import "prismjs/components/prism-yaml"
import "prismjs/components/prism-markdown"
import "prismjs/components/prism-sql"
import "prismjs/components/prism-rust"
import "prismjs/components/prism-go"
import "prismjs/components/prism-java"
import "prismjs/components/prism-c"
import "prismjs/components/prism-cpp"
import "prismjs/components/prism-diff"
import "prismjs/components/prism-toml"
import "prismjs/components/prism-powershell"
import { parseFrontmatter } from "./frontmatter"
import { buildIndexMap, resolveLink, TAG_RE } from "./links"
import type { AttachmentRef, EmbedRef, IndexEntry, RenderResult, RenderSegment, VaultFileMeta } from "./types"

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// ─── Callout metadata (icons + colors mirror obsidian's defaults) ────────────

const CALLOUT_ICONS: Record<string, string> = {
  note: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z",
  abstract: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M8 2h8v4H8z",
  summary: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M8 2h8v4H8z",
  tldr: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M8 2h8v4H8z",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  todo: "M21 12a9 9 0 1 1-9-9M21 3v6h-6",
  hint: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z",
  important: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z",
  tip: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z",
  success: "M20 6 9 17l-5-5",
  check: "M20 6 9 17l-5-5",
  done: "M20 6 9 17l-5-5",
  question: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01",
  faq: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01",
  warning: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4M12 17h.01",
  caution: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4M12 17h.01",
  attention: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4M12 17h.01",
  failure: "m15 9-6 6M9 9l6 6M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
  fail: "m15 9-6 6M9 9l6 6M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
  missing: "m15 9-6 6M9 9l6 6M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
  danger: "m15 9-6 6M9 9l6 6M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
  error: "m15 9-6 6M9 9l6 6M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
  bug: "m8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4",
  example: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  quote: "M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2zM5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z",
  cite: "M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2zM5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z",
}

const CALLOUT_COLORS: Record<string, string> = {
  note: "8, 109, 221",
  abstract: "0, 176, 255",
  summary: "0, 176, 255",
  tldr: "0, 176, 255",
  info: "8, 130, 245",
  todo: "8, 130, 245",
  hint: "0, 191, 188",
  important: "0, 191, 188",
  tip: "0, 191, 188",
  success: "68, 207, 110",
  check: "68, 207, 110",
  done: "68, 207, 110",
  question: "224, 145, 58",
  help: "224, 145, 58",
  faq: "224, 145, 58",
  warning: "236, 145, 58",
  caution: "236, 145, 58",
  attention: "236, 145, 58",
  failure: "235, 71, 74",
  fail: "235, 71, 74",
  missing: "235, 71, 74",
  danger: "235, 71, 74",
  error: "235, 71, 74",
  bug: "235, 71, 74",
  example: "160, 140, 230",
  quote: "158, 158, 158",
  cite: "158, 158, 158",
}

function calloutIconSvg(type: string): string {
  const path = CALLOUT_ICONS[type] ?? CALLOUT_ICONS.note
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`
}

// ─── Attachment (media) classification ───────────────────────────────────────

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico"])
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "flac", "opus", "aac", "oga"])
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv", "m4v", "ogv"])
const PDF_EXTS = new Set(["pdf"])

export function isImageExt(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase())
}

/** Resolve an embed/markdown-image target to a vault file (obsidian-style:
 *  exact path first, then name match anywhere in the vault). */
export function resolveAttachment(target: string, files: VaultFileMeta[]): VaultFileMeta | null {
  if (!files || files.length === 0) return null
  const t = target.trim().replace(/^\/+/, "")
  if (!t) return null
  const lower = t.toLowerCase()
  // exact relative path (with or without extension)
  const byPath = files.find((f) => f.id.toLowerCase() === lower) ?? files.find((f) => f.id.toLowerCase() === lower + "." + f.ext)
  if (byPath) return byPath
  const withExt = files.find((f) => `${f.name}.${f.ext}`.toLowerCase() === lower)
  if (withExt) return withExt
  const dot = lower.lastIndexOf(".")
  const base = dot > 0 ? lower.slice(0, dot) : lower
  const ext = dot > 0 ? lower.slice(dot + 1) : ""
  const byName = ext
    ? files.find((f) => f.name.toLowerCase() === base && f.ext === ext) ?? files.find((f) => f.name.toLowerCase() === lower)
    : files.find((f) => f.name.toLowerCase() === lower)
  return byName ?? null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Split markdown into code-protected segments (variable-length fences + multi-backtick spans) and plain text. */
function splitMarkdownCode(content: string): { text: string; code: boolean }[] {
  const parts: { text: string; code: boolean }[] = []
  const lines = content.split("\n")
  let textBuf: string[] = []
  let fenceBuf: string[] = []
  let fenceChar = ""
  let fenceLen = 0

  const pushPlainChunk = (raw: string) => {
    if (!raw) return
    // Split multi-backtick & single-backtick inline code spans (non-crossing blank lines)
    let i = 0
    let plainStart = 0
    const len = raw.length
    while (i < len) {
      if (raw[i] === "`") {
        let ticks = 1
        while (i + ticks < len && raw[i + ticks] === "`") ticks++
        const closer = "`".repeat(ticks)
        let closeIdx = raw.indexOf(closer, i + ticks)
        // Ensure exact run length match and doesn't cross blank line
        while (closeIdx !== -1) {
          if (raw[closeIdx + ticks] !== "`") {
            const inner = raw.slice(i + ticks, closeIdx)
            if (!/\r?\n\r?\n/.test(inner)) break
          }
          closeIdx = raw.indexOf(closer, closeIdx + ticks)
        }
        if (closeIdx !== -1) {
          if (i > plainStart) parts.push({ text: raw.slice(plainStart, i), code: false })
          parts.push({ text: raw.slice(i, closeIdx + ticks), code: true })
          i = closeIdx + ticks
          plainStart = i
          continue
        }
        i += ticks
        continue
      }
      i++
    }
    if (plainStart < len) parts.push({ text: raw.slice(plainStart), code: false })
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const stripped = line.replace(/\r$/, "")
    if (!fenceChar) {
      const m = stripped.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
      if (m && (m[1][0] !== "`" || !m[2].includes("`"))) {
        if (textBuf.length > 0) {
          pushPlainChunk(textBuf.join("\n") + "\n")
          textBuf = []
        }
        fenceChar = m[1][0]
        fenceLen = m[1].length
        fenceBuf = [line]
        continue
      }
      textBuf.push(line)
    } else {
      fenceBuf.push(line)
      const closeRe = new RegExp(`^ {0,3}${fenceChar === "~" ? "~" : "`"}{${fenceLen},}[ \\t]*$`)
      if (closeRe.test(stripped)) {
        parts.push({ text: fenceBuf.join("\n") + (i < lines.length - 1 ? "\n" : ""), code: true })
        fenceBuf = []
        fenceChar = ""
        fenceLen = 0
      }
    }
  }
  if (fenceBuf.length > 0) parts.push({ text: fenceBuf.join("\n"), code: true })
  if (textBuf.length > 0) pushPlainChunk(textBuf.join("\n"))
  return parts
}

/** Split content into code / non-code segments; apply transform to non-code. */
export function replaceOutsideCode(content: string, re: RegExp, fn: (...args: string[]) => string): string {
  return splitMarkdownCode(content)
    .map((p) => (p.code ? p.text : p.text.replace(re, fn as never)))
    .join("")
}

const RAW_HTML_ALLOWED_TAGS = new Set([
  "p", "br", "hr", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "code", "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "a", "strong", "b", "em", "i", "u", "del", "s", "ins", "mark", "sup", "sub", "small", "kbd", "abbr", "cite", "q",
  "img", "details", "summary",
])

const OUTPUT_ALLOWED_TAGS = new Set([
  ...RAW_HTML_ALLOWED_TAGS,
  "input", "section", "svg", "path", "line", "rect", "circle", "polyline", "polygon",
  "math", "semantics", "mrow", "mi", "mo", "mn", "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot",
  "mover", "munder", "munderover", "mtable", "mtr", "mtd", "mspace", "mtext", "mpadded", "mphantom", "mstyle", "menclose", "annotation",
])

function decodeHtmlEntitiesOnce(s: string): string {
  return s
    .replace(/&#(\d+);?/g, (_m, n: string) => {
      const code = parseInt(n, 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ""
    })
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => {
      const code = parseInt(h, 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ""
    })
    .replace(/&colon;/gi, ":")
    .replace(/&tab;|&newline;/gi, "")
}

function isSafeUrl(raw: string, allowDataImage = false): boolean {
  let decoded = raw.trim()
  for (let i = 0; i < 3; i++) {
    const next = decodeHtmlEntitiesOnce(decoded)
    if (next === decoded) break
    decoded = next
  }
  const compact = decoded.replace(/[\u0000-\u0020\u007f]/g, "").toLowerCase()
  if (!compact || compact.startsWith("#") || compact.startsWith("/")) return true
  if (allowDataImage && /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i.test(compact)) return true
  if (/^(?:javascript|vbscript|data|file):/i.test(compact)) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(compact)) {
    return /^(?:https?|mailto|app):/i.test(compact)
  }
  return true
}

function sanitizeAttributes(tag: string, rawAttrs: string, allowTrusted: boolean): string {
  const attrs: string[] = []
  const attrRe = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  for (const m of rawAttrs.matchAll(attrRe)) {
    const name = m[1].toLowerCase()
    const val = m[2] ?? m[3] ?? m[4] ?? ""
    if (name.startsWith("on") || name === "srcdoc" || name === "formaction" || name === "http-equiv") continue
    if (name === "style") {
      // Allow ONLY safe callout color / KaTeX styling, never url(...) or expression(...)
      if (!allowTrusted) continue
      const safeDecls = val
        .split(";")
        .map((d) => d.trim())
        .filter((d) => {
          if (!d) return false
          if (/url\s*\(|expression\s*\(|@import/i.test(d)) return false
          return /^(?:--[a-z0-9-]+|width|height|min-width|max-width|top|left|right|bottom|margin[a-z-]*|padding[a-z-]*|font-size|color|vertical-align|position|display|transform)\s*:/i.test(d)
        })
      if (safeDecls.length > 0) attrs.push(`style="${esc(safeDecls.join("; "))}"`)
      continue
    }
    if (name === "href" || name === "src" || name === "xlink:href") {
      if (!isSafeUrl(val, tag === "img")) continue
      attrs.push(`${name}="${esc(val)}"`)
      continue
    }
    if (name === "type" && tag === "input") {
      if (val.toLowerCase() !== "checkbox") continue
      attrs.push(`type="checkbox"`)
      continue
    }
    if (
      name === "class" ||
      name === "id" ||
      name === "alt" ||
      name === "title" ||
      name === "width" ||
      name === "height" ||
      name === "checked" ||
      name === "target" ||
      name === "rel" ||
      name === "colspan" ||
      name === "rowspan" ||
      name === "align" ||
      name === "open" ||
      name === "aria-hidden" ||
      name === "xmlns" ||
      name === "viewbox" ||
      name === "fill" ||
      name === "stroke" ||
      name === "stroke-width" ||
      name === "stroke-linecap" ||
      name === "stroke-linejoin" ||
      name === "d" ||
      name === "preserveaspectratio" ||
      name === "encoding" ||
      name === "mathvariant" ||
      name === "stretchy" ||
      name === "fence" ||
      name === "separator" ||
      name === "lspace" ||
      name === "rspace" ||
      name === "accent" ||
      name.startsWith("data-")
    ) {
      attrs.push(m[2] === undefined && m[3] === undefined && m[4] === undefined ? name : `${name}="${esc(val)}"`)
    }
  }
  return attrs.length > 0 ? " " + attrs.join(" ") : ""
}

function sanitizeTagStream(html: string, allowed: Set<string>, allowTrusted: boolean): string {
  // Strip dangerous block tags WITH their contents cleanly
  let out = html
    .replace(/<(script|style|noscript|template|xmp|iframe|object|embed|applet|title|textarea)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?(script|style|meta|link|base|noscript|template|xmp|iframe|object|embed|applet|form|frame|frameset)[^>]*>/gi, "")
  out = out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?\s*(\/?)>/g, (_m, slash: string, rawTag: string, rawAttrs = "", selfClose: string) => {
    const tag = rawTag.toLowerCase()
    if (!allowed.has(tag)) return ""
    if (slash) return `</${tag}>`
    const cleanAttrs = sanitizeAttributes(tag, rawAttrs, allowTrusted)
    return `<${tag}${cleanAttrs}${selfClose ? " /" : ""}>`
  })
  return out
}

function sanitizeHtml(html: string): string {
  return sanitizeTagStream(html, OUTPUT_ALLOWED_TAGS, true)
}

// ─── Marked instances (soft vs strict line breaks, shared extensions) ─────────

export interface RenderOptions {
  /** link index for resolving [[targets]] */
  index?: IndexEntry[]
  /** non-markdown vault files, for ![[image.png]] / ![](file) attachment embeds */
  files?: VaultFileMeta[]
  /** file id (vault-relative path) → displayable URL; null on platforms without file access */
  resolveAttachmentUrl?: (file: VaultFileMeta) => string | null
  /** obsidian Settings -> Editor -> Strict line breaks (false = single newline creates <br>) */
  strictLineBreaks?: boolean
}

let headingCounter = 0

function createobsidianMarked(breaks: boolean): Marked {
  const m = new Marked({ gfm: true, breaks })
  m.use({
    tokenizer: {
      del(src: string) {
        // obsidian GFM requires double tilde ~~strike~~, NEVER single ~strike~
        if (src.startsWith("~~")) {
          const cap = /^~~(?=\S)([\s\S]*?\S)~~(?!~)/.exec(src)
          if (cap) {
            return {
              type: "del",
              raw: cap[0],
              text: cap[1],
              tokens: this.lexer.inlineTokens(cap[1]),
            }
          }
          return { type: "text", raw: "~~", text: "~~" } as unknown as undefined
        }
        if (src.startsWith("~")) {
          return { type: "text", raw: "~", text: "~" } as unknown as undefined
        }
        return false
      },
    },
    extensions: [
      {
        name: "obshighlight",
        level: "inline",
        start(src: string) {
          const i = src.indexOf("==")
          return i === -1 ? undefined : i
        },
        tokenizer(src: string) {
          const cap = src.match(/^==(?!\s)([\s\S]+?)==(?!==)/)
          if (!cap) return undefined
          return {
            type: "obshighlight",
            raw: cap[0],
            inner: this.lexer.inlineTokens(cap[1]),
          } as unknown as Tokens.Generic
        },
        renderer(token) {
          const t = token as unknown as { inner: Tokens.Generic[] }
          return `<mark class="obs-highlight">${this.parser.parseInline(t.inner as never)}</mark>`
        },
      },
      {
        name: "callout",
        level: "block",
        start(src: string) {
          const i = src.search(/^ {0,3}>[ \t]*\[![A-Za-z-]+\]/m)
          return i === -1 ? undefined : i
        },
        tokenizer(src: string) {
          const lines = src.split("\n")
          const first = lines[0] ?? ""
          const header = first.match(/^ {0,3}>[ \t]*\[!([A-Za-z-]+)\]([+-]?)[ \t]*(.*)$/)
          if (!header) return undefined
          const consumed = [first]
          for (let i = 1; i < lines.length; i++) {
            const ln = lines[i]
            // Adjacent sibling callout (> [!type]) starts a separate block
            if (/^ {0,3}>[ \t]*\[![A-Za-z-]+\]/.test(ln)) break
            if (/^ {0,3}>/.test(ln)) {
              consumed.push(ln)
            } else {
              break
            }
          }
          let raw = consumed.join("\n")
          if (consumed.length < lines.length && src.startsWith(raw + "\n")) raw += "\n"
          const calloutType = header[1].toLowerCase()
          const fold = header[2] || ""
          const customTitle = header[3].trim()
          const defaultTitle = calloutType.charAt(0).toUpperCase() + calloutType.slice(1)
          const titleTokens = this.lexer.inlineTokens(customTitle || defaultTitle)
          const body = consumed
            .slice(1)
            .map((l) => l.replace(/^ {0,3}> ?/, ""))
            .join("\n")
          return {
            type: "callout",
            raw,
            calloutType,
            fold,
            titleTokens,
            tokens: this.lexer.blockTokens(body),
          } as unknown as Tokens.Generic
        },
        renderer(token) {
          const t = token as unknown as {
            calloutType: string
            fold: string
            titleTokens: Tokens.Generic[]
            tokens: Tokens.Generic[]
          }
          const type = t.calloutType
          const color = CALLOUT_COLORS[type] ?? CALLOUT_COLORS.note
          const icon = calloutIconSvg(type)
          const titleHtml = this.parser.parseInline(t.titleTokens as never)
          const bodyHtml = this.parser.parse(t.tokens as never)
          const foldAttr = t.fold ? ` data-callout-fold="${t.fold}"` : ""
          return `<div class="obs-callout" data-callout="${esc(type)}"${foldAttr} style="--callout-color: ${color};"><div class="obs-callout-title"><div class="obs-callout-icon">${icon}</div><div class="obs-callout-title-inner">${titleHtml}</div>${t.fold ? '<div class="obs-callout-fold-collapse-indicator"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></div>' : ""}</div><div class="obs-callout-content">${bodyHtml}</div></div>`
        },
      },
    ],
    renderer: {
      html(token: Tokens.HTML | Tokens.Tag) {
        return sanitizeTagStream(token.text, RAW_HTML_ALLOWED_TAGS, false)
      },
      heading(token: Tokens.Heading) {
        const text = this.parser.parseInline(token.tokens)
        const id = `h-${headingCounter++}`
        return `<h${token.depth} id="${id}">${text}</h${token.depth}>`
      },
      code(token: Tokens.Code) {
        const lang = (token.lang || "").match(/^[a-zA-Z0-9_-]+/)?.[0] ?? ""
        let body: string
        if (lang && Prism.languages[lang]) {
          try {
            body = Prism.highlight(token.text, Prism.languages[lang], lang)
          } catch {
            body = esc(token.text)
          }
        } else {
          body = esc(token.text)
        }
        return `<pre class="obs-code-block" data-lang="${esc(lang)}"><code class="language-${esc(lang)}">${body}</code></pre>`
      },
      link(token: Tokens.Link) {
        const text = this.parser.parseInline(token.tokens)
        const href = token.href || ""
        if (!isSafeUrl(href, false)) return text
        if (/^https?:\/\//i.test(href) || href.startsWith("mailto:")) {
          return `<a class="external-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}<svg class="external-link-icon" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg></a>`
        }
        return `<a class="internal-link" data-href="${esc(href.replace(/\.(md|markdown)$/i, ""))}" href="#">${text}</a>`
      },
      image(token: Tokens.Image) {
        const href = token.href || ""
        const title = token.text || ""
        if (/^https?:\/\//i.test(href)) {
          const isDesktop = typeof window !== "undefined" && !!(window as unknown as { desktop?: unknown }).desktop
          if (isDesktop) {
            return `<a class="obs-external-image external-link" href="${esc(href)}">${esc(title || href)} — external image</a>`
          }
          return `<img class="obs-embed-image obs-external-image" src="${esc(href)}" alt="${esc(title)}" />`
        }
        let raw = href
        try {
          raw = decodeURIComponent(href)
        } catch {
          /* keep raw */
        }
        const file = resolveAttachment(raw, renderContext.files)
        if (file) {
          const url = renderContext.attachmentUrl(file)
          if (url && IMAGE_EXTS.has(file.ext)) {
            return `<img class="obs-embed-image" src="${esc(url)}" alt="${esc(title || file.name)}" data-vault-file="${esc(file.id)}" />`
          }
          return `<a class="internal-embed-chip" data-attachment="${esc(file.id)}" href="#">${esc(`${file.name}.${file.ext}`)}</a>`
        }
        return `<span class="obs-embed-missing">${esc(title || raw)}</span>`
      },
    },
  })
  return m
}

const markedSoftBreaks = createobsidianMarked(true)
const markedStrictBreaks = createobsidianMarked(false)

// Per-render resolution context (module-level holder; renderMarkdown sets it
// synchronously before each render, so closures can read it safely).
const renderContext: {
  resolve: (t: string) => IndexEntry | null
  files: VaultFileMeta[]
  attachmentUrl: (file: VaultFileMeta) => string | null
} = {
  resolve: () => null,
  files: [],
  attachmentUrl: () => null,
}

// ─── Math (KaTeX, rendered offline) ──────────────────────────────────────────

function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false, output: "html" })
  } catch {
    return `<code class="obs-math-error">${esc(tex)}</code>`
  }
}

/** Parse $$display$$ and $inline$ outside code without confusing currency ($5 ... $total) or escaped \$$. */
function replaceMathOutsideCode(
  text: string,
  emit: (tex: string, display: boolean) => string,
): string {
  let out = ""
  let i = 0
  const n = text.length
  while (i < n) {
    if (text[i] === "\\") {
      if (text[i + 1] === "$") {
        // \$ or \$$ — treat escaped delimiter(s) as literal text
        out += "&#36;"
        i += 2
        if (text[i] === "$") {
          out += "&#36;"
          i++
        }
        continue
      }
      out += text.slice(i, Math.min(n, i + 2))
      i += 2
      continue
    }
    if (text[i] === "$" && text[i + 1] === "$") {
      // Display math $$...$$ (cannot close on escaped \$)
      let j = i + 2
      let closed = -1
      while (j < n - 1) {
        if (text[j] === "\\") {
          j += 2
          continue
        }
        if (text[j] === "$" && text[j + 1] === "$") {
          closed = j
          break
        }
        j++
      }
      if (closed !== -1) {
        let tex = text.slice(i + 2, closed)
        if (tex.includes("\n")) tex = tex.replace(/^[ \t]*>[ \t]?/gm, "")
        out += emit(tex.trim(), true)
        i = closed + 2
        continue
      }
    }
    if (text[i] === "$" && text[i + 1] !== "$" && i + 1 < n && !/\s/.test(text[i + 1])) {
      let j = i + 1
      let closed = -1
      while (j < n && text[j] !== "\n" && text[j] !== "\r") {
        if (text[j] === "\\") {
          j += 2
          continue
        }
        if (text[j] === "$") {
          const prev = text[j - 1]
          const next = text[j + 1] ?? ""
          if (!/\s/.test(prev) && !/[A-Za-z0-9]/.test(next)) {
            closed = j
            break
          }
          // Not a valid inline math closer (e.g. currency $5 ($total) or $10)
          closed = -1
          break
        }
        j++
      }
      if (closed !== -1) {
        out += emit(text.slice(i + 1, closed), false)
        i = closed + 1
        continue
      }
    }
    out += text[i++]
  }
  return out
}

function renderWikilinkToken(rawInner: string, embed: boolean): string {
  let inner = rawInner
  let alias: string | null = null
  const pipe = inner.indexOf("|")
  if (pipe !== -1) {
    alias = inner.slice(pipe + 1).trim()
    inner = inner.slice(0, pipe)
  }
  let subpath = ""
  const hash = inner.indexOf("#")
  if (hash !== -1) {
    subpath = inner.slice(hash)
    inner = inner.slice(0, hash)
  }
  const target = inner.trim()
  if (embed) {
    const file = resolveAttachment(target, renderContext.files)
    if (file) {
      const url = renderContext.attachmentUrl(file)
      const szMatch = alias ? alias.match(/^(\d+)(?:x(\d+))?$/i) : null
      const sizeAttrs = szMatch
        ? ` width="${parseInt(szMatch[1], 10)}"${szMatch[2] ? ` height="${parseInt(szMatch[2], 10)}"` : ""}`
        : ""
      if (url && IMAGE_EXTS.has(file.ext)) {
        return `<img class="obs-embed-image" src="${esc(url)}" alt="${esc(file.name)}" data-vault-file="${esc(file.id)}"${sizeAttrs} />`
      }
      return `<a class="internal-embed-chip" data-attachment="${esc(file.id)}" href="#">${esc(alias || `${file.name}.${file.ext}`)}</a>`
    }
    return `<a class="internal-embed-chip internal-link" data-href="${esc(target)}" data-subpath="${esc(subpath)}" href="#">${esc(alias || target)}</a>`
  }
  const resolved = renderContext.resolve(target)
  const cls = resolved ? "internal-link" : "internal-link is-unresolved"
  return `<a class="${cls}" data-href="${esc(target)}" data-subpath="${esc(subpath)}" href="#">${esc(alias || target)}</a>`
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export interface FullRenderResult extends RenderResult {
  cssClasses: string[]
  bodySource: string
}

export function renderMarkdown(content: string, opts: RenderOptions = {}): FullRenderResult {
  const { data, body } = parseFrontmatter(content)
  const d = data as Record<string, unknown>
  const rawCss = d.cssclasses ?? d.cssclass
  const cssClasses: string[] = Array.isArray(rawCss)
    ? rawCss.map((c) => String(c).trim()).filter(Boolean)
    : typeof rawCss === "string"
      ? rawCss.split(/[\s,]+/).filter(Boolean)
      : []

  const maps = buildIndexMap(opts.index ?? [])
  renderContext.resolve = (t: string) => resolveLink(t, maps)
  renderContext.files = opts.files ?? []
  renderContext.attachmentUrl = opts.resolveAttachmentUrl ?? (() => null)

  const tokPrefix = "obsidianTOK" + Math.random().toString(36).slice(2, 8).toUpperCase()
  const makeTok = (kind: string, idx: number) => `${tokPrefix}${kind}${idx}Z`

  const mathHtml: string[] = []
  const mathDisplay: boolean[] = []
  const embeds: EmbedRef[] = []
  const attachments: AttachmentRef[] = []
  const wikiHtmls: string[] = []
  const tagValues: string[] = []

  const markedInstance = opts.strictLineBreaks ? markedStrictBreaks : markedSoftBreaks

  // 1a. Code-aware preprocessing per non-code segment: comments, standalone embeds, math, wikilinks
  let working = splitMarkdownCode(body)
    .map((part) => {
      if (part.code) return part.text
      let seg = part.text
      // obsidian %%comments%% (inline & multi-line)
      seg = seg.replace(/%%[\s\S]*?%%/g, "")
      // Standalone note/media embed lines
      seg = seg.replace(/(^|\n)[ \t]*(!\[\[[^\[\]\n]+?\]\])[ \t]*(?=\n|$)/g, (_m, lead: string, raw: string) => {
        const inner = raw.slice(3, -2)
        let target = inner
        let subpath: string | null = null
        let sizeAlias: string | null = null
        const pipe = inner.indexOf("|")
        if (pipe !== -1) {
          sizeAlias = inner.slice(pipe + 1).trim()
          target = inner.slice(0, pipe)
        }
        const hash = target.indexOf("#")
        if (hash !== -1) {
          subpath = target.slice(hash)
          target = target.slice(0, hash)
        }
        const file = resolveAttachment(target, renderContext.files)
        if (file) {
          const szMatch = sizeAlias ? sizeAlias.match(/^(\d+)(?:x(\d+))?$/i) : null
          attachments.push({
            file,
            size: szMatch ? parseInt(szMatch[1], 10) : null,
            height: szMatch?.[2] ? parseInt(szMatch[2], 10) : null,
          })
          return `${lead}\n\n${makeTok("ATTACH", attachments.length - 1)}\n\n`
        }
        embeds.push({ target: target.trim(), subpath })
        return `${lead}\n\n${makeTok("EMBED", embeds.length - 1)}\n\n`
      })
      // Math $$...$$ and $...$
      seg = replaceMathOutsideCode(seg, (tex, display) => {
        mathHtml.push(renderMath(tex, display))
        mathDisplay.push(display)
        return makeTok("MATH", mathHtml.length - 1)
      })
      // Inline wikilinks & attachment chips/images (protects [[a|b]] pipes inside GFM tables & #subpaths from tags!)
      seg = seg.replace(/(!?)\[\[([^\[\]\n]+?)\]\]/g, (_m, bang: string, inner: string) => {
        wikiHtmls.push(renderWikilinkToken(inner, bang === "!"))
        return makeTok("WIKI", wikiHtmls.length - 1)
      })
      return seg
    })
    .join("")

  // 1b. Footnote defs (outside code fences, supporting multi-line indented continuations)
  const defMap = new Map<string, string>()
  {
    const lines = working.split("\n")
    const outLines: string[] = []
    let fenceChar = ""
    let fenceLen = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const stripped = line.replace(/\r$/, "")
      if (!fenceChar) {
        const fm = stripped.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
        if (fm && (fm[1][0] !== "`" || !fm[2].includes("`"))) {
          fenceChar = fm[1][0]
          fenceLen = fm[1].length
          outLines.push(line)
          continue
        }
        const defMatch = stripped.match(/^[ \t]*\[\^([A-Za-z0-9_-]+)\]:[ \t]*(.*)$/)
        if (defMatch) {
          const key = defMatch[1]
          const bodyParts = [defMatch[2]]
          while (i + 1 < lines.length) {
            const nxt = lines[i + 1].replace(/\r$/, "")
            if (/^(?: {2,}|\t)/.test(nxt)) {
              bodyParts.push(nxt.replace(/^(?: {2,4}|\t)/, ""))
              i++
            } else if (nxt.trim() === "" && i + 2 < lines.length && /^(?: {2,}|\t)/.test(lines[i + 2].replace(/\r$/, ""))) {
              bodyParts.push("")
              i++
            } else {
              break
            }
          }
          defMap.set(key, bodyParts.join("\n").trim())
          continue
        }
        outLines.push(line)
      } else {
        const closeRe = new RegExp(`^ {0,3}${fenceChar === "~" ? "~" : "`"}{${fenceLen},}[ \\t]*$`)
        if (closeRe.test(stripped)) {
          fenceChar = ""
          fenceLen = 0
        }
        outLines.push(line)
      }
    }
    working = outLines.join("\n")
  }

  const usedFootnotes: { key: string; text: string }[] = []
  const usedFootnoteIdx = new Map<string, number>()
  if (defMap.size > 0) {
    working = replaceOutsideCode(working, /\[\^([A-Za-z0-9_-]+)\]/g, (m, key: string) => {
      const def = defMap.get(key)
      if (def === undefined) return m
      let idx = usedFootnoteIdx.get(key)
      if (idx === undefined) {
        idx = usedFootnotes.length
        usedFootnoteIdx.set(key, idx)
        usedFootnotes.push({ key, text: def })
      }
      return makeTok("FN", idx)
    })
  }

  // 1c. Tags outside code (with markdown link URLs temporarily masked so #anchors inside URLs aren't treated as tags)
  const mdHrefMasks: string[] = []
  const tagRe = new RegExp(TAG_RE.source, "gm")
  working = splitMarkdownCode(working)
    .map((part) => {
      if (part.code) return part.text
      const masked = part.text.replace(/(\[[^\]\n]*\]\()([^)\n]*)(\))/g, (_m, open: string, href: string, close: string) => {
        mdHrefMasks.push(href)
        return `${open}${makeTok("URL", mdHrefMasks.length - 1)}${close}`
      })
      const tagged = masked.replace(tagRe, (_m, lead: string, tag: string) => {
        tagValues.push(tag)
        return `${lead}${makeTok("TAG", tagValues.length - 1)}`
      })
      return tagged.replace(new RegExp(`${tokPrefix}URL(\\d+)Z`, "g"), (_m, i: string) => mdHrefMasks[parseInt(i, 10)] ?? "")
    })
    .join("")

  // 2. Render Markdown
  headingCounter = 0
  let html = markedInstance.parse(working) as string

  // 3. Post-process
  let taskCount = 0
  html = html.replace(/<li>(\s*(?:<p>)?\s*<input[^>]*type="checkbox")/gi, '<li class="task-list-item">$1')
  html = html.replace(/<input([^>]*?)type="checkbox"([^>]*?)>/g, (_m, a: string, b: string) => {
    return `<input${a}type="checkbox"${b} data-task="${taskCount++}">`
  })
  html = html.replace(/(<input[^>]*?) disabled(="")?/g, "$1")

  if (usedFootnotes.length > 0) {
    const items = usedFootnotes
      .map((f, i) => {
        const renderedText = markedInstance.parseInline(f.text) as string
        return `<li class="obs-footnote-item" id="fn-${i}">${renderedText}<a class="obs-footnote-backref" data-fn-back="${i}" href="#">↩︎</a></li>`
      })
      .join("")
    html += `<section class="obs-footnotes"><hr class="obs-footnote-sep"><ol class="obs-footnote-list">${items}</ol></section>`
  }

  // Restore inline tokens (wikilinks, tags, footnote refs, math)
  html = html.replace(new RegExp(`${tokPrefix}WIKI(\\d+)Z`, "g"), (_m, i: string) => wikiHtmls[parseInt(i, 10)] ?? "")
  html = html.replace(new RegExp(`${tokPrefix}TAG(\\d+)Z`, "g"), (_m, i: string) => {
    const tag = tagValues[parseInt(i, 10)] ?? ""
    return `<a class="tag" data-tag="${esc(tag)}" href="#">#${esc(tag)}</a>`
  })
  html = html.replace(new RegExp(`${tokPrefix}FN(\\d+)Z`, "g"), (_m, idxS: string) => {
    const idx = parseInt(idxS, 10)
    return `<sup class="obs-footnote-ref" id="fn-ref-${idx}" data-footnote="${idx}"><a href="#">${idx + 1}</a></sup>`
  })
  // Display math unwraps surrounding sole <p>...</p>; inline math NEVER strips <p>
  html = html.replace(new RegExp(`<p>\\s*${tokPrefix}MATH(\\d+)Z\\s*</p>|${tokPrefix}MATH(\\d+)Z`, "g"), (_m, pIdx?: string, iIdx?: string) => {
    if (pIdx !== undefined) {
      const idx = parseInt(pIdx, 10)
      const inner = mathHtml[idx] ?? ""
      return mathDisplay[idx] ? `<div class="obs-math-block">${inner}</div>` : `<p><span class="obs-math-inline">${inner}</span></p>`
    }
    const idx = parseInt(iIdx ?? "0", 10)
    const inner = mathHtml[idx] ?? ""
    return mathDisplay[idx] ? `<div class="obs-math-block">${inner}</div>` : `<span class="obs-math-inline">${inner}</span>`
  })
  html = sanitizeHtml(html)

  // 4. Split on embed + attachment markers
  const segments: RenderSegment[] = []
  const pushHtml = (h: string) => {
    if (h.trim() === "") return
    const last = segments[segments.length - 1]
    if (last && last.kind === "html") last.html += h
    else segments.push({ kind: "html", html: h })
  }
  const markerRe = new RegExp(`(?:<p>)?${tokPrefix}(EMBED|ATTACH)(\\d+)Z(?:<\\/p>)?`, "g")
  let lastIndex = 0
  for (const m of html.matchAll(markerRe)) {
    pushHtml(html.slice(lastIndex, m.index))
    const idx = parseInt(m[2], 10)
    if (m[1] === "ATTACH") {
      segments.push({ kind: "media", media: attachments[idx] ?? { file: null as never, size: null } })
    } else {
      segments.push({ kind: "embed", embed: embeds[idx] ?? { target: "?", subpath: null } })
    }
    lastIndex = (m.index ?? 0) + m[0].length
  }
  pushHtml(html.slice(lastIndex))

  return { segments, headings: [], taskCount, cssClasses, bodySource: body }
}

/** Plain-text version of markdown (for hover previews / fallbacks). */
export function markdownToPlainText(md: string): string {
  const { body } = parseFrontmatter(md)
  return body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, " [math] ")
    .replace(/\$([^$\n]+)\$/g, " [math] ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[\[([^\[\]|]+)(?:\|([^\[\]]*))?\]\]/g, (_m, target: string, alias?: string) => alias || target)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_~=]+/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
}
