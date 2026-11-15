"use client"

// ─── Workspaces manager + File recovery browser (small modals) ────────────────
import { useEffect, useState } from "react"
import { format } from "date-fns"
import { Layers, History, RotateCcw, Trash2, X } from "lucide-react"
import { useUi } from "../../stores/ui"
import { useWorkspace } from "../../stores/workspace"
import { useDocs } from "../../stores/docs"
import { deleteWorkspace, listWorkspaces, loadWorkspace, saveWorkspace } from "../../commands"
import { api } from "../../api"
import { toast } from "sonner"

function useEsc(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])
}

// ─── Workspaces ──────────────────────────────────────────────────────────────

export function WorkspacesModal() {
  const open = useUi((s) => s.workspacesOpen)
  if (!open) return null
  return <WorkspacesInner key="ws" />
}

function WorkspacesInner() {
  const closeAll = useUi((s) => s.closeAllModals)
  const [names, setNames] = useState<string[]>([])
  const [name, setName] = useState("")
  useEsc(closeAll)

  useEffect(() => {
    setNames(listWorkspaces())
  }, [])

  return (
    <div className="obs-modal-bg fixed inset-0 z-[85] flex items-center justify-center" onMouseDown={closeAll}>
      <div className="obs-modal obs-anim-in w-[460px] max-w-[92vw] p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2 text-[0.95rem] font-semibold">
          <Layers size={15} /> Manage workspaces
        </div>
        <div className="mb-3 text-[0.78rem]" style={{ color: "var(--text-muted)" }}>
          Save the current layout (tabs, splits, sidebars) under a name and switch between layouts later.
        </div>
        <div className="max-h-60 overflow-y-auto">
          {names.length === 0 ? (
            <div className="py-4 text-center text-[0.85rem]" style={{ color: "var(--text-faint)" }}>
              No saved workspaces yet
            </div>
          ) : (
            names.map((n) => (
              <div key={n} className="obs-tree-row !min-h-[36px]">
                <span className="truncate font-medium">{n}</span>
                <span className="ml-auto flex gap-1">
                  <button
                    className="obs-text-btn !px-2 !py-0 !text-[0.75rem]"
                    onClick={() => {
                      if (loadWorkspace(n)) {
                        toast(`Loaded workspace "${n}"`)
                        closeAll()
                      }
                    }}
                  >
                    Load
                  </button>
                  <button
                    className="obs-icon-btn !h-6 !w-6"
                    title="Delete workspace"
                    onClick={() => {
                      deleteWorkspace(n)
                      setNames(listWorkspaces())
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            className="obs-input !text-[0.85rem]"
            placeholder="Workspace name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                saveWorkspace(name)
                setNames(listWorkspaces())
                setName("")
              }
            }}
          />
          <button
            className="obs-btn-accent shrink-0"
            onClick={() => {
              const trimmed = name.trim()
              if (!trimmed) return
              saveWorkspace(trimmed)
              setNames(listWorkspaces())
              setName("")
              toast(`Saved workspace "${trimmed}"`)
            }}
          >
            Save current layout
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── File recovery (snapshots browser) ───────────────────────────────────────

interface SnapshotFileDto {
  noteId: string
  name: string
  count: number
  latest: string
  snapshots: { id: string; timestamp: string; size: number }[]
}

export function SnapshotsModal() {
  const open = useUi((s) => s.snapshotsOpen)
  const noteFilter = useUi((s) => s.snapshotsNote)
  if (!open) return null
  return <SnapshotsInner key={noteFilter ? `snaps-${noteFilter}` : "snaps"} noteFilter={noteFilter} />
}

function SnapshotsInner({ noteFilter }: { noteFilter: string | null }) {
  const closeAll = useUi((s) => s.closeAllModals)
  const vaultId = useWorkspace((s) => s.vaultId)
  const openNote = useWorkspace((s) => s.openNote)
  const [files, setFiles] = useState<SnapshotFileDto[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(noteFilter)
  const [preview, setPreview] = useState<{ id: string; content: string; noteId: string } | null>(null)
  const [reload, setReload] = useState(0)
  useEsc(closeAll)

  useEffect(() => {
    if (!vaultId) return
    void api.listSnapshots(vaultId).then(setFiles).catch(() => setFiles([]))
  }, [vaultId, reload])

  return (
    <div className="obs-modal-bg fixed inset-0 z-[85] flex items-center justify-center" onMouseDown={closeAll}>
      <div className="obs-modal obs-anim-in flex h-[560px] w-[720px] max-w-[94vw] flex-col p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2 text-[0.95rem] font-semibold">
          <History size={15} /> File recovery
        </div>
        <div className="mb-3 text-[0.78rem]" style={{ color: "var(--text-muted)" }}>
          {noteFilter ? (
            <>Version history of <span className="font-medium">{noteFilter}</span> — </>
          ) : null}
          Snapshots are taken before each save (at most every {useWorkspace.getState().settings.fileRecovery.intervalMinutes} minutes per
          file) and before deletions. They live in <code>.obsidian/snapshots/</code> inside your vault.
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {files === null ? (
            <div className="py-6 text-center text-[0.85rem]" style={{ color: "var(--text-faint)" }}>
              Loading snapshots…
            </div>
          ) : files.length === 0 ? (
            <div className="py-6 text-center text-[0.85rem]" style={{ color: "var(--text-faint)" }}>
              No snapshots yet — they appear as you edit.
            </div>
          ) : (
            files
            .filter((f) => !noteFilter || f.noteId === noteFilter)
            .map((f) => (
              <div key={f.noteId}>
                <div
                  className="obs-tree-row !min-h-[34px]"
                  onClick={() => setExpanded(expanded === f.noteId ? null : f.noteId)}
                >
                  <span className="truncate font-medium">{f.name}</span>
                  {!noteFilter && (
                    <span className="ml-2 truncate text-[0.72rem]" style={{ color: "var(--text-faint)" }}>
                      {f.noteId}
                    </span>
                  )}
                  <span className="ml-auto text-[0.72rem]" style={{ color: "var(--text-muted)" }}>
                    {f.count} snapshots · latest {f.latest ? format(new Date(f.latest), "MMM d, HH:mm") : "—"}
                  </span>
                </div>
                {expanded === f.noteId &&
                  f.snapshots.map((s) => (
                    <div key={s.id} className="obs-tree-row ml-4 !min-h-[30px] !text-[0.8rem]">
                      <span>{format(new Date(s.timestamp), "MMM d, HH:mm:ss")}</span>
                      <span className="ml-2 text-[0.7rem]" style={{ color: "var(--text-faint)" }}>
                        {(s.size / 1024).toFixed(1)} kB
                      </span>
                      <span className="ml-auto flex gap-1">
                        <button
                          className="obs-text-btn !px-2 !py-0 !text-[0.72rem]"
                          onClick={() => {
                            void api.readSnapshot(s.id).then((r) => setPreview({ id: s.id, content: r.content, noteId: r.noteId }))
                          }}
                        >
                          View
                        </button>
                        <button
                          className="obs-text-btn !px-2 !py-0 !text-[0.72rem]"
                          title="Restore this snapshot (a snapshot of the current file is kept first)"
                          onClick={() => {
                            useUi.getState().openConfirm({
                              title: `Restore "${f.name}"?`,
                              message: `Restore this note to its state from ${format(new Date(s.timestamp), "MMM d, HH:mm")}? A snapshot of the current file is kept first.`,
                              confirmLabel: "Restore",
                              onConfirm: () => {
                                void api
                                  .restoreSnapshot(s.id)
                                  .then(() => useDocs.getState().reload(f.noteId))
                                  .then(() => {
                                    window.dispatchEvent(
                                      new CustomEvent("obs-invalidate", {
                                        detail: { vaultId, noteId: f.noteId, kinds: ["tree", "index", "graph", "backlinks", "tags"] },
                                      }),
                                    )
                                    toast("Snapshot restored")
                                    setReload((n) => n + 1)
                                  })
                                  .catch((err) => toast(String((err as Error).message)))
                              },
                            })
                          }}
                        >
                          <RotateCcw size={11} className="mr-0.5 inline" /> Restore
                        </button>
                      </span>
                    </div>
                  ))}
              </div>
            ))
          )}
        </div>

        {/* snapshot preview */}
        {preview && (
          <div className="mt-3 flex min-h-0 flex-col rounded-lg border" style={{ borderColor: "var(--background-modifier-border)" }}>
            <div className="flex items-center justify-between px-3 py-1.5 text-[0.8rem] font-medium" style={{ borderBottom: "1px solid var(--background-modifier-border)" }}>
              <span>Snapshot preview — {preview.noteId}</span>
              <div className="flex gap-2">
                <button className="obs-text-btn !px-2 !py-0 !text-[0.72rem]" onClick={() => openNote(preview.noteId)}>
                  Open current file
                </button>
                <button className="obs-icon-btn !h-5 !w-5" onClick={() => setPreview(null)}>
                  <X size={12} />
                </button>
              </div>
            </div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap px-3 py-2 text-[0.78rem]" style={{ fontFamily: "var(--font-mono)" }}>
              {preview.content.slice(0, 4000)}
              {preview.content.length > 4000 ? "\n…" : ""}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
