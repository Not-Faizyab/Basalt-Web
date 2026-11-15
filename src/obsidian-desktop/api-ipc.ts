// ─────────────────────────────────────────────────────────────────────────────
// IPC api client — a drop-in replacement for the web app's fetch-based api.ts.
// Same method names, same signatures, same error behavior ("canceled" is a
// special error the UI treats as a no-op). Every call also carries the active
// vault id (from localStorage, exactly where the web app stores it) so the
// main process can resolve vault-relative note ids.
// ─────────────────────────────────────────────────────────────────────────────
import { toast } from "sonner"
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

export interface DesktopBridge {
  invoke: (op: string, args: unknown[], ctx: { vaultId?: string }) => Promise<{ ok: boolean; data?: unknown; error?: string }>
  openExternal: (url: string) => Promise<string>
  revealItem: (vaultId: string, relPath: string) => Promise<string>
  openPath: (vaultId: string, relPath: string) => Promise<string>
  /** Open a note in a real second obsidian window. */
  openNoteWindow: (noteId: string, subpath: string | null) => Promise<string>
  /** Render printable HTML to a PDF inside the vault's Exports folder. */
  exportPdf: (vaultId: string, fileName: string, html: string) => Promise<string>
  onInvalidate: (cb: (detail: { vaultId: string; noteId?: string; noteIds?: string[]; kinds?: string[] }) => void) => (() => void) | void
  onMenu: (cb: (id: string) => void) => (() => void) | void
  onPrepareClose: (cb: () => void) => (() => void) | void
  onThemeSync?: (cb: (theme: "dark" | "light") => void) => (() => void) | void
  readyToClose: () => void
  setTitleBarTheme?: (theme: "dark" | "light") => void
  platform: string
}

declare global {
  interface Window {
    desktop: DesktopBridge
  }
}

function currentVaultId(): string | undefined {
  try {
    const raw = localStorage.getItem("obs-web-vault")
    if (raw) {
      const parsed = JSON.parse(raw) as { id?: string }
      if (parsed?.id) return parsed.id
    }
  } catch {
    /* not set yet */
  }
  return undefined
}

async function call<T>(op: string, ...args: unknown[]): Promise<T> {
  const res = await window.desktop.invoke(op, args, { vaultId: currentVaultId() })
  if (!res.ok) throw new Error(res.error ?? `Request failed: ${op}`)
  return res.data as T
}

export const api = {
  listVaults: () => call<VaultSummary[]>("listVaults"),
  createVault: async (name: string) => {
    try {
      return await call<VaultSummary>("createVault", name)
    } catch (err) {
      if ((err as Error).message === "canceled") {
        toast("Canceled — no vault was created")
      }
      throw err
    }
  },
  deleteVault: (id: string) => call<{ ok: boolean }>("deleteVault", id),

  tree: (vaultId: string) => call<TreeData>("tree", vaultId),
  index: (vaultId: string) => call<IndexEntry[]>("index", vaultId),
  graph: (vaultId: string) => call<GraphData>("graph", vaultId),
  tags: (vaultId: string) => call<TagCount[]>("tags", vaultId),
  search: (vaultId: string, q: string, caseSensitive: boolean) => call<SearchResult>("search", vaultId, q, caseSensitive),

  note: (id: string) => call<NoteDoc>("note", id),
  createNote: (vaultId: string, name: string, folderId: string | null, content = "") => call<NoteDoc>("createNote", vaultId, name, folderId, content),
  patchNote: (id: string, data: { content?: string; name?: string; folderId?: string | null }) => call<NoteDoc>("patchNote", id, data),
  deleteNote: (id: string) => call<{ ok: boolean }>("deleteNote", id),
  backlinks: (noteId: string) => call<BacklinksData & { noteName: string }>("backlinks", noteId),

  createFolder: (vaultId: string, name: string, parentId: string | null) => call<FolderNode>("createFolder", vaultId, name, parentId),
  patchFolder: (id: string, data: { name?: string; parentId?: string | null }) => call<FolderNode>("patchFolder", id, data),
  deleteFolder: (id: string) => call<{ ok: boolean }>("deleteFolder", id),

  bookmarks: (vaultId: string) => call<BookmarkItem[]>("bookmarks", vaultId),
  addBookmark: (data: { vaultId: string; itemType: string; itemId: string | null; title: string; subtitle?: string; query?: string }) =>
    call<BookmarkItem>("addBookmark", data),
  removeBookmark: (id: string) => call<{ ok: boolean }>("removeBookmark", id),

  // ── Desktop-only: attachments / canvas / file recovery / system integration ──

  /** app:// URL that serves a vault file (images, audio, video, pdf). */
  attachmentUrl: (vaultId: string, fileId: string): string => {
    const encoded = `${encodeURIComponent(vaultId)}/${fileId.split("/").map(encodeURIComponent).join("/")}`
    if (typeof window !== "undefined" && window.desktop?.platform === "web-demo") {
      return `/vault-file/${encoded}`
    }
    return `app://vault/${encoded}`
  },
  /** Write a base64 attachment into the vault; returns its metadata. */
  saveAttachment: (vaultId: string, folderId: string | null, name: string, base64: string) =>
    call<VaultFileMeta>("saveAttachment", vaultId, folderId, name, base64),
  createCanvas: (vaultId: string, name: string, folderId: string | null) =>
    call<NoteDoc>("createCanvas", vaultId, name, folderId),
  listSnapshots: (vaultId: string) =>
    call<{ noteId: string; name: string; count: number; latest: string; snapshots: { id: string; timestamp: string; size: number }[] }[]>(
      "listSnapshots",
      vaultId,
    ),
  readSnapshot: (snapshotId: string) => call<{ content: string; noteId: string }>("readSnapshot", snapshotId),
  restoreSnapshot: (snapshotId: string) => call<{ ok: boolean; noteId: string }>("restoreSnapshot", snapshotId),
  /** Show a vault file in the OS file manager. */
  revealItem: (vaultId: string, relPath: string) => window.desktop.revealItem(vaultId, relPath),
  /** Open a vault file with the OS default app. */
  openWithDefaultApp: (vaultId: string, relPath: string) => window.desktop.openPath(vaultId, relPath),
  /** Open a note in its own OS window (a real second obsidian window). */
  openNoteWindow: (noteId: string, subpath: string | null) => window.desktop.openNoteWindow(noteId, subpath),
  /** Export printable HTML → PDF in <vault>/Exports (handled by the main process). */
  exportPdf: (vaultId: string, fileName: string, html: string) => window.desktop.exportPdf(vaultId, fileName, html),

  getSettings: () => call<AppSettings>("getSettings"),
  putSettings: (patch: Partial<AppSettings>) => call<AppSettings>("putSettings", patch),
}
