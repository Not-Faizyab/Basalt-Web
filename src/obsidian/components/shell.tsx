"use client"

// ─── App shell: ribbon + sidebars + panes + status bar ──────────────────────
import { useCallback, useRef } from "react"
import { Settings, GitFork, CalendarDays, FileInput, HelpCircle, LayoutDashboard, FileSearch, BookOpen, PencilLine, Terminal, Vault } from "lucide-react"
import { useWorkspace } from "../stores/workspace"
import { useUi } from "../stores/ui"
import { useBacklinks, useTree } from "../hooks"
import { useDocs } from "../stores/docs"
import { effectiveHotkey, prettyCombo } from "@/lib/obsidian/settings"
import { charCount, wordCount } from "@/lib/obsidian/blocks"
import { PaneTree } from "./panes"
import { LeftSidebar } from "./left-sidebar"
import { RightSidebar } from "./right-sidebar"
import { openDailyNote, insertTemplate } from "../commands"
import { toast } from "sonner"

export function AppShell() {
  const root = useWorkspace((s) => s.root)
  const leftSidebar = useWorkspace((s) => s.leftSidebar)
  const rightSidebar = useWorkspace((s) => s.rightSidebar)
  const setSidebarWidth = useWorkspace((s) => s.setSidebarWidth)
  const core = useWorkspace((s) => s.settings.corePlugins)

  const dragSide = useRef<"left" | "right" | null>(null)

  const onDragStart = (side: "left" | "right") => (e: React.MouseEvent) => {
    e.preventDefault()
    dragSide.current = side
    const startX = e.clientX
    const startW = side === "left" ? leftSidebar.width : rightSidebar.width
    const move = (ev: MouseEvent) => {
      const delta = side === "left" ? ev.clientX - startX : startX - ev.clientX
      setSidebarWidth(side, startW + delta)
    }
    const up = () => {
      dragSide.current = null
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
  }

  return (
    <div className="obs-app">
      <div className="flex min-h-0 flex-1">
        <Ribbon core={core} />

        {leftSidebar.open && (
          <>
            <div style={{ width: leftSidebar.width }} className="min-w-0 shrink-0">
              <div className="h-full" style={{ borderRight: "1px solid var(--background-modifier-border)" }}>
                <LeftSidebar />
              </div>
            </div>
            <div className="obs-sidebar-resizer" onMouseDown={onDragStart("left")} />
          </>
        )}

        {/* main area */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={{ background: "var(--background-primary)" }}>
          <PaneTree node={root} />
        </div>

        {rightSidebar.open && (
          <>
            <div className="obs-sidebar-resizer" onMouseDown={onDragStart("right")} />
            <div style={{ width: rightSidebar.width }} className="min-w-0 shrink-0">
              <div className="h-full" style={{ borderLeft: "1px solid var(--background-modifier-border)" }}>
                <RightSidebar />
              </div>
            </div>
          </>
        )}
      </div>
      <StatusBar />
    </div>
  )
}

// ─── Ribbon (leftmost icon strip) ────────────────────────────────────────────

function Ribbon({ core }: { core: ReturnType<typeof useWorkspace.getState>["settings"]["corePlugins"] }) {
  const ui = useUi()
  const openGraph = useWorkspace((s) => s.openGraph)
  const vaultName = useWorkspace((s) => s.vaultName)
  const leftOpen = useWorkspace((s) => s.leftSidebar.open)
  const hotkeys = useWorkspace((s) => s.settings.hotkeys)

  const tip = (label: string, cmdId?: string) => {
    if (!cmdId) return label
    const combo = effectiveHotkey(cmdId, hotkeys)
    return combo ? `${label} (${prettyCombo(combo)})` : label
  }

  const btn = (icon: React.ReactNode, title: string, onClick: () => void) => (
    <button className="obs-icon-btn !h-7 !w-7" title={title} onClick={onClick}>
      {icon}
    </button>
  )

  return (
    <div
      className="flex w-11 shrink-0 flex-col items-center"
      style={{
        background: "var(--background-secondary)",
        borderRight: "1px solid var(--background-modifier-border)",
      }}
    >
      {/* 40px top header cap aligned flush with sidebar headers and tab bar */}
      <div
        className="obs-win-drag w-full shrink-0"
        style={{ height: "var(--header-height)" }}
      />
      <div className="flex flex-1 flex-col items-center gap-1.5 py-2.5 w-full">
        {core.quickSwitcher && btn(<FileSearch size={17} />, tip("Open quick switcher", "switcher"), () => ui.openSwitcher())}
        {core.graph && btn(<GitFork size={17} />, tip("Open graph view", "graph"), () => openGraph())}
        {core.canvas &&
          btn(<LayoutDashboard size={17} />, "Create new canvas", () => {
            void import("../commands").then(({ createNewCanvas }) => createNewCanvas())
          })}
        {core.dailyNotes && btn(<CalendarDays size={17} />, tip("Open today's daily note", "daily"), () => void openDailyNote())}
        {core.templates && btn(<FileInput size={17} />, "Insert template", () => ui.openTemplateModal())}
        {core.commandPalette && btn(<Terminal size={17} />, tip("Open command palette", "palette"), () => ui.openPalette())}
        <div className="mt-auto flex flex-col items-center gap-1.5">
          {!leftOpen && (
            <button
              className="obs-icon-btn !h-7 !w-7"
              title="Open another vault"
              onClick={() => ui.openVaultPicker()}
            >
              <Vault size={17} />
            </button>
          )}
          <button
            className="obs-icon-btn !h-7 !w-7"
            title="Help — open the Welcome note"
            onClick={() => {
              const linkIndex = useWorkspace.getState().linkIndex
              const idx = linkIndex.find((e) => e.name === "Welcome") ?? linkIndex.find((e) => e.name === "Getting Started")
              if (idx) useWorkspace.getState().openNote(idx.id)
              else toast("No Welcome note found in this vault")
            }}
          >
            <HelpCircle size={17} />
          </button>
          <button className="obs-icon-btn !h-7 !w-7" title={tip("Settings", "settings")} onClick={() => ui.openSettings()}>
            <Settings size={17} />
          </button>
        </div>
      </div>
      <span className="sr-only">Vault {vaultName}</span>
    </div>
  )
}

// ─── Status bar ──────────────────────────────────────────────────────────────

function StatusBar() {
  const activeTab = useWorkspace((s) => s.getActiveTab())
  const noteId = activeTab?.noteId ?? null
  const core = useWorkspace((s) => s.settings.corePlugins)
  const docs = useDocs((s) => s.docs)
  const setRightTab = useWorkspace((s) => s.setRightTab)
  const rightOpen = useWorkspace((s) => s.rightSidebar.open)
  const toggleRight = useWorkspace((s) => s.toggleRightSidebar)
  const { data: backlinks } = useBacklinks(core.backlinks ? noteId : null)
  const { data: tree } = useTree()

  const content = noteId ? docs[noteId]?.content : undefined

  const onBacklinksClick = useCallback(() => {
    if (!rightOpen) toggleRight()
    setRightTab("backlinks")
  }, [rightOpen, toggleRight, setRightTab])

  const setTabMode = useWorkspace((s) => s.setTabMode)
  const activeMode = activeTab?.mode ?? "live"

  const onEditToggle = useCallback(() => {
    const tab = useWorkspace.getState().getActiveTab()
    if (!tab?.noteId) return
    const mode = tab.mode === "read" ? useWorkspace.getState().settings.editor.defaultEditMode : "read"
    setTabMode(tab.id, mode)
  }, [setTabMode])

  const hotkeys = useWorkspace((s) => s.settings.hotkeys)
  const toggleCombo = effectiveHotkey("toggle-mode", hotkeys)
  const toggleLabel = toggleCombo ? `(${prettyCombo(toggleCombo)})` : ""

  const linkIndex = useWorkspace((s) => s.linkIndex)
  const isCanvas = !!noteId && (/\.canvas$/i.test(noteId) || linkIndex.some((e) => e.id === noteId && e.name.endsWith(".canvas")))
  const isMarkdownTab = activeTab?.type === "note" && !!noteId && !isCanvas
  const entry = noteId ? docs[noteId] : undefined
  const dirty = entry ? entry.content !== entry.savedContent : false

  if (!isMarkdownTab || content === undefined) {
    return (
      <div className="obs-status-bar">
        <span className="obs-status-bar-item" title="Vault stats">
          {tree?.notes.length ?? 0} notes
        </span>
      </div>
    )
  }

  return (
    <div className="obs-status-bar">
      {dirty ? (
        <span className="obs-status-bar-item" title="Saving…">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--text-faint)", animation: "obs-fade-in 0.5s ease-in-out infinite alternate" }}
          />
        </span>
      ) : null}
      {core.backlinks && (
        <span className="obs-status-bar-item" onClick={onBacklinksClick} title="Open backlinks panel">
          {backlinks ? backlinks.linked.length : 0} backlinks
        </span>
      )}
      {isMarkdownTab && (
        <span
          className="obs-status-bar-item"
          title={`${activeMode === "read" ? "Edit" : "Reading view"}${toggleLabel ? ` ${toggleLabel}` : ""}`}
          onClick={onEditToggle}
        >
          {activeMode === "read" ? <BookOpen size={12} /> : <PencilLine size={12} />}
        </span>
      )}
      {core.wordCount && (
        <>
          <span className="obs-status-bar-item" title="Word count">
            {wordCount(content)} words
          </span>
          <span className="obs-status-bar-item" title="Character count">
            {charCount(content)} characters
          </span>
        </>
      )}
    </div>
  )
}

// re-export for command palette registration
export { insertTemplate }
