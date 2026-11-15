"use client"

// ─── Document store: per-note content cache with debounced autosave ─────────
import { create } from "zustand"
import { api } from "../api"
import { useWorkspace } from "./workspace"

interface DocEntry {
  content: string
  savedContent: string
  loading: boolean
  missing?: boolean
}

interface DocState {
  docs: Record<string, DocEntry>
  load: (noteId: string) => Promise<void>
  setDoc: (noteId: string, content: string) => void
  flush: (noteId: string) => Promise<void>
  flushAll: () => Promise<void>
  reload: (noteId: string) => Promise<void>
  primeDoc: (noteId: string, content: string) => void
  renameInDocs: (noteId: string, content: string) => void
  remapNoteId: (oldId: string, newId: string) => void
  dropDoc: (noteId: string) => void
}

const pendingTimers: Record<string, ReturnType<typeof setTimeout>> = {}
const inflight: Record<string, Promise<void>> = {}

async function persist(noteId: string): Promise<void> {
  // Serialize saves for the same noteId so slower PATCH responses never overwrite newer content
  const prev = inflight[noteId]
  const run = (prev ? prev.catch(() => undefined) : Promise.resolve()).then(async () => {
    const store = useDocs.getState()
    const entry = store.docs[noteId]
    if (!entry || entry.missing || entry.content === entry.savedContent) return
    const content = entry.content
    useDocs.setState({
      docs: { ...useDocs.getState().docs, [noteId]: { ...entry, savedContent: content } },
    })
    const vaultId = useWorkspace.getState().vaultId
    try {
      await api.patchNote(noteId, { content })
      if (vaultId && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("obs-invalidate", { detail: { vaultId, noteId } }))
      }
    } catch (err) {
      console.error("Autosave failed", err)
      const cur = useDocs.getState().docs[noteId]
      if (cur && cur.savedContent === content) {
        useDocs.setState({ docs: { ...useDocs.getState().docs, [noteId]: { ...cur, savedContent: "\u0000__UNSAVED__" } } })
      }
    }
    // If more edits landed while we were saving, persist again immediately
    const after = useDocs.getState().docs[noteId]
    if (after && !after.missing && after.content !== after.savedContent) {
      await persist(noteId)
    }
  })
  inflight[noteId] = run.finally(() => {
    if (inflight[noteId] === run) delete inflight[noteId]
  })
  return inflight[noteId]
}

export const useDocs = create<DocState>((set, get) => ({
  docs: {},

  load: async (noteId) => {
    const existing = get().docs[noteId]
    if (existing && !existing.missing) {
      return
    }
    set({ docs: { ...get().docs, [noteId]: { content: "", savedContent: "", loading: true, missing: false } } })
    try {
      const note = await api.note(noteId)
      const cur = get().docs[noteId]
      if (cur && cur.content === "" && cur.savedContent === "") {
        set({ docs: { ...get().docs, [noteId]: { content: note.content, savedContent: note.content, loading: false, missing: false } } })
      }
    } catch {
      set({ docs: { ...get().docs, [noteId]: { content: "", savedContent: "", loading: false, missing: true } } })
    }
  },

  reload: async (noteId) => {
    try {
      const note = await api.note(noteId)
      clearTimeout(pendingTimers[noteId])
      set({ docs: { ...get().docs, [noteId]: { content: note.content, savedContent: note.content, loading: false, missing: false } } })
    } catch {
      // ignore missing/transient error
    }
  },

  setDoc: (noteId, content) => {
    const entry = get().docs[noteId]
    if (!entry || entry.missing) return
    set({ docs: { ...get().docs, [noteId]: { ...entry, content } } })
    clearTimeout(pendingTimers[noteId])
    pendingTimers[noteId] = setTimeout(() => void persist(noteId), 700)
  },

  flush: async (noteId) => {
    clearTimeout(pendingTimers[noteId])
    await persist(noteId)
  },

  flushAll: async () => {
    const ids = Object.keys(get().docs)
    await Promise.all(ids.map((id) => get().flush(id)))
  },

  primeDoc: (noteId, content) => {
    clearTimeout(pendingTimers[noteId])
    const entry = get().docs[noteId]
    const next = { content, savedContent: content, loading: false, missing: false }
    set({ docs: { ...get().docs, [noteId]: entry ? { ...entry, ...next } : next } })
  },

  renameInDocs: (noteId, content) => {
    get().primeDoc(noteId, content)
  },

  remapNoteId: (oldId, newId) => {
    if (oldId === newId) return
    clearTimeout(pendingTimers[oldId])
    const docs = { ...get().docs }
    const entry = docs[oldId]
    if (entry) {
      docs[newId] = { ...entry, missing: false }
      delete docs[oldId]
      set({ docs })
    }
  },

  dropDoc: (noteId) => {
    clearTimeout(pendingTimers[noteId])
    if (!(noteId in get().docs)) return
    const docs = { ...get().docs }
    delete docs[noteId]
    set({ docs })
  },
}))
