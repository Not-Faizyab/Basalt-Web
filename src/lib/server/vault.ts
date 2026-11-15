// ─── Server-side vault helpers: paths, index, graph, search, backlinks ───────
import { db } from "@/lib/db"
import type {
  BacklinkMatch,
  BacklinksData,
  FolderNode,
  GraphData,
  GraphLink,
  GraphNode,
  IndexEntry,
  NoteMeta,
  SearchHit,
  SearchResult,
  TagCount,
} from "@/lib/obsidian/types"
import {
  buildIndexMap,
  extractLinks,
  extractTags,
  isInsideLinkOrCode,
  makeSnippet,
  resolveLink,
  stripCode,
  WIKILINK_RE,
} from "@/lib/obsidian/links"
import { parseFrontmatter } from "@/lib/obsidian/frontmatter"
import { compileSearchRegex, matchSearchExpr, parseSearchQuery, searchRegexes, searchTerms } from "@/lib/obsidian/search"

export async function getFoldersAndNotes(vaultId: string) {
  const [folders, notes] = await Promise.all([
    db.folder.findMany({ where: { vaultId }, orderBy: [{ position: "asc" }, { name: "asc" }] }),
    db.note.findMany({ where: { vaultId }, orderBy: [{ position: "asc" }, { name: "asc" }] }),
  ])
  return { folders, notes }
}

export function computePaths(folders: { id: string; name: string; parentId: string | null }[], notes: { id: string; name: string; folderId: string | null }[]): Map<string, string> {
  const folderPath = new Map<string, string>()
  const byId = new Map(folders.map((f) => [f.id, f]))
  const pathOf = (f: { id: string; name: string; parentId: string | null }): string => {
    if (folderPath.has(f.id)) return folderPath.get(f.id)!
    const p = f.parentId ? pathOf(byId.get(f.parentId)!) + "/" + f.name : f.name
    folderPath.set(f.id, p)
    return p
  }
  folders.forEach(pathOf)
  const out = new Map<string, string>()
  for (const n of notes) {
    out.set(n.id, n.folderId ? folderPath.get(n.folderId) + "/" + n.name : n.name)
  }
  return out
}

export function toFolderNodes(folders: Awaited<ReturnType<typeof getFoldersAndNotes>>["folders"]): FolderNode[] {
  return folders.map((f) => ({ id: f.id, vaultId: f.vaultId, name: f.name, parentId: f.parentId, position: f.position }))
}

export function toNoteMetas(notes: Awaited<ReturnType<typeof getFoldersAndNotes>>["notes"], paths: Map<string, string>): NoteMeta[] {
  return notes.map((n) => ({
    id: n.id,
    vaultId: n.vaultId,
    folderId: n.folderId,
    name: n.name,
    path: paths.get(n.id) ?? n.name,
    position: n.position,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  }))
}

/** Full link index (names, paths, aliases, tags) for resolution + switchers. */
export async function buildVaultIndex(vaultId: string): Promise<{ index: IndexEntry[]; notes: NoteMeta[]; folders: FolderNode[]; contents: Map<string, string> }> {
  const { folders, notes } = await getFoldersAndNotes(vaultId)
  const typedNotes = notes as unknown as {
    id: string
    vaultId: string
    folderId: string | null
    name: string
    content: string
    position: number
    createdAt: Date
    updatedAt: Date
  }[]
  const paths = computePaths(folders, typedNotes)
  const contents = new Map<string, string>(typedNotes.map((n) => [n.id, n.content]))
  const index: IndexEntry[] = typedNotes.map((n) => {
    const fm = parseFrontmatter(n.content)
    const aliases = Array.isArray(fm.data.aliases)
      ? fm.data.aliases.filter((a): a is string => typeof a === "string")
      : typeof fm.data.aliases === "string"
        ? [fm.data.aliases]
        : []
    return {
      id: n.id,
      name: n.name,
      path: paths.get(n.id) ?? n.name,
      aliases,
      tags: extractTags(n.content),
    }
  })
  return { index, notes: toNoteMetas(typedNotes, paths), folders: toFolderNodes(folders), contents }
}

// ─── Graph ───────────────────────────────────────────────────────────────────

export async function buildGraph(vaultId: string): Promise<GraphData> {
  const { index, contents } = await buildVaultIndex(vaultId)
  const maps = buildIndexMap(index)
  const nodes: GraphNode[] = index.map((e) => ({ id: e.id, name: e.name, path: e.path, degree: 0, unresolved: false }))
  const unresolvedIds = new Map<string, GraphNode>()
  const linkSet = new Set<string>()
  const links: GraphLink[] = []

  for (const e of index) {
    const content = contents.get(e.id) ?? ""
    const seen = new Set<string>()
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
  // degree = total link count (in+out)
  const deg = new Map<string, number>()
  for (const l of links) {
    deg.set(l.source, (deg.get(l.source) ?? 0) + 1)
    deg.set(l.target, (deg.get(l.target) ?? 0) + 1)
  }
  for (const n of nodes) n.degree = deg.get(n.id) ?? 0
  return { nodes, links }
}

// ─── Backlinks ───────────────────────────────────────────────────────────────

export async function buildBacklinks(noteId: string): Promise<BacklinksData & { noteName: string }> {
  const note = await db.note.findUnique({ where: { id: noteId } })
  if (!note) return { noteName: "", linked: [], unlinked: [] }
  const { index, contents } = await buildVaultIndex(note.vaultId)
  const maps = buildIndexMap(index)
  const selfEntry = index.find((e) => e.id === noteId)
  const candidateNames = new Set<string>([note.name])
  selfEntry?.aliases.forEach((a) => candidateNames.add(a))
  const sortedNames = [...candidateNames].map((n) => n.trim()).filter((n) => n.length >= 2).sort((a, b) => b.length - a.length)
  const metaById = new Map(index.map((e) => [e.id, e]))

  const linkedRaw = new Map<string, BacklinkMatch[]>()
  const unlinked: BacklinkMatch[] = []

  for (const e of index) {
    if (e.id === noteId) continue
    const content = contents.get(e.id) ?? ""
    const stripped = stripCode(content)
    const meta = metaById.get(e.id)!

    // linked mentions: any [[wikilink]] resolving to this note outside code blocks/frontmatter
    for (const m of stripped.matchAll(WIKILINK_RE)) {
      const raw = m[0]
      if (raw.startsWith("!")) continue
      const inner = raw.slice(2, -2).split("|")[0].split("#")[0].trim()
      const resolved = resolveLink(inner, maps)
      if (resolved?.id === noteId) {
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

    // unlinked mentions: whole-word occurrences of note name or aliases outside links/code
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

  return { noteName: note.name, linked, unlinked }
}

// ─── Tags ────────────────────────────────────────────────────────────────────

export async function buildTagCounts(vaultId: string): Promise<TagCount[]> {
  const { index } = await buildVaultIndex(vaultId)
  const counts = new Map<string, number>()
  for (const e of index) {
    for (const t of e.tags) {
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

// ─── Search ──────────────────────────────────────────────────────────────────

export { parseSearchQuery }

export async function searchVault(vaultId: string, query: string, caseSensitive = false): Promise<SearchResult> {
  if (!query.trim()) return { hits: [], totalMatches: 0, totalFiles: 0, query }
  const { index, contents } = await buildVaultIndex(vaultId)
  const expr = parseSearchQuery(query)
  const terms = searchTerms(expr)
  const regexSpecs = searchRegexes(expr)
  const hits: SearchHit[] = []
  let totalMatches = 0

  for (const e of index) {
    const content = contents.get(e.id) ?? ""
    if (!matchSearchExpr(expr, { content, name: e.name, path: e.path, tags: e.tags, caseSensitive })) continue

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
    if (matchCount === 0) matchCount = 1
    totalMatches += matchCount
    hits.push({ noteId: e.id, name: e.name, path: e.path, matchCount, snippets })
  }

  hits.sort((a, b) => b.matchCount - a.matchCount || a.path.localeCompare(b.path))
  return { hits, totalMatches, totalFiles: hits.length, query }
}
