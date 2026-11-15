"use client"

// ─── File explorer: vault tree, CRUD, drag & drop, context menus ─────────────
import { useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  FolderClosed,
  FilePlus2,
  FolderPlus,
  ChevronsDownUp,
  ChevronsUpDown,
  ArrowUpDown,
  Check,
  Search,
  Crosshair,
} from "lucide-react"
import type { FolderNode, NoteMeta } from "@/lib/obsidian/types"
import { useWorkspace } from "../stores/workspace"
import { useUi } from "../stores/ui"
import { useDocs } from "../stores/docs"
import { useNoteMutations, useTree, useBookmarkMutations } from "../hooks"
import { api } from "../api"
import { toast } from "sonner"
import {
  noteMenuItems,
  folderMenuItems,
  rootMenuItems,
  showMenuAt,
  openNoteInNewWindow,
} from "./context-menu"


interface TreeItem {
  kind: "folder" | "note"
  id: string
  name: string
  folder?: FolderNode
  note?: NoteMeta
  children: TreeItem[]
}

/** obsidian's explorer sort orders (Settings → Files & links → sort order) */
type SortBy = "name" | "created" | "modified"
type SortDir = "asc" | "desc"
const SORT_OPTIONS: { by: SortBy; dir: SortDir; label: string }[] = [
  { by: "name", dir: "asc", label: "File name (A to Z)" },
  { by: "name", dir: "desc", label: "File name (Z to A)" },
  { by: "created", dir: "desc", label: "Created time (new to old)" },
  { by: "created", dir: "asc", label: "Created time (old to new)" },
  { by: "modified", dir: "desc", label: "Modified time (new to old)" },
  { by: "modified", dir: "asc", label: "Modified time (old to new)" },
]

/** desktop edition? (web edition hides OS-integration menu items) */
function isDesktop(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { desktop?: unknown }).desktop
}

export function FileExplorer() {
  const vaultId = useWorkspace((s) => s.vaultId)
  const openNote = useWorkspace((s) => s.openNote)
  const activeTab = useWorkspace((s) => s.getActiveTab())
  const coreCanvas = useWorkspace((s) => s.settings.corePlugins.canvas)
  const ui = useUi()

  const treeQuery = useTree()
  const folders = treeQuery.data?.folders ?? []
  const notes = treeQuery.data?.notes ?? []
  const loading = treeQuery.isLoading

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortBy>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [sortMenu, setSortMenu] = useState(false)

  useEffect(() => {
    if (!vaultId) return
    try {
      const saved = JSON.parse(localStorage.getItem(`obs-explorer-sort-${vaultId}`) ?? "null") as { by?: SortBy; dir?: SortDir } | null
      if (saved?.by && saved?.dir) {
        setSortBy(saved.by)
        setSortDir(saved.dir)
      }
    } catch {
      /* ignore */
    }
  }, [vaultId])

  const setSort = (by: SortBy, dir: SortDir) => {
    setSortBy(by)
    setSortDir(dir)
    if (vaultId) {
      try {
        localStorage.setItem(`obs-explorer-sort-${vaultId}`, JSON.stringify({ by, dir }))
      } catch {
        /* ignore */
      }
    }
  }

  const mutations = useNoteMutations()
  const { addBookmark } = useBookmarkMutations()

  const items = useMemo<TreeItem[]>(() => {
    const folderItems = new Map<string, TreeItem>()
    for (const f of folders) {
      folderItems.set(f.id, { kind: "folder", id: f.id, name: f.name, folder: f, children: [] })
    }
    const roots: TreeItem[] = []
    for (const f of folders) {
      const item = folderItems.get(f.id)!
      if (f.parentId && folderItems.has(f.parentId)) {
        folderItems.get(f.parentId)!.children.push(item)
      } else {
        roots.push(item)
      }
    }
    for (const n of notes) {
      const item: TreeItem = { kind: "note", id: n.id, name: n.name, note: n, children: [] }
      if (n.folderId && folderItems.has(n.folderId)) {
        folderItems.get(n.folderId)!.children.push(item)
      } else {
        roots.push(item)
      }
    }
    const sortRec = (list: TreeItem[]) => {
      list.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
        if (sortBy === "name" || (!a.note || !b.note)) {
          const cmp = a.name.localeCompare(b.name, undefined, { numeric: true })
          return sortDir === "asc" ? cmp : -cmp
        }
        const key = (n: TreeItem) => new Date(n.note![sortBy === "created" ? "createdAt" : "updatedAt"]).getTime()
        const cmp = key(a) - key(b)
        return sortDir === "asc" ? cmp : -cmp
      })
      list.forEach((i) => sortRec(i.children))
    }
    sortRec(roots)
    return roots
  }, [folders, notes, sortBy, sortDir])

  /** full vault path of a folder (for path: search + bookmark subtitles) */
  const pathOfFolder = (f: FolderNode): string => {
    const parts: string[] = [f.name]
    let cur = f
    const guard = new Set<string>()
    while (cur.parentId && !guard.has(cur.parentId)) {
      guard.add(cur.parentId)
      const parent = folders.find((x) => x.id === cur.parentId)
      if (!parent) break
      parts.unshift(parent.name)
      cur = parent
    }
    return parts.join("/")
  }

  const newNote = (folderId: string | null) => {
    mutations.createNote.mutate({ name: "Untitled", folderId })
  }
  const newFolder = (parentId: string | null) => {
    mutations.createFolder.mutate({ name: "New folder", parentId })
  }
  const newCanvas = (folderId: string | null) => {
    void import("../commands").then(({ createNewCanvas }) => createNewCanvas(folderId))
  }

  // folder bookmarks → expand + reveal in the tree (window event from Bookmarks)
  useEffect(() => {
    const handler = (e: Event) => {
      const folderId = (e as CustomEvent<string>).detail
      if (!folderId) return
      setCollapsed((prev) => {
        const next = new Set(prev)
        // expand every ancestor of the folder
        let cur = folders.find((f) => f.id === folderId)
        const guard = new Set<string>()
        while (cur?.parentId && !guard.has(cur.parentId)) {
          guard.add(cur.parentId)
          next.delete(cur.parentId)
          cur = folders.find((f) => f.id === cur!.parentId)
        }
        next.delete(folderId)
        return next
      })
      requestAnimationFrame(() => {
        document.querySelector(`[data-tree-id="${CSS.escape(folderId)}"]`)?.scrollIntoView({ block: "center" })
      })
    }
    window.addEventListener("obs-reveal-folder", handler as EventListener)
    return () => window.removeEventListener("obs-reveal-folder", handler as EventListener)
  }, [folders])

  const isFolderDescendant = (ancestorId: string, candidateId: string | null): boolean => {
    let cur = candidateId
    const guard = new Set<string>()
    while (cur && !guard.has(cur)) {
      if (cur === ancestorId) return true
      guard.add(cur)
      cur = folders.find((f) => f.id === cur)?.parentId ?? null
    }
    return false
  }

  const handleDrop = (targetFolderId: string | null) => {
    const dragPayload = (window as unknown as { __obsDrag?: { kind: string; id: string } }).__obsDrag
    ;(window as unknown as { __obsDrag?: unknown }).__obsDrag = undefined
    setDragOver(null)
    if (!dragPayload) return
    if (dragPayload.kind === "note") {
      mutations.moveNote.mutate({ id: dragPayload.id, folderId: targetFolderId })
    } else if (dragPayload.kind === "folder") {
      if (dragPayload.id !== targetFolderId && !isFolderDescendant(dragPayload.id, targetFolderId)) {
        mutations.moveFolder.mutate({ id: dragPayload.id, parentId: targetFolderId })
      }
    }
  }

  // ── obsidian-exact context menus ──────────────────────────────────────────

  const noteMenu = (e: React.MouseEvent, item: TreeItem) => {
    const ws = useWorkspace.getState()
    const isMd = !/\.canvas$/i.test(item.id) && !item.name.endsWith(".canvas")
    const desktop = isDesktop()
    showMenuAt(
      e,
      noteMenuItems({
        path: item.note?.path ?? item.id,
        isMarkdown: isMd,
        actions: {
          openNewTab: () => openNote(item.id, { newTab: true }),
          openRight: () => {
            ws.splitCurrentPane("row")
            openNote(item.id, { newTab: true })
          },
          openNewWindow: () => void openNoteInNewWindow(item.id),
          makeCopy: isMd
            ? () =>
                void (async () => {
                  try {
                    const note = await api.note(item.id)
                    const copy = await api.createNote(note.vaultId, `${note.name} copy`, note.folderId, note.content)
                    useDocs.getState().primeDoc(copy.id, copy.content ?? "")
                    window.dispatchEvent(new CustomEvent("obs-invalidate", { detail: { vaultId: note.vaultId, kinds: ["tree", "index", "graph"] } }))
                    openNote(copy.id)
                  } catch (err) {
                    toast(String((err as Error).message ?? err))
                  }
                })()
            : undefined,
          move: () => ui.openMove({ kind: "note", id: item.id, currentName: item.name }),
          merge: isMd && ws.settings.corePlugins.noteComposer ? () => ui.openMerge(item.id, item.name) : undefined,
          bookmark: ws.settings.corePlugins.bookmarks
            ? () =>
                addBookmark.mutate({
                  vaultId: vaultId!,
                  itemType: "note",
                  itemId: item.id,
                  title: item.name,
                  subtitle: item.note?.path ?? item.id,
                })
            : undefined,
          versionHistory: isMd && ws.settings.corePlugins.fileRecovery ? () => ui.openSnapshots(item.id) : undefined,
          openWithDefault: desktop ? () => void api.openWithDefaultApp(vaultId!, item.id) : undefined,
          reveal: desktop ? () => void api.revealItem(vaultId!, item.id) : undefined,
          rename: () => ui.openRename({ kind: "note", id: item.id, currentName: item.name }),
          delete: () => {
            // desktop deletes go to the Recycle Bin (no confirm, like obsidian);
            // web deletes are permanent, so confirm with modal
            if (desktop) {
              mutations.deleteNote.mutate(item.id)
              return
            }
            ui.openConfirm({
              title: `Delete "${item.name}"?`,
              message: "Are you sure you want to delete this file?",
              confirmLabel: "Delete",
              danger: true,
              onConfirm: () => mutations.deleteNote.mutate(item.id),
            })
          },
        },
      }),
    )
  }

  const folderMenu = (e: React.MouseEvent, item: TreeItem) => {
    const ws = useWorkspace.getState()
    const desktop = isDesktop()
    const fpath = item.folder ? pathOfFolder(item.folder) : item.name
    showMenuAt(
      e,
      folderMenuItems({
        path: fpath,
        actions: {
          newNote: () => newNote(item.id),
          newFolder: () => newFolder(item.id),
          newCanvas: coreCanvas ? () => newCanvas(item.id) : undefined,
          move: () => ui.openMove({ kind: "folder", id: item.id, currentName: item.name }),
          searchInFolder: ws.settings.corePlugins.search
            ? () => {
                ws.setLeftTab("search")
                useUi.getState().setSearchQuery(`path:"${fpath}" `)
              }
            : undefined,
          bookmark: ws.settings.corePlugins.bookmarks
            ? () =>
                addBookmark.mutate({
                  vaultId: vaultId!,
                  itemType: "folder",
                  itemId: item.id,
                  title: item.name,
                  subtitle: fpath,
                })
            : undefined,
          reveal: desktop ? () => void api.revealItem(vaultId!, item.id) : undefined,
          rename: () => ui.openRename({ kind: "folder", id: item.id, currentName: item.name }),
          delete: () => {
            if (desktop) {
              mutations.deleteFolder.mutate(item.id)
              return
            }
            ui.openConfirm({
              title: `Delete folder "${item.name}"?`,
              message: "Are you sure you want to delete this folder and everything inside it?",
              confirmLabel: "Delete",
              danger: true,
              onConfirm: () => mutations.deleteFolder.mutate(item.id),
            })
          },
        },
      }),
    )
  }

  const Row = ({ item, depth }: { item: TreeItem; depth: number }) => {
    const isActive = item.kind === "note" && item.note?.id === activeTab?.noteId
    const isCollapsed = collapsed.has(item.id)
    const isDragOver = dragOver === item.id

    return (
      <div>
        <div
          data-tree-id={item.id}
          className={`obs-tree-row ${isActive ? "is-active" : ""} ${isDragOver ? "is-context" : ""}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          draggable={item.kind === "note" || item.kind === "folder"}
          onDragStart={(e) => {
            ;(window as unknown as { __obsDrag?: { kind: string; id: string } }).__obsDrag = { kind: item.kind, id: item.id }
            e.dataTransfer.effectAllowed = "move"
          }}
          onDragEnd={() => {
            ;(window as unknown as { __obsDrag?: unknown }).__obsDrag = undefined
            setDragOver(null)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(item.kind === "folder" ? item.id : (item.note?.folderId ?? null) ?? null)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null)
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (item.kind === "folder") handleDrop(item.id)
            else handleDrop(item.note?.folderId ?? null)
          }}
          onClick={() => {
            if (item.kind === "note") openNote(item.id)
            else {
              const next = new Set(collapsed)
              if (next.has(item.id)) next.delete(item.id)
              else next.add(item.id)
              setCollapsed(next)
            }
          }}
          onContextMenu={(e) => {
            if (item.kind === "note") noteMenu(e, item)
            else folderMenu(e, item)
          }}
        >
          {depth > 0 &&
            Array.from({ length: depth }).map((_, lvl) => (
              <span key={lvl} className="obs-nav-guide" style={{ left: 15 + lvl * 16 }} />
            ))}
          {item.kind === "folder" ? (
            <>
              {isCollapsed ? <ChevronRight size={13} className="shrink-0 opacity-70" /> : <ChevronDown size={13} className="shrink-0 opacity-70" />}
              <FolderClosed size={14} className="shrink-0 opacity-75" />
            </>
          ) : (
            <span className="w-[13px] shrink-0" />
          )}
          <span className="truncate" style={{ color: isActive ? "var(--text-normal)" : undefined, fontWeight: item.kind === "folder" ? 500 : undefined }}>
            {item.name}
          </span>
        </div>

        {item.kind === "folder" && !isCollapsed && item.children.map((child) => <Row key={child.kind + child.id} item={child} depth={depth + 1} />)}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* action row (obsidian: centered nav action bar) */}
      <div className="relative flex items-center justify-center gap-1 px-2 py-1 shrink-0" style={{ minHeight: 32 }}>
        <button className="obs-icon-btn !h-6 !w-6" title="New note" onClick={() => newNote(null)}>
          <FilePlus2 size={14} />
        </button>
        <button className="obs-icon-btn !h-6 !w-6" title="New folder" onClick={() => newFolder(null)}>
          <FolderPlus size={14} />
        </button>
        <button className="obs-icon-btn !h-6 !w-6" title="Change sort order" onClick={() => setSortMenu(!sortMenu)}>
          <ArrowUpDown size={14} />
        </button>
        <button
          className="obs-icon-btn !h-6 !w-6"
          title={folders.length > 0 && collapsed.size >= folders.length ? "Expand all" : "Collapse all"}
          onClick={() =>
            setCollapsed(folders.length > 0 && collapsed.size >= folders.length ? new Set() : new Set(folders.map((f) => f.id)))
          }
        >
          {folders.length > 0 && collapsed.size >= folders.length ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
        </button>
        <button
          className="obs-icon-btn !h-6 !w-6"
          title="Reveal active file"
          disabled={!activeTab?.noteId}
          onClick={() => {
            const activeNote = notes.find((n) => n.id === activeTab?.noteId)
            if (!activeNote) return
            if (activeNote.folderId) {
              window.dispatchEvent(new CustomEvent("obs-reveal-folder", { detail: activeNote.folderId }))
            }
            requestAnimationFrame(() => {
              document.querySelector(`[data-tree-id="${CSS.escape(activeNote.id)}"]`)?.scrollIntoView({ block: "center" })
            })
          }}
        >
          <Crosshair size={14} />
        </button>
        {sortMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setSortMenu(false)} onContextMenu={(e) => { e.preventDefault(); setSortMenu(false) }} />
            <div className="obs-modal absolute right-2 top-8 z-50 min-w-56 p-1 obs-anim-in">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  className="obs-tree-row w-full !text-[0.85rem]"
                  onClick={() => {
                    setSort(opt.by, opt.dir)
                    setSortMenu(false)
                  }}
                >
                  <span className="w-3.5 shrink-0">
                    {sortBy === opt.by && sortDir === opt.dir ? <Check size={13} /> : null}
                  </span>
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* tree (right-click on empty space → vault-root menu, like obsidian) */}
      <div
        className="flex-1 overflow-y-auto px-1 pb-8"
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver("__root__")
        }}
        onDragLeave={(e) => {
          if (e.target === e.currentTarget) setDragOver(null)
        }}
        onDrop={(e) => {
          if (e.target !== e.currentTarget) return
          handleDrop(null)
        }}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return
          showMenuAt(
            e,
            rootMenuItems({
              newNote: () => newNote(null),
              newFolder: () => newFolder(null),
              newCanvas: coreCanvas ? () => newCanvas(null) : undefined,
            }),
          )
        }}
      >
        {loading ? (
          <div className="px-3 py-4 text-[0.85rem]" style={{ color: "var(--text-faint)" }}>
            Loading vault…
          </div>
        ) : items.length === 0 ? (
          <div className="px-3 py-6 text-center text-[0.85rem]" style={{ color: "var(--text-faint)" }}>
            No files yet.
            <br />
            <button className="obs-text-btn mt-1" onClick={() => newNote(null)}>
              Create your first note
            </button>
          </div>
        ) : (
          items.map((item) => <Row key={item.kind + item.id} item={item} depth={0} />)
        )}
      </div>
    </div>
  )
}

// re-export a tiny icon used by sidebar
export { Search as SearchIcon }
