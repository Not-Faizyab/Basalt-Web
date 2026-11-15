// ─── Typed API client ────────────────────────────────────────────────────────
import type { AppSettings } from "@/lib/obsidian/settings"
import type {
  BacklinksData,
  BookmarkItem,
  FolderNode,
  GraphData,
  IndexEntry,
  NoteDoc,
  SearchResult,
  TagCount,
  TreeData,
  VaultFileMeta,
  VaultSummary,
} from "@/lib/obsidian/types"

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  listVaults: () => req<VaultSummary[]>("/api/vaults"),
  createVault: (name: string) => req<VaultSummary>("/api/vaults", { method: "POST", body: JSON.stringify({ name }) }),
  deleteVault: (id: string) => req<{ ok: boolean }>(`/api/vaults/${id}`, { method: "DELETE" }),

  tree: (vaultId: string) => req<TreeData>(`/api/vaults/${vaultId}/tree`),
  index: (vaultId: string) => req<IndexEntry[]>(`/api/vaults/${vaultId}/index`),
  graph: (vaultId: string) => req<GraphData>(`/api/vaults/${vaultId}/graph`),
  tags: (vaultId: string) => req<TagCount[]>(`/api/vaults/${vaultId}/tags`),
  search: (vaultId: string, q: string, caseSensitive: boolean) =>
    req<SearchResult>(`/api/vaults/${vaultId}/search?q=${encodeURIComponent(q)}&case=${caseSensitive}`),

  note: (id: string) => req<NoteDoc>(`/api/notes/${id}`),
  createNote: (vaultId: string, name: string, folderId: string | null, content = "") =>
    req<NoteDoc>("/api/notes", { method: "POST", body: JSON.stringify({ vaultId, name, folderId, content }) }),
  patchNote: (id: string, data: { content?: string; name?: string; folderId?: string | null }) =>
    req<NoteDoc>(`/api/notes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteNote: (id: string) => req<{ ok: boolean }>(`/api/notes/${id}`, { method: "DELETE" }),
  backlinks: (noteId: string) => req<BacklinksData & { noteName: string }>(`/api/notes/${noteId}/backlinks`),

  createFolder: (vaultId: string, name: string, parentId: string | null) =>
    req<FolderNode>("/api/folders", { method: "POST", body: JSON.stringify({ vaultId, name, parentId }) }),
  patchFolder: (id: string, data: { name?: string; parentId?: string | null }) =>
    req<FolderNode>(`/api/folders/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteFolder: (id: string) => req<{ ok: boolean }>(`/api/folders/${id}`, { method: "DELETE" }),

  bookmarks: (vaultId: string) => req<BookmarkItem[]>(`/api/bookmarks?vaultId=${vaultId}`),
  addBookmark: (data: { vaultId: string; itemType: string; itemId: string | null; title: string; subtitle?: string; query?: string }) =>
    req<BookmarkItem>("/api/bookmarks", { method: "POST", body: JSON.stringify(data) }),
  removeBookmark: (id: string) => req<{ ok: boolean }>(`/api/bookmarks?id=${id}`, { method: "DELETE" }),

  // ── Desktop-only capabilities — the web edition has no local file system,
  // so these return "not available" and the UI shows that honestly.
  attachmentUrl: (_vaultId: string, _fileId: string): string | null => null,
  saveAttachment: async (_vaultId: string, _folderId: string | null, _name: string, _base64: string): Promise<VaultFileMeta> => {
    throw new Error("Attachments require the desktop edition (local vault folders)")
  },
  createCanvas: (vaultId: string, name: string, folderId: string | null): Promise<NoteDoc> => {
    const canvasName = name.endsWith(".canvas") ? name : `${name}.canvas`
    const initialContent = JSON.stringify({ nodes: [], edges: [] }, null, 2)
    return req<NoteDoc>("/api/notes", {
      method: "POST",
      body: JSON.stringify({ vaultId, name: canvasName, folderId, content: initialContent }),
    })
  },
  listSnapshots: async (_vaultId: string): Promise<never[]> => [],
  readSnapshot: async (_snapshotId: string): Promise<{ content: string; noteId: string }> => {
    throw new Error("File recovery requires the desktop edition")
  },
  restoreSnapshot: async (_snapshotId: string): Promise<{ ok: boolean; noteId: string }> => {
    throw new Error("File recovery requires the desktop edition")
  },
  revealItem: async (_vaultId: string, _relPath: string): Promise<string> => "unavailable",
  openWithDefaultApp: async (_vaultId: string, _relPath: string): Promise<string> => "unavailable",

  /** Web edition "Open in new window": a second browser tab that boots the
   *  same app and opens exactly this note (handled in app.tsx boot). */
  openNoteWindow: async (noteId: string, subpath: string | null): Promise<string> => {
    const sub = subpath ? `&sub=${encodeURIComponent(subpath)}` : ""
    window.open(`${window.location.origin}${window.location.pathname}?openNote=${encodeURIComponent(noteId)}${sub}`, "_blank", "noopener")
    return "opened"
  },

  getSettings: () => req<unknown>("/api/settings"),
  putSettings: (patch: Partial<AppSettings>) => req<AppSettings>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),
}
