// ─── Shared types for the obsidian web replica ───────────────────────────────

export interface VaultSummary {
  id: string
  name: string
  noteCount: number
  createdAt: string
  updatedAt: string
}

export interface FolderNode {
  id: string
  vaultId: string
  name: string
  parentId: string | null
  position: number
}

export interface NoteMeta {
  id: string
  vaultId: string
  folderId: string | null
  name: string
  path: string
  position: number
  createdAt: string
  updatedAt: string
}

export interface NoteDoc extends NoteMeta {
  content: string
}

export interface TreeData {
  folders: FolderNode[]
  notes: NoteMeta[]
  /** Non-markdown files (images, audio, video, pdf, .canvas is NOT here — it is a note) */
  files?: VaultFileMeta[]
}

/** A non-markdown file inside the vault (attachment or other asset). */
export interface VaultFileMeta {
  /** vault-relative path, e.g. "assets/photo.png" */
  id: string
  vaultId: string
  folderId: string | null
  /** base name without extension */
  name: string
  /** lowercase extension without dot, e.g. "png" */
  ext: string
  size: number
  updatedAt: string
}

export interface IndexEntry {
  id: string
  name: string
  path: string
  aliases: string[]
  tags: string[]
  /** "note" (.md) or "canvas" (.canvas) — canvases are linkable like notes */
  kind?: "note" | "canvas"
}

export interface Wikilink {
  target: string
  subpath: string | null // "#heading" | "#^blockid" | null
  alias: string | null
  embed: boolean
  raw: string
}

export interface BacklinkMatch {
  noteId: string
  noteName: string
  path: string
  before: string
  match: string
  after: string
  occurrences: number
}

export interface BacklinksData {
  linked: BacklinkMatch[]
  unlinked: BacklinkMatch[]
}

export interface GraphNode {
  id: string
  name: string
  path: string
  degree: number
  unresolved: boolean
}

export interface GraphLink {
  source: string
  target: string
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

export interface TagCount {
  tag: string
  count: number
}

export interface SearchHit {
  noteId: string
  name: string
  path: string
  matchCount: number
  snippets: { before: string; match: string; after: string }[]
}

export interface SearchResult {
  hits: SearchHit[]
  totalMatches: number
  totalFiles: number
  query: string
}

export interface BookmarkItem {
  id: string
  itemType: "note" | "folder" | "graph" | "search"
  itemId: string | null
  title: string
  subtitle: string
  query: string
  position: number
  createdAt: string
}

// Editor
export type EditorMode = "live" | "source" | "read"

export type TabType = "note" | "graph" | "local-graph" | "attachment"

export interface Tab {
  id: string
  type: TabType
  noteId?: string
  pinned?: boolean
  mode: EditorMode
  history: string[]
  historyIndex: number
}

export interface Pane {
  id: string
  tabs: Tab[]
  activeTabId: string | null
}

export type SplitNode =
  | { id: string; kind: "split"; dir: "row" | "column"; children: SplitNode[]; sizes: number[] }
  | { id: string; kind: "pane"; pane: Pane }

// Markdown pipeline
export interface EmbedRef {
  target: string
  subpath: string | null
}

/** A vault file used as an attachment (image / audio / video / pdf …). */
export interface AttachmentRef {
  file: VaultFileMeta
  /** resolved embed size hint, when present in the link */
  size?: number | null
  height?: number | null
}

export type RenderSegment =
  | { kind: "html"; html: string }
  | { kind: "embed"; embed: EmbedRef }
  | { kind: "media"; media: AttachmentRef }

export interface RenderResult {
  segments: RenderSegment[]
  headings: { level: number; text: string; slug: string }[]
  taskCount: number
}

// ─── Canvas (.canvas — obsidian-compatible JSON whiteboard format) ─────────

export type CanvasNodeSide = "top" | "right" | "bottom" | "left"

export type CanvasEndpointEnd = "none" | "arrow"

export interface CanvasNode {
  id: string
  type: "text" | "file" | "link" | "group"
  text?: string
  file?: string
  subpath?: string
  url?: string
  label?: string
  background?: string
  backgroundStyle?: "cover" | "ratio" | "repeat" | string
  x: number
  y: number
  width: number
  height: number
  color?: string
  [key: string]: unknown
}

export interface CanvasEdge {
  id: string
  fromNode: string
  fromSide: CanvasNodeSide
  fromEnd?: CanvasEndpointEnd
  toNode: string
  toSide: CanvasNodeSide
  toEnd?: CanvasEndpointEnd
  color?: string
  label?: string
  [key: string]: unknown
}

export interface CanvasData {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  [key: string]: unknown
}

/** Parse .canvas JSON defensively; returns empty canvas on garbage. */
export function parseCanvas(raw: string): CanvasData {
  try {
    const parsed = JSON.parse(raw) as Partial<CanvasData>
    if (!parsed || typeof parsed !== "object") return { nodes: [], edges: [] }
    const { nodes: rawNodes, edges: rawEdges, ...rest } = parsed
    const nodes = Array.isArray(rawNodes)
      ? rawNodes.filter((n) => n && typeof n.id === "string" && typeof n.x === "number")
      : []
    const edges = Array.isArray(rawEdges)
      ? rawEdges.filter(
          (e) => e && typeof e.id === "string" && typeof e.fromNode === "string" && typeof e.toNode === "string",
        )
      : []
    return { ...rest, nodes, edges }
  } catch {
    return { nodes: [], edges: [] }
  }
}

/** Serialize .canvas JSON (stable formatting, JSON Canvas 1.0 compliant). */
export function serializeCanvas(data: CanvasData): string {
  const { nodes: rawNodes, edges: rawEdges, ...restCanvas } = data
  const clean = {
    ...restCanvas,
    nodes: rawNodes.map((n) => {
      const { id, type, text, file, subpath, url, label, background, backgroundStyle, x, y, width, height, color, ...extra } = n
      const out: Record<string, unknown> = {
        ...extra,
        id,
        type,
      }
      if (type === "text") {
        out.text = text ?? ""
      } else if (type === "file") {
        out.file = file ?? ""
        if (subpath) out.subpath = subpath
      } else if (type === "link") {
        out.url = url ?? ""
      } else if (type === "group") {
        if (label !== undefined && label !== "") out.label = label
        if (background) out.background = background
        if (backgroundStyle) out.backgroundStyle = backgroundStyle
      }
      out.x = Math.round(x)
      out.y = Math.round(y)
      out.width = Math.round(width)
      out.height = Math.round(height)
      if (color) out.color = color
      return out
    }),
    edges: rawEdges.map((e) => {
      const { id, fromNode, fromSide, fromEnd, toNode, toSide, toEnd, color, label, ...extra } = e
      return {
        ...extra,
        id,
        fromNode,
        fromSide,
        ...(fromEnd ? { fromEnd } : {}),
        toNode,
        toSide,
        ...(toEnd ? { toEnd } : {}),
        ...(label ? { label } : {}),
        ...(color ? { color } : {}),
      }
    }),
  }
  return JSON.stringify(clean, null, 2)
}

// Properties
export type PropertyType = "text" | "list" | "number" | "checkbox" | "date"

export interface PropertyInfo {
  key: string
  type: PropertyType
  value: unknown
  inferred: boolean
}
