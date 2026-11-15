// ─────────────────────────────────────────────────────────────────────────────
// Desktop server API — implements the exact same operation surface as the web
// app's Next.js API routes, but backed by a real folder of .md files on disk.
//
// The web renderer (src/obsidian/**) is bundled unchanged; its `api` client is
// swapped for an IPC shim that calls `dispatch(op, args, ctx)` here.
//
// Semantics mirror the web routes 1:1 (unique-name guards, 409-style errors,
// search grammar, graph/backlink computation) with two desktop upgrades that
// match obsidian itself:
//   • renames / moves automatically rewrite every [[wikilink]] that pointed
//     at the moved note (shortest-path style, like obsidian's default)
//   • deletes go through the host's `trash` hook (Recycle Bin on Windows)
//
// IDs are vault-relative paths:
//   vault id  = absolute folder path   (e.g. C:\Users\me\Notes)
//   folder id = relative dir path      (e.g. "Projects" — root is `null`)
//   note id   = relative file path     (e.g. "Projects/Ideas.md")
// This keeps ids stable across restarts and makes every id a real file.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fsp } from "fs"
import fsSync from "fs"
import path from "path"
import { randomUUID } from "crypto"
import type {
  BacklinkMatch,
  BacklinksData,
  BookmarkItem,
  FolderNode,
  GraphData,
  GraphLink,
  GraphNode,
  IndexEntry,
  NoteDoc,
  NoteMeta,
  SearchHit,
  SearchResult,
  TagCount,
  TreeData,
  VaultFileMeta,
  VaultSummary,
} from "@/lib/obsidian/types"
import type { AppSettings } from "@/lib/obsidian/settings"
import { parseCanvas, serializeCanvas } from "@/lib/obsidian/types"
import { compileSearchRegex, matchSearchExpr, parseSearchQuery, searchRegexes, searchTerms } from "@/lib/obsidian/search"
import { DEFAULT_SETTINGS, mergeSettings } from "@/lib/obsidian/settings"
import { WIKILINK_RE, buildIndexMap, extractLinks, extractTags, isInsideLinkOrCode, makeSnippet, resolveLink, stripCode } from "@/lib/obsidian/links"
import { parseFrontmatter } from "@/lib/obsidian/frontmatter"

// ─── Host-injected dependencies ─────────────────────────────────────────────

export interface DesktopApiDeps {
  /** Folder where the vault registry + global settings live (Electron userData). */
  configDir: string
  /**
   * Ask the user where a new vault should live. Returns the folder to register
   * (already created) or null when the user canceled. The host shows native
   * dialogs: "create `<name>` inside a chosen parent" or "open existing folder".
   */
  createVaultFolder: (name: string) => Promise<{ root: string; name: string } | null>
  /** Send a path to the OS trash (Recycle Bin). */
  trash: (absPath: string) => Promise<void>
}

export interface Ctx {
  vaultId?: string
}

// ─── Constants / helpers ─────────────────────────────────────────────────────

const IGNORED_NAMES = new Set([
  "node_modules",
  "$RECYCLE.BIN",
  "System Volume Information",
  "Thumbs.db",
])
const MD_EXT = /\.(md|markdown)$/i
const CANVAS_EXT = /\.canvas$/i
const CONFIG_DIR = ".obsidian"
const SNAPSHOT_DIR = path.join(CONFIG_DIR, "snapshots")
const MAX_SNAPSHOTS_PER_FILE = 20
const WINDOWS_RESERVED = new Set(
  ["CON", "PRN", "AUX", "NUL", ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)],
)

function nowIso(): string {
  return new Date().toISOString()
}

function samePath(a: string, b: string): boolean {
  const ra = path.resolve(a)
  const rb = path.resolve(b)
  return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb
}

function sameRel(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
}

function sanitizeName(raw: string, fallback: string, isNote: boolean): string {
  let n = (raw || "").trim()
  if (isNote) n = n.replace(MD_EXT, "").replace(CANVAS_EXT, "")
  n = n.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").replace(/^\.+/, "").replace(/[. ]+$/g, "")
  if (!n || n === "." || n === "..") n = fallback
  if (WINDOWS_RESERVED.has(n.toUpperCase())) n = "_" + n
  return n.slice(0, 150)
}

/** Vault-relative path id → safe relative path (guards against escape & null bytes). */
function normalizeRel(id: string): string {
  const raw = String(id ?? "")
  if (raw.includes("\0")) throw new Error("Invalid path")
  const rel = raw.replace(/\\/g, "/").replace(/^\/+/, "")
  if (!rel) return ""
  const segs = rel.split("/").filter((s) => s.length > 0)
  for (const s of segs) {
    if (s === "." || s === "..") throw new Error("Invalid path")
  }
  return segs.join("/")
}

function resolveRealpathOrAncestor(target: string): string {
  const resolved = path.resolve(target)
  const tail: string[] = []
  let cur = resolved
  while (!fsSync.existsSync(cur)) {
    const parent = path.dirname(cur)
    if (parent === cur) return resolved
    tail.unshift(path.basename(cur))
    cur = parent
  }
  try {
    const real = fsSync.realpathSync(cur)
    return tail.length > 0 ? path.join(real, ...tail) : real
  } catch {
    return resolved
  }
}

function isInsideDir(root: string, target: string): boolean {
  const r = path.resolve(root)
  const t = path.resolve(target)
  const normRoot = r.endsWith(path.sep) ? r : r + path.sep
  if (process.platform === "win32") {
    return t.toLowerCase() === r.toLowerCase() || t.toLowerCase().startsWith(normRoot.toLowerCase())
  }
  return t === r || t.startsWith(normRoot)
}

function absOf(root: string, rel: string): string {
  const clean = normalizeRel(rel)
  const resolvedRoot = path.resolve(root)
  const abs = path.resolve(resolvedRoot, "." + path.sep + clean)
  if (!isInsideDir(resolvedRoot, abs)) throw new Error("Path escapes vault")
  const realRoot = resolveRealpathOrAncestor(resolvedRoot)
  const realTarget = resolveRealpathOrAncestor(abs)
  if (!isInsideDir(realRoot, realTarget)) throw new Error("Path escapes vault")
  return abs
}

function dirOf(rel: string): string {
  const i = rel.lastIndexOf("/")
  return i === -1 ? "" : rel.slice(0, i)
}

function baseOf(rel: string): string {
  const i = rel.lastIndexOf("/")
  return i === -1 ? rel : rel.slice(i + 1)
}

function stripMd(rel: string): string {
  return rel.replace(MD_EXT, "").replace(CANVAS_EXT, "")
}

function joinRel(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

/** Natural sort comparator (like the file explorer / obsidian). */
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
}

// ─── Registry / settings persistence ─────────────────────────────────────────

interface RegistryEntry {
  id: string // absolute vault root
  name: string
  createdAt: string
  updatedAt: string
}
interface Registry {
  vaults: RegistryEntry[]
}

export class DesktopApiError extends Error {}

export function createServerApi(deps: DesktopApiDeps) {
  const registryPath = () => path.join(deps.configDir, "vault-registry.json")
  const settingsPath = () => path.join(deps.configDir, "settings.json")

  async function readJson(file: string): Promise<unknown> {
    try {
      return JSON.parse(await fsp.readFile(file, "utf8"))
    } catch {
      return null
    }
  }
  async function writeJson(file: string, obj: unknown): Promise<void> {
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${randomUUID()}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), "utf8")
    await fsp.rename(tmp, file)
  }

  function vaultKey(root: string): string {
    const resolved = path.resolve(root)
    return process.platform === "win32" ? resolved.toLowerCase() : resolved
  }

  // Per-vault mutation queue to serialize rename/move/create/delete writes
  const vaultLocks = new Map<string, Promise<unknown>>()
  const activeWrites = new Map<string, number>()
  const walkInflight = new Map<string, Promise<unknown>>()

  function withVaultLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
    const key = vaultKey(root)
    const prev = vaultLocks.get(key) ?? Promise.resolve()
    const run = async () => {
      activeWrites.set(key, (activeWrites.get(key) ?? 0) + 1)
      walkInflight.delete(key)
      try {
        return await fn()
      } finally {
        walkInflight.delete(key)
        const left = (activeWrites.get(key) ?? 1) - 1
        if (left <= 0) activeWrites.delete(key)
        else activeWrites.set(key, left)
      }
    }
    const next = prev.then(run, run)
    vaultLocks.set(
      key,
      next.catch(() => undefined),
    )
    return next
  }

  async function readRegistry(): Promise<Registry> {
    const raw = (await readJson(registryPath())) as Registry | null
    if (!raw || !Array.isArray(raw.vaults)) return { vaults: [] }
    return raw
  }
  async function writeRegistry(reg: Registry): Promise<void> {
    await writeJson(registryPath(), reg)
  }

  // ── Vault walk + content cache ───────────────────────────────────────────

  interface DirRow {
    rel: string
    name: string
    parentRel: string | null
    position: number
  }
  interface NoteRow {
    rel: string
    name: string
    dirRel: string
    content: string
    mtimeMs: number
    size: number
    createdAt: string
    updatedAt: string
  }
  interface WalkResult {
    dirs: DirRow[]
    notes: NoteRow[]
    files: VaultFileMeta[]
  }

  // root → (rel → cached content keyed by mtime+size)
  const contentCache = new Map<string, Map<string, { mtimeMs: number; size: number; content: string }>>()

  function cacheOf(root: string): Map<string, { mtimeMs: number; size: number; content: string }> {
    const key = process.platform === "win32" ? path.resolve(root).toLowerCase() : path.resolve(root)
    let c = contentCache.get(key)
    if (!c) {
      c = new Map()
      contentCache.set(key, c)
    }
    return c
  }

  async function statSafe(abs: string): Promise<fsSync.Stats | null> {
    try {
      return await fsp.stat(abs)
    } catch {
      return null
    }
  }

  async function assertVault(vaultId: string | undefined): Promise<string> {
    if (!vaultId) throw new DesktopApiError("No vault open")
    const root = path.resolve(vaultId)
    const reg = await readRegistry()
    if (!reg.vaults.some((v) => samePath(v.id, root))) {
      throw new DesktopApiError("Vault is not registered")
    }
    const st = await statSafe(root)
    if (!st || !st.isDirectory()) throw new DesktopApiError("Vault folder not found")
    return root
  }

  /** Deduplicated vault walk: shares concurrent read walks when no write is active. */
  function walkVault(root: string): Promise<WalkResult> {
    const key = vaultKey(root)
    if ((activeWrites.get(key) ?? 0) > 0) {
      return walkVaultUncached(root)
    }
    const existing = walkInflight.get(key) as Promise<WalkResult> | undefined
    if (existing) return existing
    const p = walkVaultUncached(root).finally(() => {
      if (walkInflight.get(key) === p) walkInflight.delete(key)
    })
    walkInflight.set(key, p)
    return p
  }

  /** Full walk: folders + notes (md/canvas) + attachment files (contents cached by mtime+size). */
  async function walkVaultUncached(root: string): Promise<WalkResult> {
    const cache = cacheOf(root)
    const dirs: { rel: string; name: string }[] = []
    const rawNotes: { rel: string; name: string; mtimeMs: number; size: number; birthMs: number }[] = []
    const rawFiles: { rel: string; name: string; ext: string; size: number; mtimeMs: number }[] = []

    async function walk(relDir: string): Promise<void> {
      let entries: fsSync.Dirent[]
      try {
        entries = await fsp.readdir(absOf(root, relDir), { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (e.name.startsWith(".") || IGNORED_NAMES.has(e.name)) continue
        const rel = joinRel(relDir, e.name)
        if (e.isDirectory()) {
          dirs.push({ rel, name: e.name })
          await walk(rel)
        } else if (e.isFile() && (MD_EXT.test(e.name) || CANVAS_EXT.test(e.name))) {
          const st = await statSafe(absOf(root, rel))
          if (!st) continue
          rawNotes.push({
            rel,
            name: e.name.replace(MD_EXT, "").replace(CANVAS_EXT, ""),
            mtimeMs: st.mtimeMs,
            size: st.size,
            birthMs: st.birthtimeMs && st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs,
          })
        } else if (e.isFile()) {
          const st = await statSafe(absOf(root, rel))
          if (!st) continue
          rawFiles.push({
            rel,
            name: e.name.replace(/\.[^.]+$/, ""),
            ext: e.name.includes(".") ? e.name.slice(e.name.lastIndexOf(".") + 1).toLowerCase() : "",
            size: st.size,
            mtimeMs: st.mtimeMs,
          })
        }
      }
    }
    await walk("")

    rawNotes.sort((a, b) => naturalCompare(a.rel, b.rel))
    dirs.sort((a, b) => naturalCompare(a.rel, b.rel))
    rawFiles.sort((a, b) => naturalCompare(a.rel, b.rel))

    // read (or reuse) contents
    const notes: NoteRow[] = []
    for (const n of rawNotes) {
      const hit = cache.get(n.rel)
      let content: string
      if (hit && hit.mtimeMs === n.mtimeMs && hit.size === n.size) {
        content = hit.content
      } else {
        try {
          content = await fsp.readFile(absOf(root, n.rel), "utf8")
        } catch {
          content = ""
        }
        cache.set(n.rel, { mtimeMs: n.mtimeMs, size: n.size, content })
      }
      notes.push({
        rel: n.rel,
        name: n.name,
        dirRel: dirOf(n.rel),
        content,
        mtimeMs: n.mtimeMs,
        size: n.size,
        createdAt: new Date(n.birthMs).toISOString(),
        updatedAt: new Date(n.mtimeMs).toISOString(),
      })
    }
    // prune cache entries that no longer exist
    const live = new Set(notes.map((n) => n.rel))
    for (const key of [...cache.keys()]) if (!live.has(key)) cache.delete(key)

    // folder rows with positions (alphabetical inside each parent)
    const dirRows: DirRow[] = []
    let i = 0
    while (i < dirs.length) {
      const parent = dirOf(dirs[i].rel)
      let j = i
      while (j < dirs.length && dirOf(dirs[j].rel) === parent) j++
      for (let k = i; k < j; k++) {
        dirRows.push({ ...dirs[k], parentRel: parent || null, position: k - i })
      }
      i = j
    }
    // NoteMeta.position is derived per-folder when building metas; keep rows plain.
    const files: VaultFileMeta[] = rawFiles.map((f) => ({
      id: f.rel,
      vaultId: root,
      folderId: dirOf(f.rel) || null,
      name: f.name,
      ext: f.ext,
      size: f.size,
      updatedAt: new Date(f.mtimeMs).toISOString(),
    }))
    return { dirs: dirRows, notes, files }
  }

  function notePosition(rows: NoteRow[], index: number): number {
    const folder = rows[index].dirRel
    let pos = 0
    for (let i = 0; i <= index; i++) if (rows[i].dirRel === folder) pos++
    return pos - 1
  }

  function toNoteMetas(root: string, notes: NoteRow[]): NoteMeta[] {
    return notes.map((n, i) => ({
      id: n.rel,
      vaultId: root,
      folderId: n.dirRel || null,
      name: n.name,
      path: n.rel.replace(MD_EXT, "").replace(CANVAS_EXT, ""),
      position: notePosition(notes, i),
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    }))
  }

  /** The link index (names, paths, aliases, tags) — same shape as the web app.
   *  .canvas files are included (kind: "canvas") so they are linkable and
   *  searchable, exactly like obsidian. */
  function buildIndexEntries(notes: NoteRow[]): IndexEntry[] {
    return notes.map((n) => {
      const isCanvas = CANVAS_EXT.test(n.rel)
      if (isCanvas) {
        return {
          id: n.rel,
          name: n.name,
          path: n.rel.replace(CANVAS_EXT, ""),
          aliases: [] as string[],
          tags: [] as string[],
          kind: "canvas" as const,
        }
      }
      const fm = parseFrontmatter(n.content)
      const aliases = Array.isArray(fm.data.aliases)
        ? fm.data.aliases.filter((a): a is string => typeof a === "string")
        : typeof fm.data.aliases === "string"
          ? [fm.data.aliases]
          : []
      return {
        id: n.rel,
        name: n.name,
        path: stripMd(n.rel),
        aliases,
        tags: extractTags(n.content),
        kind: "note" as const,
      }
    })
  }

  // ── Atomic file write + cache update ────────────────────────────────────

  async function writeFileAtomic(abs: string, content: string): Promise<void> {
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    const tmp = `${abs}.${randomUUID()}.obsidian-tmp`
    await fsp.writeFile(tmp, content, "utf8")
    await fsp.rename(tmp, abs)
  }

  async function writeCachedNote(root: string, abs: string, rel: string, content: string): Promise<void> {
    await writeFileAtomic(abs, content)
    const st = await statSafe(abs)
    cacheOf(root).set(rel, {
      mtimeMs: st?.mtimeMs ?? Date.now(),
      size: st?.size ?? Buffer.byteLength(content, "utf8"),
      content,
    })
  }

  // ── Link rewriting (obsidian-style "update internal links") ──────────────

  interface Move {
    from: string
    to: string
  }

  /**
   * Rewrite every wikilink / md-link that resolved (against the pre-move index)
   * to one of the moved notes. Skips code blocks/inline code/frontmatter, preserves
   * both #heading/^block and |alias together, and handles explicit folder paths.
   */
  function rewriteLinksInContent(
    content: string,
    maps: ReturnType<typeof buildIndexMap>,
    moves: Move[],
    allAfterBasenames?: Map<string, number>,
  ): { content: string; count: number } {
    if (moves.length === 0) return { content, count: 0 }
    const moveByOldId = new Map(moves.map((m) => [m.from, m]))
    const stripped = stripCode(content)
    let count = 0

    // Wikilinks: [[target]], [[target#h|alias]], [[target^b]], ![[...]]
    let out = content.replace(/(!?)\[\[([^\[\]\n]+)\]\]/g, (full, bang: string, inner: string, offset: number) => {
      if (stripped.slice(offset, offset + full.length) !== full) return full
      const hash = inner.indexOf("#")
      const pipe = inner.indexOf("|")
      const splits = [hash, pipe].filter((i) => i >= 0)
      const splitAt = splits.length > 0 ? Math.min(...splits) : -1
      const target = splitAt >= 0 ? inner.slice(0, splitAt) : inner
      const rest = splitAt >= 0 ? inner.slice(splitAt) : ""
      const key = target.trim()
      if (!key) return full
      const resolved = resolveLink(key, maps)
      const move = resolved ? moveByOldId.get(resolved.id) : undefined
      if (!move) return full
      const newBaseNoExt = stripMd(baseOf(move.to))
      const newStem = CANVAS_EXT.test(move.to) ? baseOf(move.to) : newBaseNoExt
      const needsFull = key.includes("/") || (allAfterBasenames?.get(newBaseNoExt.toLowerCase()) ?? 0) > 1
      const newTarget = needsFull ? (CANVAS_EXT.test(move.to) ? move.to : stripMd(move.to)) : newStem
      const rebuilt = `${bang}[[${newTarget}${rest}]]`
      if (rebuilt !== full) count++
      return rebuilt
    })

    // Markdown-style links [text](target) outside code/frontmatter
    const strippedAfterWiki = stripCode(out)
    out = out.replace(/\[([^\]\n]*)\]\(([^)\n]*)\)/g, (full, text: string, raw: string, offset: number) => {
      if (strippedAfterWiki.slice(offset, offset + full.length) !== full) return full
      const hrefRaw = raw.trim()
      let href: string
      if (hrefRaw.startsWith("<")) {
        const close = hrefRaw.indexOf(">")
        href = hrefRaw.slice(1, close >= 0 ? close : hrefRaw.length).trim()
      } else {
        href = hrefRaw.split(/\s+/)[0]
      }
      if (!href || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith("#")) return full
      const fragIdx = href.indexOf("#")
      const frag = fragIdx >= 0 ? href.slice(fragIdx) : ""
      const body = fragIdx >= 0 ? href.slice(0, fragIdx) : href
      let decoded = body
      try {
        decoded = decodeURIComponent(body)
      } catch {
        /* keep raw body */
      }
      const resolved = resolveLink(decoded, maps)
      const move = resolved ? moveByOldId.get(resolved.id) : undefined
      if (!move) return full
      const newBaseNoExt = stripMd(baseOf(move.to))
      const newStem = CANVAS_EXT.test(move.to) ? baseOf(move.to) : newBaseNoExt
      const needsFull = decoded.includes("/") || (allAfterBasenames?.get(newBaseNoExt.toLowerCase()) ?? 0) > 1
      const nextTarget = needsFull ? (CANVAS_EXT.test(move.to) ? move.to : stripMd(move.to)) : newStem
      const rebuilt = `[${text}](<${nextTarget}${frag}>)`
      if (rebuilt !== full) count++
      return rebuilt
    })

    return { content: out, count }
  }

  /**
   * Apply a set of note moves (rename or folder change, single note or whole
   * folder subtree) and rewrite links across markdown & canvas files.
   */
  async function applyMovesAndRewrite(root: string, before: WalkResult, moves: Move[]): Promise<number> {
    const maps = buildIndexMap(buildIndexEntries(before.notes))
    const movedSet = new Map(moves.map((m) => [m.from, m]))
    const afterCounts = new Map<string, number>()
    for (const row of before.notes) {
      const targetRel = movedSet.get(row.rel)?.to ?? row.rel
      const bn = stripMd(baseOf(targetRel)).toLowerCase()
      afterCounts.set(bn, (afterCounts.get(bn) ?? 0) + 1)
    }

    let total = 0
    for (const row of before.notes) {
      const move = movedSet.get(row.rel)
      const targetRel = move ? move.to : row.rel
      if (CANVAS_EXT.test(targetRel)) {
        const parsed = parseCanvas(row.content)
        let changed = false
        for (const node of parsed.nodes) {
          if (node.type !== "file" || !node.file) continue
          const hit = moves.find((m) => sameRel(m.from, node.file!)) ?? (() => {
            const r = resolveLink(stripMd(node.file!), maps)
            return r ? moves.find((m) => m.from === r.id) : undefined
          })()
          if (hit) {
            node.file = hit.to
            changed = true
            total++
          }
        }
        if (changed) {
          await writeCachedNote(root, absOf(root, targetRel), targetRel, serializeCanvas(parsed))
        }
        continue
      }
      const { content, count } = rewriteLinksInContent(row.content, maps, moves, afterCounts)
      if (count > 0 || move !== undefined) {
        await writeCachedNote(root, absOf(root, targetRel), targetRel, content)
        total += count
      }
    }
    const cache = cacheOf(root)
    for (const m of moves) {
      if (m.from !== m.to) cache.delete(m.from)
    }
    return total
  }

  // ── Bookmarks (per-vault, stored in .obsidian/bookmarks.json) ──────────────

  async function readBookmarks(root: string): Promise<BookmarkItem[]> {
    const raw = (await readJson(path.join(root, CONFIG_DIR, "bookmarks.json"))) as BookmarkItem[] | null
    return Array.isArray(raw) ? raw : []
  }
  async function writeBookmarks(root: string, items: BookmarkItem[]): Promise<void> {
    await writeJson(path.join(root, CONFIG_DIR, "bookmarks.json"), items)
  }

  async function syncBookmarksOnMoves(root: string, moves: Move[], folderMove?: { from: string; to: string }): Promise<void> {
    const items = await readBookmarks(root)
    if (items.length === 0) return
    let changed = false
    const moveMap = new Map(moves.map((m) => [m.from.toLowerCase(), m.to]))
    const next = items.map((b) => {
      if (!b.itemId) return b
      if (folderMove && b.itemType === "folder" && sameRel(b.itemId, folderMove.from)) {
        changed = true
        return { ...b, itemId: folderMove.to, title: baseOf(folderMove.to) }
      }
      const mapped = moveMap.get(b.itemId.toLowerCase())
      if (mapped) {
        changed = true
        return { ...b, itemId: mapped, title: stripMd(baseOf(mapped)) }
      }
      if (folderMove && b.itemId.toLowerCase().startsWith(folderMove.from.toLowerCase() + "/")) {
        const sub = folderMove.to + b.itemId.slice(folderMove.from.length)
        changed = true
        return { ...b, itemId: sub, title: b.itemType === "folder" ? baseOf(sub) : stripMd(baseOf(sub)) }
      }
      return b
    })
    if (changed) await writeBookmarks(root, next)
  }

  async function removeBookmarksForPrefix(root: string, rel: string, isFolder: boolean): Promise<void> {
    const items = await readBookmarks(root)
    if (items.length === 0) return
    const next = items.filter((b) => {
      if (!b.itemId) return true
      if (sameRel(b.itemId, rel)) return false
      if (isFolder && b.itemId.toLowerCase().startsWith(rel.toLowerCase() + "/")) return false
      return true
    })
    if (next.length !== items.length) await writeBookmarks(root, next)
  }

  // ── Operations (signature-identical to the web routes) ───────────────────

  async function listVaults(): Promise<VaultSummary[]> {
    const reg = await readRegistry()
    const out: VaultSummary[] = []
    const kept: RegistryEntry[] = []
    for (const v of reg.vaults) {
      const st = await statSafe(v.id)
      if (!st || !st.isDirectory()) continue // folder gone — drop from list
      kept.push(v)
      const walk = await walkVault(path.resolve(v.id))
      out.push({
        id: v.id,
        name: v.name,
        noteCount: walk.notes.length,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
      })
    }
    if (kept.length !== reg.vaults.length) await writeRegistry({ vaults: kept })
    return out
  }

  async function createVault(name: string): Promise<VaultSummary> {
    const cleanName = (name || "").trim() || "Untitled vault"
    const picked = await deps.createVaultFolder(cleanName)
    if (!picked) throw new DesktopApiError("canceled")
    const root = path.resolve(picked.root)
    const reg = await readRegistry()
    const existing = reg.vaults.find((v) => path.resolve(v.id) === root)
    const stamp = nowIso()
    if (existing) {
      existing.name = picked.name
      existing.updatedAt = stamp
    } else {
      reg.vaults.push({ id: root, name: picked.name, createdAt: stamp, updatedAt: stamp })
    }
    await writeRegistry(reg)
    const walk = await walkVault(root)
    return {
      id: root,
      name: picked.name,
      noteCount: walk.notes.length,
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp,
    }
  }

  async function deleteVault(id: string): Promise<{ ok: boolean }> {
    const root = path.resolve(String(id))
    const reg = await readRegistry()
    reg.vaults = reg.vaults.filter((v) => path.resolve(v.id) !== root)
    await writeRegistry(reg)
    contentCache.delete(root)
    return { ok: true }
  }

  async function tree(vaultId: string): Promise<TreeData> {
    const root = await assertVault(vaultId)
    const { dirs, notes, files } = await walkVault(root)
    return {
      folders: dirs.map((d) => ({
        id: d.rel,
        vaultId: root,
        name: d.name,
        parentId: d.parentRel,
        position: d.position,
      })),
      notes: toNoteMetas(root, notes),
      files,
    }
  }

  async function index(vaultId: string): Promise<IndexEntry[]> {
    const root = await assertVault(vaultId)
    const { notes } = await walkVault(root)
    return buildIndexEntries(notes)
  }

  // ── Graph (logic identical to the web app's /api/vaults/[id]/graph) ──────

  async function graph(vaultId: string): Promise<GraphData> {
    const root = await assertVault(vaultId)
    const { notes } = await walkVault(root)
    const index = buildIndexEntries(notes)
    const contents = new Map(notes.map((n) => [n.rel, n.content]))
    const maps = buildIndexMap(index)
    const nodes: GraphNode[] = index.map((e) => ({ id: e.id, name: e.name, path: e.path, degree: 0, unresolved: false }))
    const unresolvedIds = new Map<string, GraphNode>()
    const linkSet = new Set<string>()
    const links: GraphLink[] = []

    // canvas file cards reference notes directly (no wikilinks inside .canvas JSON)
    const canvasFileTargets = new Map<string, Set<string>>()
    for (const e of index) {
      if (e.kind !== "canvas") continue
      const c = parseCanvas(contents.get(e.id) ?? "")
      const targets = new Set<string>()
      for (const node of c.nodes) {
        if (node.type !== "file" || !node.file) continue
        const t = node.file.replace(/\\/g, "/").replace(/\.md$/i, "").replace(/\.canvas$/i, "")
        const byPath = maps.byPath.get(t) ?? maps.byPath.get(t + ".md")
        if (byPath && byPath.id !== e.id) targets.add(byPath.id)
      }
      if (targets.size > 0) canvasFileTargets.set(e.id, targets)
    }

    for (const e of index) {
      const content = contents.get(e.id) ?? ""
      const seen = new Set<string>()
      const extraTargets = canvasFileTargets.get(e.id)
      if (extraTargets) {
        for (const targetId of extraTargets) {
          const key = `${e.id}->${targetId}`
          if (!linkSet.has(key)) {
            linkSet.add(key)
            links.push({ source: e.id, target: targetId })
          }
        }
      }
      for (const link of extractLinks(content)) {
        if (link.embed) continue
        const resolved = resolveLink(link.target, maps)
        if (resolved) {
          if (resolved.id === e.id || seen.has(resolved.id)) continue
          seen.add(resolved.id)
          const key = `${e.id}->${resolved.id}`
          if (linkSet.has(key)) continue
          linkSet.add(key)
          links.push({ source: e.id, target: resolved.id })
        } else {
          const key = "unres:" + link.target.toLowerCase()
          if (!unresolvedIds.has(key)) {
            const node: GraphNode = { id: key, name: link.target, path: link.target, degree: 0, unresolved: true }
            unresolvedIds.set(key, node)
            nodes.push(node)
          }
          const un = unresolvedIds.get(key)!
          const k2 = `${e.id}->${un.id}`
          if (!linkSet.has(k2)) {
            linkSet.add(k2)
            links.push({ source: e.id, target: un.id })
          }
        }
      }
    }
    const deg = new Map<string, number>()
    for (const l of links) {
      deg.set(l.source, (deg.get(l.source) ?? 0) + 1)
      deg.set(l.target, (deg.get(l.target) ?? 0) + 1)
    }
    for (const n of nodes) n.degree = deg.get(n.id) ?? 0
    return { nodes, links }
  }

  // ── Tags ──────────────────────────────────────────────────────────────────

  async function tags(vaultId: string): Promise<TagCount[]> {
    const root = await assertVault(vaultId)
    const { notes } = await walkVault(root)
    const counts = new Map<string, number>()
    for (const t of buildIndexEntries(notes)) {
      for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  }

  // ── Search (grammar shared with the web app — src/lib/obsidian/search.ts) ──

  async function search(vaultId: string, query: string, caseSensitive = false): Promise<SearchResult> {
    if (!query.trim()) return { hits: [], totalMatches: 0, totalFiles: 0, query }
    const root = await assertVault(vaultId)
    const { notes } = await walkVault(root)
    const index = buildIndexEntries(notes)
    const contents = new Map(notes.map((n) => [n.rel, n.content]))
    const expr = parseSearchQuery(query)
    const terms = searchTerms(expr)
    const regexSpecs = searchRegexes(expr)
    const hits: SearchHit[] = []
    let totalMatches = 0

    for (const e of index) {
      const content = contents.get(e.id) ?? ""
      const ctx = { content, name: e.name, path: e.path, tags: e.tags, caseSensitive }
      if (!matchSearchExpr(expr, ctx)) continue

      const snippets: SearchHit["snippets"] = []
      let matchCount = 0
      for (const term of terms) {
        const needle = caseSensitive ? term : term.toLowerCase()
        const hay = caseSensitive ? content : content.toLowerCase()
        let idx = hay.indexOf(needle)
        let found = 0
        while (idx !== -1) {
          if (snippets.length < 5) snippets.push(makeSnippet(content, idx, needle.length))
          found++
          idx = hay.indexOf(needle, idx + needle.length)
        }
        matchCount += found
      }
      for (const spec of regexSpecs) {
        const base = compileSearchRegex(spec.pattern, spec.flags, caseSensitive)
        if (!base) continue
        const globalRe = new RegExp(base.source, base.flags.includes("g") ? base.flags : base.flags + "g")
        for (const m of content.matchAll(globalRe)) {
          if (!m[0]) break
          if (snippets.length < 5) snippets.push(makeSnippet(content, m.index ?? 0, m[0].length))
          matchCount++
        }
      }
      if (snippets.length === 0) {
        snippets.push({ before: "", match: e.name, after: "" })
        matchCount = 1
      }
      totalMatches += matchCount
      hits.push({ noteId: e.id, name: e.name, path: e.path, matchCount, snippets })
    }

    hits.sort((a, b) => b.matchCount - a.matchCount || a.path.localeCompare(b.path))
    return { hits, totalMatches, totalFiles: hits.length, query }
  }

  // ── Notes ─────────────────────────────────────────────────────────────────

  function isIgnoredRel(rel: string): boolean {
    return rel !== "" && rel.split("/").some((s) => s.startsWith(".") || IGNORED_NAMES.has(s))
  }

  /** Fast single-note reader: reads only the target file and its folder siblings instead of walking the whole vault. */
  async function readSingleNote(root: string, rel: string): Promise<NoteDoc> {
    if (!rel || isIgnoredRel(rel) || (!MD_EXT.test(rel) && !CANVAS_EXT.test(rel))) {
      throw new DesktopApiError("Note not found")
    }
    const abs = absOf(root, rel)
    const st = await statSafe(abs)
    if (!st || !st.isFile()) throw new DesktopApiError("Note not found")

    const cache = cacheOf(root)
    const hit = cache.get(rel)
    let content: string
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
      content = hit.content
    } else {
      content = await fsp.readFile(abs, "utf8")
      cache.set(rel, { mtimeMs: st.mtimeMs, size: st.size, content })
    }

    const dirRel = dirOf(rel)
    const entries = await fsp.readdir(path.dirname(abs), { withFileTypes: true })
    const siblingRels = entries
      .filter((e) => e.isFile() && !e.name.startsWith(".") && !IGNORED_NAMES.has(e.name) && (MD_EXT.test(e.name) || CANVAS_EXT.test(e.name)))
      .map((e) => joinRel(dirRel, e.name))
      .sort(naturalCompare)
    const position = Math.max(0, siblingRels.indexOf(rel))
    const birthMs = st.birthtimeMs && st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs
    const fileName = path.posix.basename(rel)
    return {
      id: rel,
      vaultId: root,
      folderId: dirRel || null,
      name: fileName.replace(MD_EXT, "").replace(CANVAS_EXT, ""),
      path: rel.replace(MD_EXT, "").replace(CANVAS_EXT, ""),
      position,
      createdAt: new Date(birthMs).toISOString(),
      updatedAt: new Date(st.mtimeMs).toISOString(),
      content,
    }
  }

  async function note(id: string, ctx: Ctx): Promise<NoteDoc> {
    const root = await assertVault(ctx.vaultId)
    return readSingleNote(root, normalizeRel(id))
  }

  async function createEntryFile(
    vaultId: string,
    name: string,
    folderId: string | null,
    ext: ".md" | ".canvas",
    content: string,
  ): Promise<NoteDoc> {
    const root = await assertVault(vaultId)
    return withVaultLock(root, async () => {
      const dirRel = folderId ? normalizeRel(folderId) : ""
      if (isIgnoredRel(dirRel)) throw new DesktopApiError("Folder not found")
      const absDir = dirRel ? absOf(root, dirRel) : root
      const dirSt = await statSafe(absDir)
      if (!dirSt || !dirSt.isDirectory()) {
        throw new DesktopApiError("Folder not found")
      }
      const entries = await fsp.readdir(absDir, { withFileTypes: true })
      const taken = new Set(
        entries
          .filter((e) => e.isFile() && !e.name.startsWith(".") && !IGNORED_NAMES.has(e.name) && (MD_EXT.test(e.name) || CANVAS_EXT.test(e.name)))
          .map((e) => e.name.replace(MD_EXT, "").replace(CANVAS_EXT, "").toLowerCase()),
      )
      const baseName = sanitizeName(name, "Untitled", true)
      let finalName = baseName
      let n = 0
      while (taken.has(finalName.toLowerCase())) finalName = `${baseName} ${++n}`

      const rel = joinRel(dirRel, finalName + ext)
      await writeCachedNote(root, absOf(root, rel), rel, content)
      return readSingleNote(root, rel)
    })
  }

  async function createNote(vaultId: string, name: string, folderId: string | null, content = ""): Promise<NoteDoc> {
    return createEntryFile(vaultId, name, folderId, ".md", content ?? "")
  }

  async function patchNote(
    id: string,
    data: { content?: string; name?: string; folderId?: string | null },
    ctx: Ctx,
  ): Promise<NoteDoc> {
    const root = await assertVault(ctx.vaultId)
    return withVaultLock(root, async () => {
      const oldRel = normalizeRel(id)
      const wantsRename = typeof data.name === "string" && data.name.trim() !== ""
      const wantsMove = data.folderId !== undefined
      if (!wantsRename && !wantsMove) {
        const cur = await readSingleNote(root, oldRel)
        if (typeof data.content === "string") {
          if (data.content !== cur.content) await maybeSnapshot(root, oldRel, cur.content)
          await writeCachedNote(root, absOf(root, oldRel), oldRel, data.content)
          return readSingleNote(root, oldRel)
        }
        return cur
      }

      const walk = await walkVault(root)
      const row = walk.notes.find((n) => n.rel === oldRel)
      if (!row) throw new DesktopApiError("Note not found")

      let newName = row.name
      if (wantsRename) newName = sanitizeName(data.name!, row.name, true)
      let newDir = row.dirRel
      if (wantsMove) {
        newDir = data.folderId ? normalizeRel(data.folderId) : ""
        if (newDir && !walk.dirs.some((d) => sameRel(d.rel, newDir))) {
          throw new DesktopApiError("Target folder not found")
        }
      }

      const extMatch = oldRel.match(/\.(canvas|md|markdown)$/i)
      const ext = extMatch ? extMatch[0].toLowerCase() : ".md"
      const newRel = joinRel(newDir, newName + ext)
      const structural = newRel !== oldRel

      if (structural) {
        const clash = walk.notes.some(
          (n) =>
            n.rel !== oldRel &&
            (n.rel.toLowerCase() === newRel.toLowerCase() || (sameRel(n.dirRel, newDir) && n.name.toLowerCase() === newName.toLowerCase())),
        )
        if (clash) throw new DesktopApiError("A note with that name already exists in that folder")
      }

      if (!structural) {
        if (typeof data.content === "string") {
          if (data.content !== row.content) await maybeSnapshot(root, oldRel, row.content)
          await writeCachedNote(root, absOf(root, oldRel), oldRel, data.content)
        }
        return readSingleNote(root, oldRel)
      }

      // structural path — rename / move (+ obsidian-style link rewriting)
      if (typeof data.content === "string") {
        await writeCachedNote(root, absOf(root, oldRel), oldRel, data.content)
        row.content = data.content
      }
      const absOld = absOf(root, oldRel)
      const absNew = absOf(root, newRel)
      await fsp.mkdir(path.dirname(absNew), { recursive: true })
      const caseOnlyRename = sameRel(oldRel, newRel)
      if (!caseOnlyRename && fsSync.existsSync(absNew)) {
        throw new DesktopApiError("A file with that name already exists")
      }
      if (caseOnlyRename) {
        const tmpAbs = `${absOld}.${randomUUID()}.case-tmp`
        await fsp.rename(absOld, tmpAbs)
        await fsp.rename(tmpAbs, absNew)
      } else {
        await fsp.rename(absOld, absNew)
      }
      await applyMovesAndRewrite(root, walk, [{ from: oldRel, to: newRel }])
      await syncBookmarksOnMoves(root, [{ from: oldRel, to: newRel }])
      return readSingleNote(root, newRel)
    })
  }

  async function deleteNote(id: string, ctx: Ctx): Promise<{ ok: boolean }> {
    const root = await assertVault(ctx.vaultId)
    return withVaultLock(root, async () => {
      const rel = normalizeRel(id)
      const abs = absOf(root, rel)
      if (!fsSync.existsSync(abs)) throw new DesktopApiError("Note not found")
      try {
        const prev = await fsp.readFile(abs, "utf8")
        await maybeSnapshot(root, rel, prev, 0)
      } catch {
        /* unreadable — proceed */
      }
      await deps.trash(abs)
      cacheOf(root).delete(rel)
      await removeBookmarksForPrefix(root, rel, false)
      return { ok: true }
    })
  }

  // ── Backlinks (logic identical to the web app's backlinks route) ─────────

  async function backlinks(noteId: string, ctx: Ctx): Promise<BacklinksData & { noteName: string }> {
    const root = await assertVault(ctx.vaultId)
    const targetRel = normalizeRel(noteId)
    const { notes } = await walkVault(root)
    const index = buildIndexEntries(notes)
    const contents = new Map(notes.map((n) => [n.rel, n.content]))
    const maps = buildIndexMap(index)
    const selfEntry = index.find((e) => e.id === targetRel)
    const selfRow = notes.find((n) => n.rel === targetRel)
    if (!selfRow) return { noteName: "", linked: [], unlinked: [] }
    const names = new Set<string>([selfRow.name])
    selfEntry?.aliases.forEach((a) => names.add(a))
    const sortedNames = [...names].map((n) => n.trim()).filter((n) => n.length >= 2).sort((a, b) => b.length - a.length)
    const metaById = new Map(index.map((e) => [e.id, e]))

    const linkedRaw = new Map<string, BacklinkMatch[]>()
    const unlinked: BacklinkMatch[] = []

    for (const e of index) {
      if (e.id === targetRel) continue
      const content = contents.get(e.id) ?? ""
      const stripped = stripCode(content)
      const meta = metaById.get(e.id)!

      for (const m of stripped.matchAll(WIKILINK_RE)) {
        const raw = m[0]
        if (raw.startsWith("!")) continue
        const inner = raw.slice(2, -2).split("|")[0].split("#")[0].trim()
        const resolved = resolveLink(inner, maps)
        if (resolved?.id === targetRel) {
          const { before, match, after } = makeSnippet(content, m.index ?? 0, raw.length)
          const entry: BacklinkMatch = { noteId: e.id, noteName: meta.name, path: meta.path, before, match, after, occurrences: 1 }
          if (!linkedRaw.has(e.id)) linkedRaw.set(e.id, [entry])
          else {
            const list = linkedRaw.get(e.id)!
            list[0].occurrences++
            if (list.length < 5) list.push(entry)
          }
        }
      }

      if (sortedNames.length > 0) {
        const escaped = sortedNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${escaped.join("|")})(?![\\p{L}\\p{N}_])`, "giu")
        let firstMatch: { index: number; length: number } | null = null
        let count = 0
        for (const m of content.matchAll(re)) {
          const idx = m.index ?? 0
          if (isInsideLinkOrCode(content, idx, m[0].length)) continue
          count++
          if (!firstMatch) firstMatch = { index: idx, length: m[0].length }
        }
        if (count > 0 && firstMatch) {
          const { before, match, after } = makeSnippet(content, firstMatch.index, firstMatch.length)
          unlinked.push({ noteId: e.id, noteName: meta.name, path: meta.path, before, match, after, occurrences: count })
        }
      }
    }

    const linked = [...linkedRaw.values()].map((matches) => matches[0])
    return { noteName: selfRow.name, linked, unlinked }
  }

  // ── Folders ───────────────────────────────────────────────────────────────

  async function createFolder(vaultId: string, name: string, parentId: string | null): Promise<FolderNode> {
    const root = await assertVault(vaultId)
    return withVaultLock(root, async () => {
      const parentRel = parentId ? normalizeRel(parentId) : ""
      const walk = await walkVault(root)
      if (parentRel && !walk.dirs.some((d) => sameRel(d.rel, parentRel))) {
        throw new DesktopApiError("Parent folder not found")
      }
      const siblings = new Set(walk.dirs.filter((d) => (d.parentRel ?? "").toLowerCase() === parentRel.toLowerCase()).map((d) => d.name.toLowerCase()))
      let finalName = sanitizeName(name, "New folder", false)
      let n = 0
      while (siblings.has(finalName.toLowerCase())) finalName = `${sanitizeName(name, "New folder", false)} ${++n}`

      const rel = joinRel(parentRel, finalName)
      await fsp.mkdir(absOf(root, rel), { recursive: true })
      const parent = walk.dirs.find((d) => sameRel(d.rel, parentRel))
      return {
        id: rel,
        vaultId: root,
        name: finalName,
        parentId: parent ? parent.rel : null,
        position: siblings.size,
      }
    })
  }

  async function patchFolder(id: string, data: { name?: string; parentId?: string | null }, ctx: Ctx): Promise<FolderNode> {
    const root = await assertVault(ctx.vaultId)
    return withVaultLock(root, async () => {
      const oldRel = normalizeRel(id)
      const walk = await walkVault(root)
      const row = walk.dirs.find((d) => sameRel(d.rel, oldRel))
      if (!row) throw new DesktopApiError("Folder not found")

      const wantsRename = typeof data.name === "string" && data.name.trim() !== ""
      const wantsMove = data.parentId !== undefined
      let newName = row.name
      if (wantsRename) newName = sanitizeName(data.name!, row.name, false)
      let newParent = row.parentRel ?? ""
      if (wantsMove) {
        newParent = data.parentId ? normalizeRel(data.parentId) : ""
        if (newParent) {
          let cur: string | null = newParent
          while (cur) {
            if (sameRel(cur, row.rel)) throw new DesktopApiError("Cannot move a folder into itself")
            cur = dirOf(cur) || null
          }
          if (!walk.dirs.some((d) => sameRel(d.rel, newParent))) {
            throw new DesktopApiError("Target parent folder not found")
          }
        }
      }

      const newRel = joinRel(newParent, newName)
      if (newRel === row.rel) {
        return { id: row.rel, vaultId: root, name: row.name, parentId: row.parentRel, position: row.position }
      }

      const clash = walk.dirs.some((d) => d.rel !== row.rel && d.rel.toLowerCase() === newRel.toLowerCase())
      if (clash) throw new DesktopApiError("A folder with that name already exists")

      const absOld = absOf(root, row.rel)
      const absNew = absOf(root, newRel)
      await fsp.mkdir(path.dirname(absNew), { recursive: true })
      const caseOnlyRename = sameRel(row.rel, newRel)
      if (!caseOnlyRename && fsSync.existsSync(absNew)) {
        throw new DesktopApiError("A folder with that name already exists")
      }
      if (caseOnlyRename) {
        const tmpAbs = `${absOld}.${randomUUID()}.case-tmp`
        await fsp.rename(absOld, tmpAbs)
        await fsp.rename(tmpAbs, absNew)
      } else {
        await fsp.rename(absOld, absNew)
      }

      const moves: Move[] = walk.notes
        .filter((n) => n.rel === row.rel || n.rel.toLowerCase().startsWith(row.rel.toLowerCase() + "/"))
        .map((n) => ({ from: n.rel, to: newRel + n.rel.slice(row.rel.length) }))
      if (moves.length > 0) await applyMovesAndRewrite(root, walk, moves)
      await syncBookmarksOnMoves(root, moves, { from: row.rel, to: newRel })

      const siblings = (await walkVault(root)).dirs.filter((d) => (d.parentRel ?? "").toLowerCase() === newParent.toLowerCase())
      return {
        id: newRel,
        vaultId: root,
        name: newName,
        parentId: newParent || null,
        position: Math.max(0, siblings.findIndex((d) => d.rel === newRel)),
      }
    })
  }

  async function deleteFolder(id: string, ctx: Ctx): Promise<{ ok: boolean }> {
    const root = await assertVault(ctx.vaultId)
    return withVaultLock(root, async () => {
      const rel = normalizeRel(id)
      const abs = absOf(root, rel)
      if (!fsSync.existsSync(abs)) throw new DesktopApiError("Folder not found")
      const walk = await walkVault(root)
      for (const n of walk.notes) {
        if (n.rel.toLowerCase().startsWith(rel.toLowerCase() + "/")) {
          await maybeSnapshot(root, n.rel, n.content, 0)
        }
      }
      await deps.trash(abs)
      const cache = cacheOf(root)
      for (const key of [...cache.keys()]) {
        if (sameRel(key, rel) || key.toLowerCase().startsWith(rel.toLowerCase() + "/")) cache.delete(key)
      }
      await removeBookmarksForPrefix(root, rel, true)
      return { ok: true }
    })
  }

  // ── Bookmarks ─────────────────────────────────────────────────────────────

  async function bookmarks(vaultId: string): Promise<BookmarkItem[]> {
    const root = await assertVault(vaultId)
    return readBookmarks(root)
  }

  async function addBookmark(data: {
    vaultId: string
    itemType: string
    itemId: string | null
    title: string
    subtitle?: string
    query?: string
  }): Promise<BookmarkItem> {
    const root = await assertVault(data.vaultId)
    const items = await readBookmarks(root)
    const item: BookmarkItem = {
      id: randomUUID(),
      itemType: (data.itemType as BookmarkItem["itemType"]) ?? "note",
      itemId: data.itemId ?? null,
      title: data.title ?? "Untitled",
      subtitle: data.subtitle ?? "",
      query: data.query ?? "",
      position: items.length,
      createdAt: nowIso(),
    }
    items.push(item)
    await writeBookmarks(root, items)
    return item
  }

  async function removeBookmark(id: string, ctx: Ctx): Promise<{ ok: boolean }> {
    const root = await assertVault(ctx.vaultId)
    const items = await readBookmarks(root)
    await writeBookmarks(
      root,
      items.filter((b) => b.id !== id),
    )
    return { ok: true }
  }

  // ── File recovery: snapshots (core plugin; stored in .obsidian/snapshots) ──

  /** in-memory throttle so autosaves don't spam the snapshot folder */
  const lastSnapshotAt = new Map<string, number>()

  /**
   * Write a snapshot of `previousContent` (called right before overwriting or
   * deleting a file). Throttled to one snapshot per interval unless forced.
   */
  async function maybeSnapshot(root: string, rel: string, previousContent: string, forceIntervalMin?: number): Promise<void> {
    try {
      const settings = await getSettings()
      if (!settings.corePlugins.fileRecovery || !settings.fileRecovery.enabled) return
      const intervalMin = forceIntervalMin ?? settings.fileRecovery.intervalMinutes ?? 5
      const key = root + "\u0000" + rel
      const now = Date.now()
      const last = lastSnapshotAt.get(key) ?? 0
      if (now - last < intervalMin * 60_000) return

      // <root>/.obsidian/snapshots/<dir-of-rel>/<basename>/<timestamp>
      const dir = path.join(root, SNAPSHOT_DIR, dirOf(rel), baseOf(rel))
      await fsp.mkdir(dir, { recursive: true })
      const stamp = new Date(now).toISOString().replace(/[:.]/g, "-")
      await fsp.writeFile(path.join(dir, stamp), previousContent, "utf8")
      lastSnapshotAt.set(key, now)

      // prune: keep at most MAX_SNAPSHOTS_PER_FILE, drop ones older than retention
      const retentionDays = settings.fileRecovery.retentionDays ?? 30
      const entries = await fsp.readdir(dir)
      const stats = await Promise.all(
        entries.map(async (e) => {
          const st = await statSafe(path.join(dir, e))
          return { name: e, mtime: st?.mtimeMs ?? 0 }
        }),
      )
      const cutoff = now - retentionDays * 86_400_000
      for (const s of stats) {
        if (s.mtime < cutoff) await fsp.rm(path.join(dir, s.name), { force: true }).catch(() => undefined)
      }
      const kept = (await fsp.readdir(dir)).sort()
      while (kept.length > MAX_SNAPSHOTS_PER_FILE) {
        const victim = kept.shift()!
        await fsp.rm(path.join(dir, victim), { force: true }).catch(() => undefined)
      }
    } catch {
      /* snapshots must never break a save */
    }
  }

  interface SnapshotInfo {
    id: string // "<rel>::<stamp>"
    timestamp: string
    size: number
  }
  interface SnapshotFile {
    noteId: string
    name: string
    count: number
    latest: string
    snapshots: SnapshotInfo[]
  }

  async function listSnapshots(vaultId: string): Promise<SnapshotFile[]> {
    const root = await assertVault(vaultId)
    const out: SnapshotFile[] = []
    const { notes } = await walkVault(root)
    const live = new Map(notes.map((n) => [n.rel, n]))
    const snapRoot = path.join(root, SNAPSHOT_DIR)
    if (!(await statSafe(snapRoot))) return []
    // flat recursive listing of snapshot files
    const files: string[] = []
    async function collect(dir: string): Promise<void> {
      let entries: fsSync.Dirent[]
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (e.isDirectory()) await collect(path.join(dir, e.name))
        else files.push(path.relative(snapRoot, path.join(dir, e.name)).split(path.sep).join("/"))
      }
    }
    await collect(snapRoot)
    // group by note: path/to/noteName/stamp -> note rel "path/to/noteName.md" (or .canvas)
    const groups = new Map<string, SnapshotInfo[]>()
    for (const f of files) {
      const i = f.lastIndexOf("/")
      if (i === -1) continue
      const noteKey = f.slice(0, i) // e.g. "Projects/Ideas.md" or with .canvas
      const stamp = f.slice(i + 1)
      const st = await statSafe(path.join(snapRoot, f))
      groups.set(noteKey, [
        ...(groups.get(noteKey) ?? []),
        { id: noteKey + "::" + stamp, timestamp: new Date(st?.mtimeMs ?? 0).toISOString(), size: st?.size ?? 0 },
      ])
    }
    for (const [noteKey, snaps] of groups) {
      snaps.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      const row = live.get(noteKey)
      const ext = CANVAS_EXT.test(noteKey) ? ".canvas" : ".md"
      const base = noteKey.slice(0, -ext.length) || noteKey
      const name = baseOf(base)
      out.push({
        noteId: row ? row.rel : noteKey,
        name: row ? row.name : name,
        count: snaps.length,
        latest: snaps[0]?.timestamp ?? "",
        snapshots: snaps,
      })
    }
    out.sort((a, b) => b.latest.localeCompare(a.latest))
    return out
  }

  async function readSnapshot(snapshotId: string, ctx: Ctx): Promise<{ content: string; noteId: string }> {
    const root = await assertVault(ctx.vaultId)
    const sep = snapshotId.lastIndexOf("::")
    if (sep === -1) throw new DesktopApiError("Invalid snapshot id")
    const noteKey = snapshotId.slice(0, sep)
    const stamp = snapshotId.slice(sep + 2)
    const abs = path.join(root, SNAPSHOT_DIR, ...noteKey.split("/"), stamp)
    const normSnapRoot = path.resolve(path.join(root, SNAPSHOT_DIR)) + path.sep
    if (!path.resolve(abs).startsWith(normSnapRoot)) throw new DesktopApiError("Invalid snapshot path")
    try {
      const content = await fsp.readFile(abs, "utf8")
      return { content, noteId: noteKey }
    } catch {
      throw new DesktopApiError("Snapshot not found")
    }
  }

  async function restoreSnapshot(snapshotId: string, ctx: Ctx): Promise<{ ok: boolean; noteId: string }> {
    const root = await assertVault(ctx.vaultId)
    return withVaultLock(root, async () => {
      const snap = await readSnapshot(snapshotId, ctx)
      const rel = normalizeRel(snap.noteId)
      try {
        const current = await fsp.readFile(absOf(root, rel), "utf8")
        await maybeSnapshot(root, rel, current, 0)
      } catch {
        /* file may not exist */
      }
      await writeCachedNote(root, absOf(root, rel), rel, snap.content)
      return { ok: true, noteId: rel }
    })
  }

  // ── Canvas (.canvas) creation ──────────────────────────────────────────────────

  async function createCanvas(vaultId: string, name: string, folderId: string | null): Promise<NoteDoc> {
    const content = JSON.stringify({ nodes: [], edges: [] }, null, 2)
    return createEntryFile(vaultId, name, folderId, ".canvas", content)
  }

  // ── Attachments (binary vault files) ──────────────────────────────────────────

  async function saveAttachment(
    vaultId: string,
    folderId: string | null,
    name: string,
    base64: string,
    ctx: Ctx,
  ): Promise<VaultFileMeta> {
    const root = await assertVault(vaultId)
    void ctx
    return withVaultLock(root, async () => {
      const dirRel = folderId ? normalizeRel(folderId) : ""
      const walk = await walkVault(root)
      if (dirRel && !walk.dirs.some((d) => sameRel(d.rel, dirRel))) {
        throw new DesktopApiError("Folder not found")
      }
      const safe = sanitizeName(name, "Pasted file", false)
      const dot = safe.lastIndexOf(".")
      const ext = dot > 0 ? safe.slice(dot) : ""
      const taken = new Set([
        ...walk.files.filter((f) => (f.folderId ?? "").toLowerCase() === dirRel.toLowerCase()).map((f) => `${f.name}.${f.ext}`.toLowerCase()),
        ...walk.notes.filter((n) => sameRel(n.dirRel, dirRel)).map((n) => n.name.toLowerCase()),
      ])
      let finalName = safe
      let n = 0
      while (taken.has(finalName.toLowerCase())) {
        const base = dot > 0 ? safe.slice(0, dot) : safe
        finalName = `${base} ${++n}${ext}`
      }
      const rel = joinRel(dirRel, finalName)
      const buf = Buffer.from(base64, "base64")
      await writeFileAtomicBinary(absOf(root, rel), buf)
      const st = await statSafe(absOf(root, rel))
      const lastDot = finalName.lastIndexOf(".")
      return {
        id: rel,
        vaultId: root,
        folderId: dirRel || null,
        name: lastDot > 0 ? finalName.slice(0, lastDot) : finalName,
        ext: lastDot > 0 ? finalName.slice(lastDot + 1).toLowerCase() : "",
        size: st?.size ?? buf.length,
        updatedAt: new Date().toISOString(),
      }
    })
  }

  async function writeFileAtomicBinary(abs: string, buf: Buffer): Promise<void> {
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    const tmp = `${abs}.${randomUUID()}.obsidian-tmp`
    await fsp.writeFile(tmp, buf)
    await fsp.rename(tmp, abs)
  }

  /** Serve any vault file for the app://vault/ protocol (images, audio, pdf…). */
  async function readVaultBinary(vaultId: string, rel: string): Promise<{ base64: string }> {
    const root = await assertVault(vaultId)
    const abs = absOf(root, rel)
    const buf = await fsp.readFile(abs)
    return { base64: buf.toString("base64") }
  }

  // ── Settings (global — same shape as the web app's settings route) ───────

  async function getSettings(): Promise<AppSettings> {
    const stored = (await readJson(settingsPath())) as Partial<AppSettings> | null
    return mergeSettings(DEFAULT_SETTINGS, stored)
  }

  async function putSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await getSettings()
    const merged = mergeSettings(current, patch)
    await writeJson(settingsPath(), merged)
    return merged
  }

  // ── Dispatcher ────────────────────────────────────────────────────────────

  const ops: Record<string, (args: unknown[], ctx: Ctx) => Promise<unknown>> = {
    listVaults: () => listVaults(),
    createVault: ([name]) => createVault(name as string),
    deleteVault: ([id]) => deleteVault(id as string),
    tree: ([vaultId]) => tree(vaultId as string),
    index: ([vaultId]) => index(vaultId as string),
    graph: ([vaultId]) => graph(vaultId as string),
    tags: ([vaultId]) => tags(vaultId as string),
    search: ([vaultId, q, cs]) => search(vaultId as string, q as string, cs as boolean),
    note: ([id], ctx) => note(id as string, ctx),
    createNote: ([vaultId, name, folderId, content]) => createNote(vaultId as string, name as string, folderId as string | null, content as string),
    patchNote: ([id, data], ctx) => patchNote(id as string, data as { content?: string; name?: string; folderId?: string | null }, ctx),
    deleteNote: ([id], ctx) => deleteNote(id as string, ctx),
    backlinks: ([noteId], ctx) => backlinks(noteId as string, ctx),
    createFolder: ([vaultId, name, parentId]) => createFolder(vaultId as string, name as string, parentId as string | null),
    patchFolder: ([id, data], ctx) => patchFolder(id as string, data as { name?: string; parentId?: string | null }, ctx),
    deleteFolder: ([id], ctx) => deleteFolder(id as string, ctx),
    bookmarks: ([vaultId]) => bookmarks(vaultId as string),
    addBookmark: ([data]) => addBookmark(data as Parameters<typeof addBookmark>[0]),
    removeBookmark: ([id], ctx) => removeBookmark(id as string, ctx),
    getSettings: () => getSettings(),
    putSettings: ([patch]) => putSettings(patch as Partial<AppSettings>),
    createCanvas: ([vaultId, name, folderId]) => createCanvas(vaultId as string, name as string, folderId as string | null),
    saveAttachment: ([vaultId, folderId, name, base64], ctx) => saveAttachment(vaultId as string, folderId as string | null, name as string, base64 as string, ctx),
    readVaultBinary: ([vaultId, rel]) => readVaultBinary(vaultId as string, rel as string),
    listSnapshots: ([vaultId]) => listSnapshots(vaultId as string),
    readSnapshot: ([id], ctx) => readSnapshot(id as string, ctx),
    restoreSnapshot: ([id], ctx) => restoreSnapshot(id as string, ctx),
  }

  return {
    /** Run one API operation. Throws DesktopApiError on failure. */
    async dispatch(op: string, args: unknown[] = [], ctx: Ctx = {}): Promise<unknown> {
      const fn = ops[op]
      if (!fn) throw new DesktopApiError(`Unknown operation: ${op}`)
      return fn(args, ctx)
    },
    /** Drop cached contents for a vault (called when the watcher sees changes). */
    invalidate(root: string): void {
      contentCache.delete(path.resolve(root))
    },
    /** Registered vault roots (used by the host to start watchers). */
    async vaultRoots(): Promise<string[]> {
      const reg = await readRegistry()
      return reg.vaults.map((v) => path.resolve(v.id))
    },
  }
}

export type ServerApi = ReturnType<typeof createServerApi>
