// ─── Vault search grammar — shared by the web routes, desktop API, and Graph ─
// Operators (obsidian-compatible):
//   tag:#x  path:x  file:x  content:x  line:(a OR b)  task:  task-todo:  task-done:
//   [prop]  [prop:value]  [[wikilink]]  /regex/flags  "exact phrase"
//   a OR b  a b (AND)  -negation  (parentheses)
// `tag:` matches exact & nested children (tag:#project matches #project/alpha, NOT #project2).

import { parseFrontmatter } from "./frontmatter"
import { codeOrFmLineMask, extractLinks, extractMarkdownLinks } from "./links"

export type SearchAtom =
  | { kind: "term"; value: string; negate: boolean }
  | { kind: "tag"; value: string; negate: boolean }
  | { kind: "path"; value: string; negate: boolean }
  | { kind: "file"; value: string; negate: boolean }
  | { kind: "content"; value: string; negate: boolean }
  | { kind: "link"; value: string; negate: boolean }
  | { kind: "regex"; pattern: string; flags: string; negate: boolean }
  | { kind: "prop"; key: string; value?: string; negate: boolean }
  | { kind: "line"; expr: SearchExpr; negate: boolean }
  | { kind: "task"; status: "any" | "todo" | "done"; expr?: SearchExpr; negate: boolean }
  | { kind: "or"; atoms: SearchAtom[]; negate: boolean }
  | { kind: "and"; atoms: SearchAtom[]; negate: boolean }
  | { kind: "never"; negate: boolean }

export type SearchExpr = SearchAtom[]

const TASK_ANY_RE = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[([^\]]*)\](.*)$/
const LINE_OPS = ["line:", "task:", "task-todo:", "task-done:"]
const QUOTED_OPS = ["tag:", "path:", "file:", "content:"]

/** Tokenize a search query without splitting quoted values, regexes, [[links]], [props], or line:(...) groups. */
function tokenizeSearch(q: string): string[] {
  const tokens: string[] = []
  let i = 0
  const n = q.length
  const readQuoted = (): string => {
    let out = q[i++] // opening "
    while (i < n) {
      const ch = q[i++]
      out += ch
      if (ch === "\\" && i < n) {
        out += q[i++]
        continue
      }
      if (ch === '"') break
    }
    return out
  }
  const readParenGroup = (): string => {
    let depth = 0
    let out = ""
    while (i < n) {
      const ch = q[i]
      if (ch === '"') {
        out += readQuoted()
        continue
      }
      out += ch
      i++
      if (ch === "(") depth++
      else if (ch === ")") {
        depth--
        if (depth <= 0) break
      }
    }
    return out
  }
  while (i < n) {
    while (i < n && /\s/.test(q[i])) i++
    if (i >= n) break
    const ch = q[i]
    if (ch === "(" || ch === ")") {
      tokens.push(ch)
      i++
      continue
    }
    const rest = q.slice(i)
    const negPrefix = rest.startsWith("-") ? "-" : ""
    const afterNeg = negPrefix ? rest.slice(1) : rest
    const lowerAfter = afterNeg.toLowerCase()

    const lineOp = LINE_OPS.find((op) => lowerAfter.startsWith(op))
    if (lineOp) {
      const opLen = negPrefix.length + lineOp.length
      let tok = q.slice(i, i + opLen)
      i += opLen
      if (q[i] === "(") tok += readParenGroup()
      else if (q[i] === '"') tok += readQuoted()
      else {
        while (i < n && !/[\s()]/.test(q[i])) tok += q[i++]
      }
      tokens.push(tok)
      continue
    }

    const qOp = QUOTED_OPS.find((op) => lowerAfter.startsWith(op))
    if (qOp) {
      const opLen = negPrefix.length + qOp.length
      let tok = q.slice(i, i + opLen)
      i += opLen
      if (q[i] === '"') tok += readQuoted()
      else if (q[i] === "/") {
        tok += "/"
        i++
        while (i < n && q[i] !== "/") {
          if (q[i] === "\\" && i + 1 < n) tok += q[i++]
          tok += q[i++]
        }
        if (q[i] === "/") {
          tok += "/"
          i++
          while (i < n && /[gimsuy]/i.test(q[i])) tok += q[i++]
        }
      } else {
        while (i < n && !/[\s()]/.test(q[i])) tok += q[i++]
      }
      tokens.push(tok)
      continue
    }

    if (afterNeg.startsWith('"')) {
      let tok = ""
      if (negPrefix) {
        tok = "-"
        i++
      }
      tok += readQuoted()
      tokens.push(tok)
      continue
    }

    if (afterNeg.startsWith("[[")) {
      let tok = ""
      if (negPrefix) {
        tok = "-"
        i++
      }
      const close = q.indexOf("]]", i + 2)
      if (close !== -1) {
        tok += q.slice(i, close + 2)
        i = close + 2
        tokens.push(tok)
        continue
      }
    }

    if (afterNeg.startsWith("[")) {
      let tok = ""
      if (negPrefix) {
        tok = "-"
        i++
      }
      tok += q[i++]
      while (i < n && q[i] !== "]") {
        if (q[i] === '"') tok += readQuoted()
        else tok += q[i++]
      }
      if (q[i] === "]") tok += q[i++]
      tokens.push(tok)
      continue
    }

    if (afterNeg.startsWith("/")) {
      const startRegex = i + negPrefix.length + 1
      let j = startRegex
      let foundClose = false
      while (j < n) {
        if (q[j] === "\\") {
          j += 2
          continue
        }
        if (q[j] === "/") {
          foundClose = true
          j++
          while (j < n && /[gimsuy]/i.test(q[j])) j++
          break
        }
        if (q[j] === "\n" || q[j] === "\r") break
        j++
      }
      if (foundClose && j > startRegex + 1) {
        tokens.push(q.slice(i, j))
        i = j
        continue
      }
    }

    let tok = ""
    while (i < n && !/[\s()]/.test(q[i])) {
      if (q[i] === '"') tok += readQuoted()
      else tok += q[i++]
    }
    if (tok) tokens.push(tok)
  }
  return tokens
}

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\(["\\])/g, "$1")
  }
  return s
}

function parseTokens(tokens: string[]): SearchExpr {
  let pos = 0

  function parseOrExpr(): SearchAtom[] {
    const out: SearchAtom[] = []
    while (pos < tokens.length && tokens[pos] !== ")") {
      const first = parseAndSequence()
      if (!first) break
      if (pos < tokens.length && tokens[pos].toUpperCase() === "OR") {
        const alternatives: SearchAtom[] = [first]
        while (pos < tokens.length && tokens[pos].toUpperCase() === "OR") {
          pos++
          if (pos >= tokens.length || tokens[pos] === ")") {
            alternatives.push({ kind: "never", negate: false })
            break
          }
          const rhs = parseAndSequence()
          alternatives.push(rhs ?? { kind: "never", negate: false })
        }
        out.push({ kind: "or", atoms: alternatives, negate: false })
      } else {
        out.push(first)
      }
    }
    return out
  }

  function parseAndSequence(): SearchAtom | null {
    const group: SearchAtom[] = []
    while (pos < tokens.length && tokens[pos] !== ")" && tokens[pos].toUpperCase() !== "OR") {
      group.push(parseUnary())
    }
    if (group.length === 0) return null
    if (group.length === 1) return group[0]
    return { kind: "and", atoms: group, negate: false }
  }

  function parseUnary(): SearchAtom {
    let negate = false
    if (pos < tokens.length && tokens[pos] === "-") {
      negate = true
      pos++
    }
    if (pos >= tokens.length || tokens[pos] === ")") {
      return { kind: "never", negate }
    }
    let t = tokens[pos]
    if (t === "(") {
      pos++
      const inner = parseOrExpr()
      if (tokens[pos] === ")") pos++
      if (inner.length === 0) return { kind: "never", negate }
      if (inner.length === 1) return negate ? { ...inner[0], negate: !inner[0].negate } : inner[0]
      return { kind: "and", atoms: inner, negate }
    }
    pos++
    if (t.toUpperCase() === "OR") {
      return { kind: "never", negate }
    }
    if (t.startsWith("-") && t.length > 1) {
      negate = !negate
      t = t.slice(1)
    }
    const lower = t.toLowerCase()
    if (lower.startsWith("tag:")) return { kind: "tag", value: unquote(t.slice(4)), negate }
    if (lower.startsWith("path:")) return { kind: "path", value: unquote(t.slice(5)), negate }
    if (lower.startsWith("file:")) return { kind: "file", value: unquote(t.slice(5)), negate }
    if (lower.startsWith("content:")) return { kind: "content", value: unquote(t.slice(8)), negate }
    if (lower.startsWith("line:")) {
      const raw = t.slice(5)
      const inner = raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1) : raw
      const subTokens = tokenizeSearch(inner)
      const expr = subTokens.length > 0 ? parseTokens(subTokens) : []
      if (expr.length > 0) return { kind: "line", expr, negate }
      return { kind: "never", negate }
    }
    if (lower === "task:" || lower.startsWith("task:")) {
      const raw = t.slice(5)
      if (!raw) return { kind: "task", status: "any", negate }
      const inner = raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1) : raw
      const subTokens = tokenizeSearch(inner)
      const expr = subTokens.length > 0 ? parseTokens(subTokens) : []
      return { kind: "task", status: "any", expr: expr.length > 0 ? expr : [{ kind: "never", negate: false }], negate }
    }
    if (lower === "task-todo:" || lower.startsWith("task-todo:")) {
      const raw = t.slice(10)
      if (!raw) return { kind: "task", status: "todo", negate }
      const inner = raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1) : raw
      const subTokens = tokenizeSearch(inner)
      const expr = subTokens.length > 0 ? parseTokens(subTokens) : []
      return { kind: "task", status: "todo", expr: expr.length > 0 ? expr : [{ kind: "never", negate: false }], negate }
    }
    if (lower === "task-done:" || lower.startsWith("task-done:")) {
      const raw = t.slice(10)
      if (!raw) return { kind: "task", status: "done", negate }
      const inner = raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1) : raw
      const subTokens = tokenizeSearch(inner)
      const expr = subTokens.length > 0 ? parseTokens(subTokens) : []
      return { kind: "task", status: "done", expr: expr.length > 0 ? expr : [{ kind: "never", negate: false }], negate }
    }
    if (t.startsWith("[[") && t.endsWith("]]") && t.length > 4) {
      return { kind: "link", value: t.slice(2, -2).split("|")[0].split("#")[0].trim(), negate }
    }
    if (t.startsWith("[") && t.endsWith("]") && t.length > 2) {
      const inner = t.slice(1, -1)
      const colon = inner.indexOf(":")
      if (colon === -1) return { kind: "prop", key: unquote(inner.trim()), negate }
      const key = unquote(inner.slice(0, colon).trim())
      const value = unquote(inner.slice(colon + 1).trim())
      return { kind: "prop", key, value, negate }
    }
    const regexMatch = t.match(/^\/(.+)\/([gimsuy]*)$/)
    if (regexMatch) {
      return { kind: "regex", pattern: regexMatch[1], flags: regexMatch[2].replace(/[gy]/g, ""), negate }
    }
    const val = unquote(t)
    if (!val) return { kind: "never", negate }
    return { kind: "term", value: val, negate }
  }

  return parseOrExpr()
}

export function parseSearchQuery(q: string): SearchExpr {
  const trimmed = q.trim()
  if (!trimmed) return []
  const tokens = tokenizeSearch(trimmed)
  if (tokens.length === 0) return []
  const parsed = parseTokens(tokens)
  return parsed.length > 0 ? parsed : [{ kind: "never", negate: false }]
}

export interface SearchEvalCtx {
  content: string
  name: string
  path: string
  tags: string[]
  caseSensitive: boolean
  frontmatter?: Record<string, unknown>
}

/** Does `tag` equal `value` or is it nested under it (#project matches #project/a, NOT #project2)? */
function tagMatches(tag: string, value: string): boolean {
  return tag === value || tag.startsWith(value + "/")
}

export function compileSearchRegex(pattern: string, flags: string, caseSensitive: boolean): RegExp | null {
  try {
    let f = flags.replace(/[gy]/g, "")
    if (!caseSensitive && !f.includes("i")) f += "i"
    return new RegExp(pattern, f)
  } catch {
    return null
  }
}

function matchSingleLineAtom(atom: SearchAtom, line: string, cs: (s: string) => string, caseSensitive: boolean): boolean {
  let result = false
  switch (atom.kind) {
    case "never":
      result = false
      break
    case "term":
    case "content":
      result = atom.value !== "" && cs(line).includes(cs(atom.value))
      break
    case "tag": {
      const v = cs(atom.value.replace(/^#/, ""))
      result = v !== "" && (cs(line).includes("#" + v) || cs(line).includes(v))
      break
    }
    case "link": {
      const v = cs(atom.value)
      result = cs(line).includes(`[[${v}`) || cs(line).includes(`](${v}`)
      break
    }
    case "regex": {
      const re = compileSearchRegex(atom.pattern, atom.flags, caseSensitive)
      result = re ? re.test(line) : false
      break
    }
    case "or":
      result = atom.atoms.some((a) => matchSingleLineAtom(a, line, cs, caseSensitive))
      break
    case "and":
      result = atom.atoms.every((a) => matchSingleLineAtom(a, line, cs, caseSensitive))
      break
    default:
      result = false
  }
  return atom.negate ? !result : result
}

function matchPropertyAtom(key: string, value: string | undefined, fm: Record<string, unknown>, caseSensitive: boolean): boolean {
  const cs = (s: string) => (caseSensitive ? s : s.toLowerCase())
  const targetKey = cs(key)
  const entry = Object.entries(fm).find(([k]) => cs(k) === targetKey)
  if (!entry) return false
  if (value === undefined) return true
  const targetVal = cs(value)
  const rawVal = entry[1]
  if (Array.isArray(rawVal)) {
    return rawVal.some((item) => cs(String(item)) === targetVal || cs(String(item)).includes(targetVal))
  }
  if (rawVal === null || rawVal === undefined) return targetVal === ""
  return cs(String(rawVal)) === targetVal || cs(String(rawVal)).includes(targetVal)
}

export function matchSearchAtom(atom: SearchAtom, ctx: SearchEvalCtx): boolean {
  const cs = (s: string) => (ctx.caseSensitive ? s : s.toLowerCase())
  const content = cs(ctx.content)
  const name = cs(ctx.name)
  const path = cs(ctx.path)
  const tagList = ctx.tags.map((t) => cs(t))
  let result = false
  switch (atom.kind) {
    case "never":
      result = false
      break
    case "term":
      result =
        atom.value !== "" &&
        (content.includes(cs(atom.value)) || name.includes(cs(atom.value)) || path.includes(cs(atom.value)))
      break
    case "content":
      result = atom.value !== "" && content.includes(cs(atom.value))
      break
    case "tag": {
      const v = cs(atom.value.replace(/^#/, ""))
      result = v !== "" ? tagList.some((t) => tagMatches(t, v)) : tagList.length > 0
      break
    }
    case "path":
      result = path.includes(cs(atom.value))
      break
    case "file":
      result = name.includes(cs(atom.value))
      break
    case "link": {
      const target = cs(atom.value)
      const links = [...extractLinks(ctx.content), ...extractMarkdownLinks(ctx.content)]
      result = links.some((l) => {
        const lt = cs(l.target)
        const base = lt.split("/").pop()?.replace(/\.(md|markdown)$/i, "") ?? lt
        return lt === target || base === target || lt.endsWith("/" + target)
      })
      break
    }
    case "regex": {
      const re = compileSearchRegex(atom.pattern, atom.flags, ctx.caseSensitive)
      result = re ? re.test(ctx.content) : false
      break
    }
    case "prop": {
      const fm = ctx.frontmatter ?? parseFrontmatter(ctx.content).data
      result = matchPropertyAtom(atom.key, atom.value, fm, ctx.caseSensitive)
      break
    }
    case "line": {
      const lines = ctx.content.split(/\r?\n/)
      result = lines.some((line) => atom.expr.every((sub) => matchSingleLineAtom(sub, line, cs, ctx.caseSensitive)))
      break
    }
    case "task": {
      const lines = ctx.content.split(/\r?\n/)
      const masked = codeOrFmLineMask(ctx.content)
      result = lines.some((line, idx) => {
        if (masked[idx]) return false
        const m = line.match(TASK_ANY_RE)
        if (!m) return false
        const box = m[1]
        const text = m[2]
        if (atom.status === "todo" && box !== " ") return false
        if (atom.status === "done" && (box === " " || box === "")) return false
        if (!atom.expr) return true
        return atom.expr.every((sub) => matchSingleLineAtom(sub, text, cs, ctx.caseSensitive))
      })
      break
    }
    case "or":
      result = atom.atoms.some((a) => matchSearchAtom(a, ctx))
      break
    case "and":
      result = atom.atoms.every((a) => matchSearchAtom(a, ctx))
      break
  }
  return atom.negate ? !result : result
}

/** Every atom of the expression must match (AND), like obsidian. */
export function matchSearchExpr(expr: SearchExpr, ctx: SearchEvalCtx): boolean {
  return expr.every((atom) => matchSearchAtom(atom, ctx))
}

function collectPositiveTerms(atom: SearchAtom, out: string[]): void {
  if (atom.negate) return
  if ((atom.kind === "term" || atom.kind === "content" || atom.kind === "link") && atom.value !== "") {
    out.push(atom.value)
    return
  }
  if (atom.kind === "and" || atom.kind === "or") {
    for (const sub of atom.atoms) collectPositiveTerms(sub, out)
    return
  }
  if (atom.kind === "line") {
    for (const sub of atom.expr) collectPositiveTerms(sub, out)
    return
  }
  if (atom.kind === "task" && atom.expr) {
    for (const sub of atom.expr) collectPositiveTerms(sub, out)
  }
}

/** Recursively collect positive text terms — used for snippet extraction & highlighting. */
export function searchTerms(expr: SearchExpr): string[] {
  const out: string[] = []
  for (const a of expr) collectPositiveTerms(a, out)
  return [...new Set(out)]
}

function collectPositiveRegexes(atom: SearchAtom, out: Array<{ pattern: string; flags: string }>): void {
  if (atom.negate) return
  if (atom.kind === "regex") {
    out.push({ pattern: atom.pattern, flags: atom.flags })
    return
  }
  if (atom.kind === "and" || atom.kind === "or") {
    for (const sub of atom.atoms) collectPositiveRegexes(sub, out)
    return
  }
  if (atom.kind === "line") {
    for (const sub of atom.expr) collectPositiveRegexes(sub, out)
    return
  }
  if (atom.kind === "task" && atom.expr) {
    for (const sub of atom.expr) collectPositiveRegexes(sub, out)
  }
}

/** Recursively collect positive regex atoms for snippet extraction. */
export function searchRegexes(expr: SearchExpr): Array<{ pattern: string; flags: string }> {
  const out: Array<{ pattern: string; flags: string }> = []
  for (const a of expr) collectPositiveRegexes(a, out)
  return out
}
