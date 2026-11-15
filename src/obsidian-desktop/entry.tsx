// ─────────────────────────────────────────────────────────────────────────────
// Desktop renderer entry — renders the web app's obsidianApp unchanged, and
// wires the desktop bridge events into the web app's own event system:
//
//   • main → "app-invalidate"  →  window "obs-invalidate" CustomEvent
//     (react-query refetches exactly like the web app does after mutations)
//   • clean docs (no unsaved edits) are reloaded when their file changes on
//     disk — edit a note in VS Code and the app follows along
//   • native menu events → the app's own commands
//   • external links → confirmation dialog via the main process (privacy)
//   • window close → flush pending autosaves first
//   • "?win=note&note=…" → a single-note window ("Open in new window")
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"
import ObsidianApp from "@/obsidian/app"
import { useWorkspace } from "@/obsidian/stores/workspace"
import { useUi } from "@/obsidian/stores/ui"
import { useDocs } from "@/obsidian/stores/docs"
import { buildCommands, openDailyNote, exportNoteToPdf } from "@/obsidian/commands"
import { EditorPane } from "@/obsidian/components/editor-pane"
import { ContextMenuHost } from "@/obsidian/components/context-menu"
import { RenameModal, MoveModal, MergeModal, ConfirmModal, PromptModal } from "@/obsidian/components/modals/small-modals"
import { wrapSelection } from "@/lib/obsidian/links"
import { useIndex } from "@/obsidian/hooks"
import { api } from "./api-ipc"

const params = new URLSearchParams(window.location.search)
const isNoteWindow = params.get("win") === "note" && !!params.get("note")

// ── Desktop frame & titlebar theme sync ────────────────────────────────────
document.documentElement.classList.add("obs-desktop")
if (window.desktop.platform === "win32") document.documentElement.classList.add("obs-win-frameless")
else if (window.desktop.platform === "darwin") document.documentElement.classList.add("obs-mac-frameless")

const syncTitleBarTheme = () => {
  if (isNoteWindow) return
  const t = document.documentElement.dataset.theme === "light" ? "light" : "dark"
  window.desktop.setTitleBarTheme?.(t)
}
syncTitleBarTheme()
new MutationObserver(syncTitleBarTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })

// ── File-system invalidation (external edits, renames in Explorer, …) ────────
window.desktop.onInvalidate((detail) => {
  window.dispatchEvent(new CustomEvent("obs-invalidate", { detail }))
  const ids = Array.isArray(detail.noteIds) && detail.noteIds.length > 0 ? detail.noteIds : detail.noteId ? [detail.noteId] : []
  for (const id of ids) {
    const entry = useDocs.getState().docs[id]
    // reload only when there are no unsaved local edits
    if (entry && !entry.loading && entry.content === entry.savedContent) {
      void useDocs.getState().reload(id)
    }
  }
})

// ── Native menu → app commands ───────────────────────────────────────────────
window.desktop.onMenu((id) => {
  const ws = useWorkspace.getState()
  const ui = useUi.getState()
  const activeTab = ws.getActiveTab()
  switch (id) {
    case "new-note": {
      const cmd = buildCommands().find((c) => c.id === "new-note")
      void cmd?.run()
      break
    }
    case "new-canvas": {
      const cmd = buildCommands().find((c) => c.id === "new-canvas")
      void cmd?.run()
      break
    }
    case "open-vault":
      ui.openVaultPicker()
      break
    case "close-tab":
      if (activeTab) ws.closeTab(activeTab.id)
      break
    case "toggle-reading":
      if (activeTab) ws.setTabMode(activeTab.id, activeTab.mode === "read" ? ws.settings.editor.defaultEditMode : "read")
      break
    case "open-graph":
      ws.openGraph()
      break
    case "daily-note":
      void openDailyNote(0)
      break
    case "search":
      ws.setLeftTab("search")
      break
    case "find":
      if (activeTab) ui.requestFind(activeTab.id)
      break
    case "export-pdf":
      if (activeTab?.noteId && !/\.canvas$/i.test(activeTab.noteId)) void exportNoteToPdf(activeTab.noteId)
      break
    case "toggle-theme": {
      const next = ws.settings.appearance.theme === "dark" ? "light" : "dark"
      ws.applySettings({ ...ws.settings, appearance: { ...ws.settings.appearance, theme: next } })
      void api.putSettings({ appearance: { ...ws.settings.appearance, theme: next } })
      break
    }
  }
})

// ── Flush pending autosaves before the window closes ─────────────────────────
function flushBeforeUnload(): void {
  window.dispatchEvent(new CustomEvent("obs-flush-active-draft"))
  void useDocs.getState().flushAll()
}
window.addEventListener("beforeunload", flushBeforeUnload)

window.desktop.onPrepareClose(() => {
  window.dispatchEvent(new CustomEvent("obs-flush-active-draft"))
  void useDocs
    .getState()
    .flushAll()
    .catch(() => undefined)
    .then(() => window.desktop.readyToClose())
})

// ── External links: ask first, then hand off to the system browser ──────────
document.addEventListener(
  "click",
  (e) => {
    const target = e.target as HTMLElement | null
    const anchor = target?.closest?.("a")
    if (!anchor) return
    const href = anchor.getAttribute("href") || ""
    if (/^(?:https?:\/\/|mailto:)/i.test(href)) {
      e.preventDefault()
      void window.desktop.openExternal(href)
    }
  },
  true,
)

// ── Swallow the intentional "canceled" rejections (vault picker dialogs) ─────
window.addEventListener("unhandledrejection", (e) => {
  if (e.reason instanceof Error && e.reason.message === "canceled") e.preventDefault()
})

// ── Boot: full workspace, or a single-note window ("Open in new window") ────

if (isNoteWindow) {
  // The note window must never persist its own (single-tab) workspace over the
  // main window's layout — both share this localStorage origin. Reads are fine.
  const origSetItem = localStorage.setItem.bind(localStorage)
  localStorage.setItem = (key: string, value: string) => {
    if (typeof key === "string" && key.startsWith("obs-web-workspace")) return
    origSetItem(key, value)
  }
  createRoot(document.getElementById("root")!).render(<NoteWindowApp noteId={params.get("note")!} subpath={params.get("sub")} />)
} else {
  createRoot(document.getElementById("root")!).render(<ObsidianApp />)
}

/** A real second obsidian window: one note, fully editable (live preview,
 *  source, reading view, properties), autosaving through the same IPC API
 *  into the same vault files as the main window. */
function NoteWindowApp({ noteId, subpath }: { noteId: string; subpath: string | null }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  )
  return (
    <QueryClientProvider client={client}>
      <NoteWindowIndexSync />
      <NoteWindowFormatHotkeys />
      <NoteWindowInner noteId={noteId} subpath={subpath} />
      <RenameModal />
      <MoveModal />
      <MergeModal />
      <ConfirmModal />
      <PromptModal />
      <ContextMenuHost />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--popover)",
            color: "var(--text-normal)",
            border: "1px solid var(--background-modifier-border)",
            fontSize: "0.85rem",
          },
        }}
      />
    </QueryClientProvider>
  )
}

/** Supports Mod+B / Mod+I and Mod+F inside popped-out note windows. */
function NoteWindowFormatHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()
      const target = e.target as HTMLElement | null
      if ((key === "b" || key === "i") && target?.tagName === "TEXTAREA") {
        e.preventDefault()
        const ta = target as HTMLTextAreaElement
        const res = wrapSelection(ta.value, ta.selectionStart, ta.selectionEnd, key === "b" ? "**" : "*")
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
        setter?.call(ta, res.text)
        ta.dispatchEvent(new Event("input", { bubbles: true }))
        ta.setSelectionRange(res.selStart, res.selEnd)
      } else if (key === "f" || key === "h" || key === "e") {
        const ws = useWorkspace.getState()
        const tab = ws.getActiveTab()
        if (!tab) return
        e.preventDefault()
        if (key === "e") ws.setTabMode(tab.id, tab.mode === "read" ? ws.settings.editor.defaultEditMode : "read")
        else if (key === "f") useUi.getState().requestFind(tab.id)
        else useUi.getState().requestFind(tab.id, { showReplace: true })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  return null
}

/** Keeps the note window's link index fresh (same pattern as app.tsx). */
function NoteWindowIndexSync() {
  const { data } = useIndex()
  const setLinkIndex = useWorkspace((s) => s.setLinkIndex)
  useEffect(() => {
    if (data) setLinkIndex(data)
  }, [data, setLinkIndex])
  return null
}

function NoteWindowInner({ noteId, subpath }: { noteId: string; subpath: string | null }) {
  const applySettings = useWorkspace((s) => s.applySettings)
  const settings = useWorkspace((s) => s.settings)
  const openNote = useWorkspace((s) => s.openNote)
  const activeTab = useWorkspace((s) => s.getActiveTab())
  const [booted, setBooted] = useState(false)
  const [winTitle, setWinTitle] = useState(() => noteId.replace(/\.md$/i, ""))

  // boot: settings + vault id (straight into the store — the note window keeps
  // its own single-tab workspace and never touches the main window's layout)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const s = (await api.getSettings()) as unknown as ReturnType<typeof useWorkspace.getState>["settings"]
        if (!cancelled) applySettings(s)
      } catch {
        /* keep defaults */
      }
      try {
        const raw = localStorage.getItem("obs-web-vault")
        if (raw) {
          const { id, name } = JSON.parse(raw)
          const vaults = await api.listVaults()
          if (vaults.some((v) => v.id === id) && !cancelled) {
            useWorkspace.setState({ vaultId: id, vaultName: name, hydrated: true })
            openNote(noteId, { subpath })
          }
        }
      } catch {
        /* no vault — the note simply won't load */
      }
      if (!cancelled) setBooted(true)
    })()
    return () => {
      cancelled = true
    }
  }, [applySettings, openNote, noteId, subpath])

  // theme + sync from main window + window title
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = settings.appearance.theme
    root.style.setProperty("--interactive-accent", settings.appearance.accentColor)
    root.style.fontSize = `${settings.appearance.baseFontSize}px`
  }, [settings.appearance])

  useEffect(() => {
    const unsub = window.desktop.onThemeSync?.((theme) => {
      document.documentElement.dataset.theme = theme
      const cur = useWorkspace.getState().settings
      if (cur.appearance.theme !== theme) {
        applySettings({ ...cur, appearance: { ...cur.appearance, theme } })
      }
    })
    return () => unsub?.()
  }, [applySettings])

  useEffect(() => {
    if (!booted) return
    void api
      .note(activeTab?.noteId ?? noteId)
      .then((n) => {
        document.title = `${n.name} — Basalt`
        setWinTitle(n.name)
      })
      .catch(() => undefined)
  }, [booted, activeTab?.noteId, noteId])

  // scroll to heading/block after content loads (same event the app uses)
  useEffect(() => {
    if (!booted || !subpath) return
    const t = setTimeout(() => {
      window.dispatchEvent(new CustomEvent("obs-scroll-to", { detail: { noteId, subpath } }))
    }, 400)
    return () => clearTimeout(t)
  }, [booted, noteId, subpath])

  if (!booted) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "var(--background-primary)" }}>
        <div className="text-[0.9rem]" style={{ color: "var(--text-faint)" }}>
          Loading note…
        </div>
      </div>
    )
  }

  // follow the window's own active tab so links clicked inside it navigate
  const shownTab =
    activeTab && (activeTab.type === "note" || activeTab.type === "attachment")
      ? activeTab
      : { id: `note-win-${noteId}`, type: "note" as const, noteId, mode: "read" as const, history: [] as string[], historyIndex: -1 }

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: "var(--background-primary)" }}>
      {window.desktop.platform === "win32" && (
        <div
          className="obs-win-drag obs-win-caption-slot flex shrink-0 items-center justify-center border-b text-[0.78rem] font-medium"
          style={{
            height: 40,
            paddingLeft: 138,
            background: "var(--background-secondary)",
            borderColor: "var(--background-modifier-border)",
            color: "var(--text-muted)",
          }}
        >
          <span className="truncate">{winTitle || "Note"}</span>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ fontSize: `${settings.appearance.baseFontSize}px` }}>
        <EditorPane key={shownTab.noteId ?? noteId} tab={shownTab} />
      </div>
    </div>
  )
}
