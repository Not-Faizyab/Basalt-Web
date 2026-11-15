"use client"

// ─── React-Query data hooks ──────────────────────────────────────────────────
import { useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "./api"
import { collectPanes, useWorkspace } from "./stores/workspace"
import { useDocs } from "./stores/docs"
import type { IndexEntry, NoteDoc, TreeData, VaultFileMeta } from "@/lib/obsidian/types"

export function useVaultId() {
  return useWorkspace((s) => s.vaultId)
}

export function useTree() {
  const vaultId = useVaultId()
  return useQuery({
    queryKey: ["tree", vaultId],
    queryFn: () => api.tree(vaultId!),
    enabled: !!vaultId,
  })
}

/** Non-markdown vault files (attachments: images, audio, video, pdf…). */
export function useVaultFiles(): VaultFileMeta[] {
  const { data } = useTree()
  return data?.files ?? []
}

/** The attachment render options shared by every renderMarkdown call site
 *  (files list + URL resolver — no-ops on platforms without file access). */
export function useAttachmentRenderOpts(): { files?: VaultFileMeta[]; resolveAttachmentUrl?: (file: VaultFileMeta) => string | null } {
  const files = useVaultFiles()
  const vaultId = useVaultId()
  return useMemo(
    () => ({
      files,
      resolveAttachmentUrl: (file: VaultFileMeta) => (vaultId ? api.attachmentUrl(vaultId, file.id) : null),
    }),
    [files, vaultId],
  )
}

export function useIndex() {
  const vaultId = useVaultId()
  return useQuery({
    queryKey: ["index", vaultId],
    queryFn: () => api.index(vaultId!),
    enabled: !!vaultId,
  })
}

export function useGraphData() {
  const vaultId = useVaultId()
  return useQuery({
    queryKey: ["graph", vaultId],
    queryFn: () => api.graph(vaultId!),
    enabled: !!vaultId,
  })
}

export function useTagCounts() {
  const vaultId = useVaultId()
  return useQuery({
    queryKey: ["tags", vaultId],
    queryFn: () => api.tags(vaultId!),
    enabled: !!vaultId,
  })
}

export function useBacklinks(noteId: string | null | undefined) {
  return useQuery({
    queryKey: ["backlinks", noteId],
    queryFn: () => api.backlinks(noteId!),
    enabled: !!noteId,
  })
}

export function useSearchResults(query: string, caseSensitive: boolean) {
  const vaultId = useVaultId()
  const trimmed = query.trim()
  return useQuery({
    queryKey: ["search", vaultId, trimmed, caseSensitive],
    queryFn: () => api.search(vaultId!, trimmed, caseSensitive),
    enabled: !!vaultId && trimmed.length > 0,
  })
}

export function useBookmarks() {
  const vaultId = useVaultId()
  return useQuery({
    queryKey: ["bookmarks", vaultId],
    queryFn: () => api.bookmarks(vaultId!),
    enabled: !!vaultId,
  })
}

// ─── Mutations with cache invalidation ───────────────────────────────────────

export function useInvalidate() {
  const qc = useQueryClient()
  const vaultId = useVaultId()
  return (kinds: ("tree" | "index" | "graph" | "tags" | "backlinks" | "bookmarks" | "search")[], noteId?: string) => {
    kinds.forEach((k) => {
      if (k === "backlinks" && noteId) qc.invalidateQueries({ queryKey: ["backlinks", noteId] })
      else qc.invalidateQueries({ queryKey: [k, k === "backlinks" ? undefined : vaultId] })
    })
    // backlinks of every note may change when notes change
    if (kinds.includes("index") || kinds.includes("tree")) {
      qc.invalidateQueries({ queryKey: ["backlinks"] })
    }
  }
}

export function useNoteMutations() {
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  const vaultId = useVaultId()
  const settings = useWorkspace((s) => s.settings)
  const openNote = useWorkspace((s) => s.openNote)

  const remapPrefix = (oldPrefix: string, newPrefix: string) => {
    if (!oldPrefix || !newPrefix || oldPrefix === newPrefix) return
    const slash = oldPrefix.endsWith("/") ? oldPrefix : `${oldPrefix}/`
    const newSlash = newPrefix.endsWith("/") ? newPrefix : `${newPrefix}/`
    const ws = useWorkspace.getState()
    const seen = new Set<string>()
    for (const p of collectPanes(ws.root)) {
      for (const t of p.tabs) {
        if (t.noteId?.startsWith(slash) && !seen.has(t.noteId)) {
          seen.add(t.noteId)
          ws.remapNoteId(t.noteId, `${newSlash}${t.noteId.slice(slash.length)}`)
        }
      }
    }
    for (const id of Object.keys(useDocs.getState().docs)) {
      if (id.startsWith(slash)) {
        useDocs.getState().remapNoteId(id, `${newSlash}${id.slice(slash.length)}`)
      }
    }
  }

  const createNote = useMutation({
    mutationFn: async (opts: { name: string; folderId: string | null; content?: string }) =>
      api.createNote(vaultId!, opts.name, opts.folderId, opts.content ?? ""),
    onSuccess: (note: NoteDoc) => {
      useDocs.getState().primeDoc(note.id, note.content ?? "")
      invalidate(["tree", "index", "graph", "tags"])
      openNote(note.id)
    },
  })

  const renameNote = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await api.patchNote(id, { name })
      return res
    },
    onSuccess: (res, vars) => {
      if (res?.id && res.id !== vars.id) {
        useWorkspace.getState().remapNoteId(vars.id, res.id)
        useDocs.getState().remapNoteId(vars.id, res.id)
      }
      invalidate(["tree", "index", "graph", "search", "bookmarks", "tags"])
    },
  })

  const moveNote = useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) => api.patchNote(id, { folderId }),
    onSuccess: (res, vars) => {
      if (res?.id && res.id !== vars.id) {
        useWorkspace.getState().remapNoteId(vars.id, res.id)
        useDocs.getState().remapNoteId(vars.id, res.id)
      }
      invalidate(["tree", "index", "graph", "search", "bookmarks", "tags"])
    },
  })

  const deleteNote = useMutation({
    mutationFn: (id: string) => api.deleteNote(id),
    onSuccess: (_data, id) => {
      useWorkspace.getState().closeTabsForNote(id)
      useDocs.getState().dropDoc(id)
      invalidate(["tree", "index", "graph", "tags", "bookmarks", "search"])
    },
  })

  const createFolder = useMutation({
    mutationFn: (opts: { name: string; parentId: string | null }) => api.createFolder(vaultId!, opts.name, opts.parentId),
    onSuccess: () => invalidate(["tree"]),
  })

  const renameFolder = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.patchFolder(id, { name }),
    onSuccess: (res, vars) => {
      if (res?.id && res.id !== vars.id) remapPrefix(vars.id, res.id)
      invalidate(["tree", "index", "graph", "search", "bookmarks", "tags"])
    },
  })

  const moveFolder = useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) => api.patchFolder(id, { parentId }),
    onSuccess: (res, vars) => {
      if (res?.id && res.id !== vars.id) remapPrefix(vars.id, res.id)
      invalidate(["tree", "index", "graph", "search", "bookmarks", "tags"])
    },
  })

  const deleteFolder = useMutation({
    mutationFn: async (id: string) => {
      const tree = qc.getQueryData<TreeData>(["tree", vaultId])
      const folderIds = new Set<string>([id])
      if (tree) {
        let added = true
        while (added) {
          added = false
          for (const f of tree.folders) {
            if (f.parentId && folderIds.has(f.parentId) && !folderIds.has(f.id)) {
              folderIds.add(f.id)
              added = true
            }
          }
        }
      }
      const affected = new Set<string>(
        tree ? tree.notes.filter((n) => (n.folderId && folderIds.has(n.folderId)) || n.id.startsWith(`${id}/`)).map((n) => n.id) : [],
      )
      for (const p of collectPanes(useWorkspace.getState().root)) {
        for (const t of p.tabs) {
          if (t.noteId?.startsWith(`${id}/`)) affected.add(t.noteId)
        }
      }
      const res = await api.deleteFolder(id)
      return { res, affected: [...affected] }
    },
    onSuccess: (result) => {
      for (const noteId of result.affected) {
        useWorkspace.getState().closeTabsForNote(noteId)
        useDocs.getState().dropDoc(noteId)
      }
      invalidate(["tree", "index", "graph", "tags", "bookmarks", "search"])
    },
  })

  return {
    createNote,
    renameNote,
    moveNote,
    deleteNote,
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    settings,
  }
}

export function useBookmarkMutations() {
  const invalidate = useInvalidate()
  const addBookmark = useMutation({
    mutationFn: api.addBookmark,
    onSuccess: () => invalidate(["bookmarks"]),
  })
  const removeBookmark = useMutation({
    mutationFn: (id: string) => api.removeBookmark(id),
    onSuccess: () => invalidate(["bookmarks"]),
  })
  return { addBookmark, removeBookmark }
}

// Convenience: resolve noteId → IndexEntry
export function useEntryFor(noteId: string | null | undefined): IndexEntry | null {
  const { data } = useIndex()
  if (!data || !noteId) return null
  return data.find((e) => e.id === noteId) ?? null
}
