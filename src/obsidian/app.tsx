"use client"

// ─── obsidianApp: providers, vault bootstrap, theme, hotkeys, modals ────────
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query"
import { Toaster, toast } from "sonner"
import { api } from "./api"
import { useWorkspace } from "./stores/workspace"
import { useUi } from "./stores/ui"
import { useIndex } from "./hooks"
import { AppShell } from "./components/shell"
import { CommandPalette, QuickSwitcher } from "./components/modals/command-palette"
import { SettingsModal } from "./components/modals/settings-modal"
import { RenameModal, TemplateModal, VaultPicker, MoveModal, MergeModal, ConfirmModal, PromptModal } from "./components/modals/small-modals"
import { PagePreview } from "./components/page-preview"
import { ContextMenuHost } from "./components/context-menu"
import { WorkspacesModal, SnapshotsModal } from "./components/modals/workspaces-recovery"
import { SlidesPresenter } from "./components/slides-presenter"
import { buildCommands } from "./commands"
import { effectiveHotkey, eventCombo, normalizeCombo } from "@/lib/obsidian/settings"
import { wrapSelection } from "@/lib/obsidian/links"

export default function ObsidianApp() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      }),
  )
  return (
    <QueryClientProvider client={client}>
      <ObsidianRoot />
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

function ObsidianRoot() {
  const [booted, setBooted] = useState(false)
  const vaultId = useWorkspace((s) => s.vaultId)
  const settings = useWorkspace((s) => s.settings)
  const applySettings = useWorkspace((s) => s.applySettings)
  const hydrate = useWorkspace((s) => s.hydrate)
  const reset = useWorkspace((s) => s.reset)
  const qc = useQueryClient()
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  // ── boot: settings + vault ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const s = (await api.getSettings()) as unknown as ReturnType<typeof useWorkspace.getState>["settings"]
        if (!cancelled) applySettings(s)
      } catch {
        /* keep defaults */
      }
      // restore last vault
      try {
        const raw = localStorage.getItem("obs-web-vault")
        if (raw) {
          const { id, name } = JSON.parse(raw)
          const vault = await api.listVaults()
          if (vault.some((v) => v.id === id) && !cancelled) {
            hydrate(id, name)
            setBooted(true)
            return
          }
        }
      } catch {
        /* no stored vault */
      }
      setBooted(true)
    })()
    return () => {
      cancelled = true
    }

  }, [])

  // ── web "Open in new window": a second browser tab pointed at one note ────
  useEffect(() => {
    if (!booted || !vaultId) return
    const params = new URLSearchParams(window.location.search)
    const openParam = params.get("openNote")
    if (!openParam) return
    // consume the parameter so a reload doesn't re-open the note
    params.delete("openNote")
    const qs = params.toString()
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`)
    const subpath = params.get("sub")
    useWorkspace.getState().openNote(decodeURIComponent(openParam), { newTab: true, subpath })
  }, [booted, vaultId])

  useEffect(() => {
    // hydration-complete marker via useSyncExternalStore below
  }, [])

  // logout of vault when it disappears (deleted)
  useEffect(() => {
    const handler = () => {
      if (vaultId) {
        void api.listVaults().then((vaults) => {
          if (!vaults.some((v) => v.id === vaultId)) {
            localStorage.removeItem("obs-web-vault")
            reset()
          }
        })
      }
    }
    window.addEventListener("obs-invalidate", handler as EventListener)
    return () => window.removeEventListener("obs-invalidate", handler as EventListener)
  }, [vaultId, reset])

  // open Search panel when tag node or UI component dispatches obs-open-search
  useEffect(() => {
    const handler = (e: Event) => {
      const query = (e as CustomEvent<{ query?: string }>).detail?.query
      if (typeof query === "string") {
        useUi.getState().setSearchQuery(query)
        useWorkspace.getState().setLeftTab("search")
      }
    }
    window.addEventListener("obs-open-search", handler)
    return () => window.removeEventListener("obs-open-search", handler)
  }, [])

  // ── theme application ─────────────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = settings.appearance.theme
    root.style.setProperty("--interactive-accent", settings.appearance.accentColor)
    root.style.fontSize = `${settings.appearance.baseFontSize}px`
  }, [settings.appearance])

  if (!mounted || !booted) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "var(--background-secondary-alt)" }}>
        <div className="text-[0.9rem]" style={{ color: "var(--text-faint)" }}>
          Loading Basalt…
        </div>
      </div>
    )
  }

  if (!vaultId) {
    return <VaultPicker fullscreen />
  }

  return (
    <>
      <LinkIndexSync />
      <Invalidator />
      <GlobalHotkeys />
      <AppShell />
      <CommandPalette />
      <QuickSwitcher />
      <SettingsModal />
      <RenameModal />
      <MoveModal />
      <MergeModal />
      <ConfirmModal />
      <PromptModal />
      <WorkspacesModal />
      <SnapshotsModal />
      <SlidesPresenter />
      <TemplateModal />
      <VaultPicker />
      <PagePreview />
      <ContextMenuHost />
    </>
  )
}

/** Pipes react-query index data into the workspace store for link resolution. */
function LinkIndexSync() {
  const { data } = useIndex()
  const setLinkIndex = useWorkspace((s) => s.setLinkIndex)
  useEffect(() => {
    if (data) setLinkIndex(data)
  }, [data, setLinkIndex])
  return null
}

/** Listens for obs-invalidate events (saves, creates, deletes) and refreshes queries. */
function Invalidator() {
  const qc = useQueryClient()
  const vaultId = useWorkspace((s) => s.vaultId)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { vaultId: string; noteId?: string; kinds?: string[] }
      const kinds = detail.kinds ?? ["tree", "index", "graph", "tags", "backlinks", "bookmarks", "search"]
      const seen = new Set<string>()
      kinds.forEach((k) => {
        if (seen.has(k)) return
        seen.add(k)
        qc.invalidateQueries({ queryKey: [k, k === "backlinks" ? undefined : detail.vaultId ?? vaultId] })
      })
      // notes content cache for embeds/previews
      if (detail.noteId) qc.invalidateQueries({ queryKey: ["note", detail.noteId] })
      qc.invalidateQueries({ queryKey: ["backlinks"] })
    }
    window.addEventListener("obs-invalidate", handler as EventListener)
    return () => window.removeEventListener("obs-invalidate", handler as EventListener)
  }, [qc, vaultId])
  return null
}

/** Global keyboard shortcuts (obsidian defaults + user overrides). */
function GlobalHotkeys() {
  const keydownRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keydownRef.current = (e: KeyboardEvent) => {
    const ws = useWorkspace.getState()
    const ui = useUi.getState()
    if (!ws.vaultId) return

    const target = e.target as HTMLElement | null
    if (target?.closest?.('[data-hotkey-capture="true"]')) return

    if (e.key === "Escape") return // handled by modals/menus
    const combo = eventCombo(e)
    const mod = e.ctrlKey || e.metaKey

    // editor formatting when typing in a textarea
    const inTextarea = target?.tagName === "TEXTAREA" || target?.isContentEditable
    if (inTextarea && target?.tagName === "TEXTAREA") {
      const boldCombo = effectiveHotkey("bold", ws.settings.hotkeys)
      const italicCombo = effectiveHotkey("italic", ws.settings.hotkeys)
      if ((boldCombo && normalizeCombo(boldCombo) === combo) || (italicCombo && normalizeCombo(italicCombo) === combo)) {
        e.preventDefault()
        const ta = target as HTMLTextAreaElement
        const wrap = boldCombo && normalizeCombo(boldCombo) === combo ? "**" : "*"
        const res = wrapSelection(ta.value, ta.selectionStart, ta.selectionEnd, wrap)
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
        setter?.call(ta, res.text)
        ta.dispatchEvent(new Event("input", { bubbles: true }))
        ta.setSelectionRange(res.selStart, res.selEnd)
        return
      }
    }

    // pause global app hotkeys while text-entry modals or settings are open
    if (ui.settingsOpen || ui.renameTarget || ui.moveTarget || ui.mergeTarget || ui.confirmState || ui.promptState || ui.slidesActive) {
      return
    }

    // Tab navigation shortcuts
    if (e.ctrlKey && e.key === "Tab") {
      e.preventDefault()
      ws.cycleTab(e.shiftKey ? -1 : 1)
      return
    }

    // Built-in commands bound via effectiveHotkey (defaults + Settings overrides)
    const commands = buildCommands()
    for (const cmd of commands) {
      const hk = effectiveHotkey(cmd.id, ws.settings.hotkeys)
      if (hk && normalizeCombo(hk) === combo) {
        e.preventDefault()
        void cmd.run()
        return
      }
    }

    if (!mod) return
    if (combo === "mod+s") {
      e.preventDefault()
      toast("All changes are saved automatically")
    } else if (combo === "mod+t") {
      e.preventDefault()
      ws.newEmptyTab()
    } else if (combo === "mod+shift+t") {
      e.preventDefault()
      ws.reopenClosedTab()
    } else if (combo === "mod+shift+n") {
      e.preventDefault()
      const newNoteCmd = commands.find((c) => c.id === "new-note")
      void newNoteCmd?.run()
    }
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => keydownRef.current(e)
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [])

  return null
}
