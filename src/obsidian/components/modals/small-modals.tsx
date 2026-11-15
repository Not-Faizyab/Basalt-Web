"use client"

// ─── Small modals: rename, template picker, vault picker ────────────────────
import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { FolderClosed, FileText, GitFork, Plus, Search } from "lucide-react"
import { useUi } from "../../stores/ui"
import { useWorkspace } from "../../stores/workspace"
import { useNoteMutations, useTree, useIndex } from "../../hooks"
import { api } from "../../api"
import { listTemplates, insertTemplate } from "../../commands"
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

// ─── Rename modal ────────────────────────────────────────────────────────────

export function RenameModal() {
  const target = useUi((s) => s.renameTarget)
  if (!target) return null
  return <RenameInner key={target.id} target={target} />
}

function RenameInner({ target }: { target: { kind: "note" | "folder"; id: string; currentName: string } }) {
  const closeAll = useUi((s) => s.closeAllModals)
  const { renameNote, renameFolder } = useNoteMutations()
  const [name, setName] = useState(target.currentName)

  useEsc(closeAll)

  const submit = () => {
    const trimmed = name.trim().replace(/\.md$/, "")
    if (!trimmed || trimmed === target.currentName) {
      closeAll()
      return
    }
    if (target.kind === "note") renameNote.mutate({ id: target.id, name: trimmed })
    else renameFolder.mutate({ id: target.id, name: trimmed })
    closeAll()
  }

  return (
    <div className="obs-modal-bg fixed inset-0 z-[85] flex items-center justify-center" onMouseDown={closeAll}>
      <div className="obs-modal obs-anim-in w-[440px] max-w-[92vw] p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-1 text-[0.95rem] font-semibold">{target.kind === "note" ? "Rename note" : "Rename folder"}</div>
        <div className="mb-3 text-[0.78rem]" style={{ color: "var(--text-muted)" }}>
          Current name: {target.currentName}. The .md extension is managed for you.
        </div>
        <input
          className="obs-input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit()
          }}
          onFocus={(e) => e.target.select()}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button className="obs-text-btn" onClick={closeAll}>
            Cancel
          </button>
          <button className="obs-btn-accent" onClick={submit}>
            Rename
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Move to folder modal (obsidian's "Move file to folder…") ────────────────

export function MoveModal() {
  const target = useUi((s) => s.moveTarget)
  if (!target) return null
  return <MoveInner key={target.id} target={target} />
}

function MoveInner({ target }: { target: { kind: "note" | "folder"; id: string; currentName: string } }) {
  const closeAll = useUi((s) => s.closeAllModals)
  const { data: tree } = useTree()
  const [filter, setFilter] = useState("")

  useEsc(closeAll)

  const folders = useMemo(() => {
    const list = tree?.folders ?? []
    const nameOf = (f: (typeof list)[number]): string => {
      const parts = [f.name]
      let cur = f
      const guard = new Set<string>()
      while (cur.parentId && !guard.has(cur.parentId)) {
        guard.add(cur.parentId)
        const parent = list.find((x) => x.id === cur.parentId)
        if (!parent) break
        parts.unshift(parent.name)
        cur = parent
      }
      return parts.join(" / ")
    }
    return list
      .filter((f) => f.id !== target.id)
      .map((f) => ({ id: f.id, label: nameOf(f) }))
      .filter((f) => f.label.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [tree, filter, target.id])

  const { moveNote, moveFolder } = useNoteMutations()

  const moveTo = (folderId: string | null) => {
    if (target.kind === "note") moveNote.mutate({ id: target.id, folderId })
    else moveFolder.mutate({ id: target.id, parentId: folderId })
    closeAll()
  }

  return (
    <div className="obs-modal-bg fixed inset-0 z-[85] flex items-center justify-center" onMouseDown={closeAll}>
      <div className="obs-modal obs-anim-in w-[460px] max-w-[92vw] p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-1 text-[0.95rem] font-semibold">Move {target.kind === "note" ? "file" : "folder"} to folder</div>
        <div className="mb-3 text-[0.78rem]" style={{ color: "var(--text-muted)" }}>
          Moving &quot;{target.currentName}&quot;. Links keep working — they follow the file.
        </div>
        <div className="mb-2 flex items-center gap-1">
          <Search size={13} className="ml-1.5 shrink-0" style={{ color: "var(--text-faint)" }} />
          <input
            className="obs-input !py-1 !text-[0.85rem]"
            placeholder="Find or create a folder…"
            value={filter}
            autoFocus
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // exact match → move; otherwise create the folder first (obsidian behavior)
                const exact = folders.find((f) => f.label.toLowerCase() === filter.toLowerCase())
                if (exact) moveTo(exact.id)
                else {
                  const name = filter.trim()
                  if (!name) return
                  closeAll()
                  const vaultId = useWorkspace.getState().vaultId
                  void api.createFolder(vaultId!, name, null).then((created) => {
                    window.dispatchEvent(new CustomEvent("obs-invalidate", { detail: { vaultId, kinds: ["tree"] } }))
                    if (target.kind === "note") moveNote.mutate({ id: target.id, folderId: created.id })
                    else moveFolder.mutate({ id: target.id, parentId: created.id })
                  })
                }
              }
            }}
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          <div
            className="obs-tree-row !text-[0.85rem]"
            onClick={() => moveTo(null)}
          >
            <FolderClosed size={14} className="opacity-60" />
            <span className="italic" style={{ color: "var(--text-muted)" }}>/ (vault root)</span>
          </div>
          {folders.map((f) => (
            <div key={f.id} className="obs-tree-row !text-[0.85rem]" onClick={() => moveTo(f.id)}>
              <FolderClosed size={14} className="opacity-60" />
              {f.label}
            </div>
          ))}
          {folders.length === 0 && (
            <div className="px-2 py-3 text-[0.8rem]" style={{ color: "var(--text-faint)" }}>
              No matching folder — press Enter to create one.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Merge note modal (obsidian's Note Composer "Merge … with …") ───────────

export function MergeModal() {
  const target = useUi((s) => s.mergeTarget)
  if (!target) return null
  return <MergeInner key={target.noteId} target={target} />
}

function MergeInner({ target }: { target: { noteId: string; noteName: string } }) {
  const closeAll = useUi((s) => s.closeAllModals)
  const { data: index } = useIndex()
  const [filter, setFilter] = useState("")

  useEsc(closeAll)

  const notes = useMemo(
    () =>
      (index ?? [])
        .filter((e) => e.id !== target.noteId && !/\.canvas$/i.test(e.id))
        .filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()))
        .slice(0, 60),
    [index, filter, target.noteId],
  )

  const pick = (noteId: string) => {
    closeAll()
    void import("../../commands").then(({ mergeNoteInto }) => mergeNoteInto(target.noteId, noteId))
  }

  return (
    <div className="obs-modal-bg fixed inset-0 z-[85] flex items-center justify-center" onMouseDown={closeAll}>
      <div className="obs-modal obs-anim-in w-[460px] max-w-[92vw] p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-1 text-[0.95rem] font-semibold">Merge entire file with…</div>
        <div className="mb-3 text-[0.78rem]" style={{ color: "var(--text-muted)" }}>
          &quot;{target.noteName || target.noteId}&quot; will be appended to the note you pick, links to it will be
          rewritten, and it will be moved to trash.
        </div>
        <div className="mb-2 flex items-center gap-1">
          <Search size={13} className="ml-1.5 shrink-0" style={{ color: "var(--text-faint)" }} />
          <input
            className="obs-input !py-1 !text-[0.85rem]"
            placeholder="Merge with…"
            value={filter}
            autoFocus
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && notes.length > 0) pick(notes[0].id)
            }}
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {notes.map((n) => (
            <div key={n.id} className="obs-tree-row !text-[0.85rem]" onClick={() => pick(n.id)}>
              <FileText size={14} className="opacity-60" />
              <span className="truncate">{n.name}</span>
              <span className="ml-auto truncate text-[0.7rem]" style={{ color: "var(--text-faint)" }}>
                {n.path}
              </span>
            </div>
          ))}
          {notes.length === 0 && (
            <div className="px-2 py-3 text-[0.8rem]" style={{ color: "var(--text-faint)" }}>
              No other notes in this vault yet.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Template picker ─────────────────────────────────────────────────────────

export function TemplateModal() {
  const open = useUi((s) => s.templateOpen)
  if (!open) return null
  return <TemplateInner key="tpl" />
}

function TemplateInner() {
  const closeAll = useUi((s) => s.closeAllModals)
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    void listTemplates().then(setTemplates)
  }, [])

  useEsc(closeAll)

  return (
    <div className="obs-modal-bg fixed inset-0 z-[85] flex items-center justify-center" onMouseDown={closeAll}>
      <div className="obs-modal obs-anim-in w-[440px] max-w-[92vw] p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 text-[0.95rem] font-semibold">Insert template</div>
        {templates.length === 0 ? (
          <div className="py-4 text-center text-[0.85rem]" style={{ color: "var(--text-faint)" }}>
            No templates found. Create notes in the &quot;Templates&quot; folder first.
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {templates.map((t) => (
              <div
                key={t.id}
                className="obs-tree-row !text-[0.875rem]"
                onClick={() => {
                  closeAll()
                  void insertTemplate(t.id).then(() => toast(`Template inserted: ${t.name}`))
                }}
              >
                <FileText size={14} className="opacity-60" />
                {t.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Vault picker (also the first-run screen) ────────────────────────────────

export function VaultPicker({ fullscreen = false }: { fullscreen?: boolean }) {
  const open = useUi((s) => s.vaultPickerOpen) || fullscreen
  const closeAll = useUi((s) => s.closeAllModals)
  const [vaults, setVaults] = useState<{ id: string; name: string; noteCount: number }[]>([])
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(true)
  const hydrate = useWorkspace((s) => s.hydrate)

  useEffect(() => {
    void api.listVaults().then((v) => {
      setVaults(v)
      setLoading(false)
    })
  }, [])

  useEsc(fullscreen ? () => {} : closeAll)

  if (!open) return null

  const openVault = (id: string, vaultName: string) => {
    localStorage.setItem("obs-web-vault", JSON.stringify({ id, name: vaultName }))
    hydrate(id, vaultName)
    if (!fullscreen) closeAll()
    window.dispatchEvent(new CustomEvent("obs-invalidate", { detail: { vaultId: id, kinds: ["tree", "index", "graph", "tags", "bookmarks"] } }))
  }

  const createVault = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const vault = await api.createVault(trimmed)
    setName("")
    openVault(vault.id, vault.name)
    toast(`Created vault "${vault.name}"`)
  }

  const content = (
    <div className={`flex flex-col items-center ${fullscreen ? "w-full max-w-md" : "w-[520px] max-w-[92vw]"} obs-anim-in`}>
      {fullscreen ? (
        <>
          <svg width="52" height="52" viewBox="0 0 24 24" className="mb-3">
            <path d="M12 1.5 3.5 8.2 12 22.5l8.5-14.3L12 1.5Z" fill="var(--interactive-accent)" opacity="0.85" />
            <path d="M12 1.5 6.3 8.2 12 22.5V1.5Z" fill="var(--interactive-accent)" opacity="0.55" />
            <path d="M12 1.5 3.5 8.2h17L12 1.5Z" fill="var(--interactive-accent)" opacity="0.35" />
          </svg>
          <h1 className="text-[1.7rem] font-bold tracking-tight" style={{ color: "var(--text-normal)" }}>
            Basalt
          </h1>
          <p className="mb-8 mt-1 text-[0.85rem]" style={{ color: "var(--text-muted)" }}>
            {typeof window !== "undefined" &&
            (window as unknown as { desktop?: { platform?: string } }).desktop &&
            (window as unknown as { desktop?: { platform?: string } }).desktop?.platform !== "web-demo"
              ? "Sharpen your thinking"
              : "Sharpen your thinking — web edition"}
          </p>
        </>
      ) : (
        <div className="mb-4 w-full text-[1.05rem] font-semibold">Open vault</div>
      )}

      {loading ? (
        <div className="py-8 text-[0.85rem]" style={{ color: "var(--text-faint)" }}>
          Loading vaults…
        </div>
      ) : (
        <>
          <div className={`${fullscreen ? "w-full" : ""} space-y-1.5`}>
            {vaults.map((v) => (
              <button
                key={v.id}
                className="obs-tree-row !min-h-[44px] w-full !justify-start !px-3 !text-[0.9rem]"
                onClick={() => openVault(v.id, v.name)}
              >
                <FolderClosed size={16} className="opacity-70" />
                <span className="font-medium">{v.name}</span>
                <span className="text-[0.72rem]" style={{ color: "var(--text-faint)" }}>
                  {v.noteCount} notes
                </span>
              </button>
            ))}
          </div>

          <div className={`${fullscreen ? "w-full" : ""} mt-6 rounded-lg border p-3.5`} style={{ borderColor: "var(--background-modifier-border)" }}>
            <div className="mb-2 text-[0.82rem] font-medium">Create new vault</div>
            <div className="flex gap-2">
              <input
                className="obs-input !text-[0.85rem]"
                placeholder="Vault name…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createVault()
                }}
              />
              <button className="obs-btn-accent shrink-0 !px-3" onClick={() => void createVault()} title="Create vault">
                <Plus size={15} />
              </button>
            </div>
          </div>

          {vaults.length === 0 && !loading && (
            <div className="mt-4 text-[0.8rem]" style={{ color: "var(--text-faint)" }}>
              No vaults yet — create one above.
            </div>
          )}
        </>
      )}
    </div>
  )

  if (fullscreen) {
    return (
      <div className="relative flex h-screen w-full items-center justify-center" style={{ background: "var(--background-secondary-alt)" }}>
        <div className="obs-win-drag fixed inset-x-0 top-0 z-10 h-10" />
        {content}
      </div>
    )
  }

  return (
    <div className="obs-modal-bg fixed inset-0 z-[85] flex items-center justify-center" onMouseDown={closeAll}>
      <div className="obs-modal obs-anim-in max-h-[85vh] overflow-y-auto p-5" onMouseDown={(e) => e.stopPropagation()}>
        {content}
      </div>
    </div>
  )
}

// ─── Confirm modal (replaces native window.confirm cleanly) ──────────────────

export function ConfirmModal() {
  const state = useUi((s) => s.confirmState)
  if (!state) return null
  return <ConfirmInner state={state} />
}

function ConfirmInner({ state }: { state: NonNullable<ReturnType<typeof useUi.getState>["confirmState"]> }) {
  const dismiss = () => useUi.setState({ confirmState: null })
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        dismiss()
      } else if (e.key === "Enter") {
        e.preventDefault()
        e.stopPropagation()
        dismiss()
        void state.onConfirm()
      }
    }
    window.addEventListener("keydown", h, true)
    return () => window.removeEventListener("keydown", h, true)
  }, [state])

  return (
    <div className="obs-modal-bg fixed inset-0 z-[95] flex items-center justify-center" onMouseDown={dismiss}>
      <div className="obs-modal obs-anim-in w-[420px] max-w-[92vw] p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-1.5 text-[0.95rem] font-semibold">{state.title}</div>
        <div className="mb-4 text-[0.82rem] leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {state.message}
        </div>
        <div className="flex justify-end gap-2">
          <button className="obs-text-btn" onClick={dismiss}>
            Cancel
          </button>
          <button
            className="obs-btn-accent"
            style={state.danger ? { background: "var(--text-error)", color: "#fff" } : undefined}
            autoFocus
            onClick={() => {
              dismiss()
              void state.onConfirm()
            }}
          >
            {state.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Prompt modal (replaces Electron-blocked window.prompt) ──────────────────

export function PromptModal() {
  const state = useUi((s) => s.promptState)
  if (!state) return null
  return <PromptInner key={state.title + (state.initialValue ?? "")} state={state} />
}

function PromptInner({ state }: { state: NonNullable<ReturnType<typeof useUi.getState>["promptState"]> }) {
  const [value, setValue] = useState(state.initialValue ?? "")
  const dismiss = () => useUi.setState({ promptState: null })

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        dismiss()
      }
    }
    window.addEventListener("keydown", h, true)
    return () => window.removeEventListener("keydown", h, true)
  }, [])

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    dismiss()
    void state.onSubmit(trimmed)
  }

  return (
    <div className="obs-modal-bg fixed inset-0 z-[95] flex items-center justify-center" onMouseDown={dismiss}>
      <div className="obs-modal obs-anim-in w-[420px] max-w-[92vw] p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-1.5 text-[0.95rem] font-semibold">{state.title}</div>
        {state.message && (
          <div className="mb-3 text-[0.78rem]" style={{ color: "var(--text-muted)" }}>
            {state.message}
          </div>
        )}
        <input
          className="obs-input"
          autoFocus
          value={value}
          placeholder={state.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button className="obs-text-btn" onClick={dismiss}>
            Cancel
          </button>
          <button className="obs-btn-accent" onClick={submit} disabled={!value.trim()}>
            {state.confirmLabel ?? "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}

void useQueryClient
void GitFork
void Search
void useMemo
