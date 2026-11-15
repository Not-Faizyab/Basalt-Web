// ─── YAML frontmatter handling + obsidian-style property typing ─────────────
import { load as yamlLoad, dump as yamlDump } from "js-yaml"
import type { PropertyInfo, PropertyType } from "./types"

export type { PropertyInfo, PropertyType } from "./types"

export interface FrontmatterResult {
  data: Record<string, unknown>
  body: string
  hasFrontmatter: boolean
  invalidYaml?: boolean
  eol?: "\r\n" | "\n"
  rawGap?: string
}

const FM_RE = /^---(\r?\n)(?:([\s\S]*?)\r?\n)?---((?:\r?\n)*)/

export function parseFrontmatter(content: string): FrontmatterResult {
  const m = content.match(FM_RE)
  if (!m) {
    const eol: "\r\n" | "\n" = content.includes("\r\n") ? "\r\n" : "\n"
    return { data: {}, body: content, hasFrontmatter: false, eol, rawGap: "" }
  }
  const eol: "\r\n" | "\n" = m[1] === "\r\n" ? "\r\n" : "\n"
  const rawYaml = m[2] ?? ""
  const rawGap = m[3] ?? ""
  let data: Record<string, unknown> = {}
  let valid = false
  let invalidYaml = false
  try {
    const parsed = rawYaml.trim() === "" ? null : yamlLoad(rawYaml)
    if (parsed == null) {
      // `---\n---` (empty) is valid empty frontmatter
      valid = true
    } else if (typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>
      valid = true
    } else {
      invalidYaml = true
    }
    // scalars, arrays and anything else are NOT properties — treat the whole
    // `--- … ---` region as body text so it stays visible and editable
  } catch {
    // unparseable YAML: keep it visible as body text instead of hiding it
    invalidYaml = true
  }
  if (!valid) return { data: {}, body: content, hasFrontmatter: false, invalidYaml, eol, rawGap: "" }
  return { data, body: content.slice(m[0].length), hasFrontmatter: true, eol, rawGap }
}

export function serializeFrontmatter(data: Record<string, unknown>, eol: "\r\n" | "\n" = "\n"): string {
  if (Object.keys(data).length === 0) return ""
  const dumped = yamlDump(data, { lineWidth: 1000, quoteStyle: "double" }).trimEnd().replace(/\r?\n/g, eol)
  return `---${eol}${dumped}${eol}---${eol}`
}

const LIST_PROPERTY_KEYS = new Set(["tags", "tag", "aliases", "alias", "cssclasses"])

export function inferPropertyType(value: unknown, key?: string): PropertyType {
  if (key && LIST_PROPERTY_KEYS.has(key.toLowerCase())) return "list"
  if (typeof value === "boolean") return "checkbox"
  if (typeof value === "number") return "number"
  if (Array.isArray(value)) return "list"
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date"
    return "text"
  }
  return "text"
}

export function valueToProperty(key: string, value: unknown): PropertyInfo {
  const type = inferPropertyType(value, key)
  const normVal =
    type === "list" && typeof value === "string"
      ? value
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : value
  return { key, type, value: normVal, inferred: true }
}

export function getProperties(data: Record<string, unknown>): PropertyInfo[] {
  return Object.entries(data)
    .filter(([k]) => k.trim() !== "")
    .map(([k, v]) => valueToProperty(k, v))
}

export function coerceValue(type: PropertyType, raw: string): unknown {
  switch (type) {
    case "number": {
      const n = parseFloat(raw)
      return isNaN(n) ? null : n
    }
    case "checkbox":
      return raw === "true" || raw === "on" || raw === "yes"
    case "list":
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "")
    case "date":
      return raw.trim()
    default:
      return raw
  }
}

export function propertiesToData(props: PropertyInfo[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of props) {
    if (p.key.trim() === "") continue
    out[p.key] = p.value
  }
  return out
}
