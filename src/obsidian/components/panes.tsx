"use client"

// ─── Tabs & panes: split trees, tab bars, dividers, empty state ──────────────
import { memo, useRef, useState } from "react"
import { PanelLeftOpen, PanelRightOpen, ChevronDown, GitFork, X, Plus, Pin, FileText, Image as ImageIcon, LayoutDashboard } from "lucide-react"
import type { Pane, SplitNode, Tab } from "@/lib/obsidian/types"
import { useWorkspace } from "../stores/workspace"
import { useUi } from "../stores/ui"
import { EditorPane } from "./editor-pane"
import { GraphView } from "./graph-view"
import { AttachmentViewer } from "./attachment-viewer"
import { makeTab } from "../stores/workspace"
import { showMenuAt, tabMenuItems, type MenuItem } from "./context-menu"

export const PaneTree = memo(function PaneTree({
  node,
  showLeftToggle = true,
  showRightToggle = true,
}: {
  node: SplitNode
  showLeftToggle?: boolean
  showRightToggle?: boolean
}) {
  const activePaneId = useWorkspace((s) => s.activePaneId)
  const setActivePane = useWorkspace((s) => s.setActivePane)
  const isSplit = useWorkspace((s) => s.root.kind === "split")

  if (node.kind === "pane") {
    const isActive = activePaneId === node.pane.id
    return (
      <div
        className={`obs-pane flex min-h-0 min-w-0 flex-1 flex-col ${isSplit ? "is-split-pane" : ""} ${isActive ? "is-active-pane" : ""}`}
        onMouseDown={() => setActivePane(node.pane.id)}
        data-active={isActive}
      >
        <TabBar pane={node.pane} showLeftToggle={showLeftToggle} showRightToggle={showRightToggle} isSplit={isSplit} />
        <PaneContent pane={node.pane} isSplit={isSplit} />
      </div>
    )
  }
  const isRow = node.dir === "row"
  return (
    <div className={`flex min-h-0 min-w-0 flex-1 ${isRow ? "flex-row" : "flex-col"}`}>
      {node.children.map((child, i) => (
        <SplitChild
          key={child.id}
          child={child}
          parent={node}
          index={i}
          count={node.children.length}
          isRow={isRow}
          showLeftToggle={showLeftToggle && i === 0}
          showRightToggle={showRightToggle && (isRow ? i === node.children.length - 1 : i === 0)}
        />
      ))}
    </div>
  )
})

function SplitChild({
  child,
  parent,
  index,
  count,
  isRow,
  showLeftToggle,
  showRightToggle,
}: {
  child: SplitNode
  parent: Extract<SplitNode, { kind: "split" }>
  index: number
  count: number
  isRow: boolean
  showLeftToggle: boolean
  showRightToggle: boolean
}) {
  const [dragging, setDragging] = useState(false)
  const startRef = useRef(0)
  const sizesRef = useRef<number[]>([])
  const rootRef = useRef<HTMLDivElement>(null)

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    startRef.current = isRow ? e.clientX : e.clientY
    sizesRef.current = parent.sizes.slice()
    const idx = index - 1 // divider sits before this child
    const move = (ev: MouseEvent) => {
      const container = rootRef.current?.parentElement
      if (!container) return
      const total = Math.max(1, isRow ? container.clientWidth : container.clientHeight)
      const cur = isRow ? ev.clientX : ev.clientY
      const deltaPct = ((cur - startRef.current) / total) * 100
      const sizes = sizesRef.current.slice()
      const prevA = sizesRef.current[idx] ?? 50
      const prevB = sizesRef.current[idx + 1] ?? 50
      const pairSum = prevA + prevB
      const a = Math.max(10, Math.min(pairSum - 10, prevA + deltaPct))
      const b = Math.max(10, pairSum - a)
      sizes[idx] = a
      sizes[idx + 1] = b
      useWorkspace.setState({
        root: updateSizes(useWorkspace.getState().root, parent.id, sizes),
      })
    }
    const up = () => {
      setDragging(false)
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
      useWorkspace.getState().persist()
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
  }

  return (
    <div ref={rootRef} className="flex min-h-0 min-w-0" style={{ flexGrow: parent.sizes[index], flexBasis: 0, flexDirection: isRow ? "row" : "column" }}>
      {index > 0 && (
        <div
          className={`obs-split-divider ${dragging ? "is-dragging" : ""}`}
          style={isRow ? { width: 3, cursor: "col-resize" } : { height: 3, cursor: "row-resize", width: "100%" }}
          onMouseDown={onMouseDown}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        <PaneTree node={child} showLeftToggle={showLeftToggle} showRightToggle={showRightToggle} />
      </div>
    </div>
  )
}

function updateSizes(node: SplitNode, splitId: string, sizes: number[]): SplitNode {
  if (node.kind === "split") {
    if (node.id === splitId) return { ...node, sizes }
    return { ...node, children: node.children.map((c) => updateSizes(c, splitId, sizes)) }
  }
  return node
}

// ─── Tab bar ─────────────────────────────────────────────────────────────────

function TabBar({ pane, showLeftToggle, showRightToggle, isSplit }: { pane: Pane; showLeftToggle: boolean; showRightToggle: boolean; isSplit: boolean }) {
  const activeTabId = pane.activeTabId
  const setActiveTab = useWorkspace((s) => s.setActiveTab)
  const closeTab = useWorkspace((s) => s.closeTab)
  const closeOtherTabs = useWorkspace((s) => s.closeOtherTabs)
  const closeAllTabs = useWorkspace((s) => s.closeAllTabs)
  const closePane = useWorkspace((s) => s.closePane)
  const closeTabsForNote = useWorkspace((s) => s.closeTabsForNote)
  const pinTab = useWorkspace((s) => s.pinTab)
  const openTab = useWorkspace((s) => s.openTab)
  const moveTabToPane = useWorkspace((s) => s.moveTabToPane)
  const reorderTabInPane = useWorkspace((s) => s.reorderTabInPane)
  const splitCurrentPane = useWorkspace((s) => s.splitCurrentPane)
  const toggleLeft = useWorkspace((s) => s.toggleLeftSidebar)
  const toggleRight = useWorkspace((s) => s.toggleRightSidebar)
  const leftOpen = useWorkspace((s) => s.leftSidebar.open)
  const rightOpen = useWorkspace((s) => s.rightSidebar.open)
  const linkIndex = useWorkspace((s) => s.linkIndex)

  return (
    <div
      className={`obs-tabbar ${showRightToggle && !rightOpen ? "obs-win-caption-slot" : ""}`}
      onDragOver={(e) => {
        const payload = (window as unknown as { __obsTabDrag?: { tabId: string; fromPaneId: string } }).__obsTabDrag
        if (payload && payload.fromPaneId !== pane.id) e.preventDefault()
      }}
      onDrop={(e) => {
        const payload = (window as unknown as { __obsTabDrag?: { tabId: string; fromPaneId: string } }).__obsTabDrag
        if (payload && payload.fromPaneId !== pane.id) {
          e.preventDefault()
          moveTabToPane(payload.tabId, pane.id)
          ;(window as unknown as { __obsTabDrag?: unknown }).__obsTabDrag = undefined
        }
      }}
    >
      {showLeftToggle && !leftOpen && (
        <div className="flex shrink-0 items-center pr-1">
          <button
            className="obs-icon-btn !h-7 !w-7"
            title="Open left sidebar"
            onClick={toggleLeft}
          >
            <PanelLeftOpen size={15} />
          </button>
        </div>
      )}
      <div className="obs-tabbar-scroll flex-1">
        {pane.tabs.map((tab) => (
          <div
            key={tab.id}
            className={`obs-tab ${tab.id === activeTabId ? "is-active" : ""} ${tab.pinned ? "is-pinned" : ""}`}
            draggable
            onDragStart={(e) => {
              ;(window as unknown as { __obsTabDrag?: { tabId: string; fromPaneId: string } }).__obsTabDrag = { tabId: tab.id, fromPaneId: pane.id }
              e.dataTransfer.effectAllowed = "move"
            }}
            onDragEnd={() => {
              ;(window as unknown as { __obsTabDrag?: unknown }).__obsTabDrag = undefined
            }}
            onDragOver={(e) => {
              const payload = (window as unknown as { __obsTabDrag?: { tabId: string; fromPaneId: string } }).__obsTabDrag
              if (payload && payload.tabId !== tab.id) e.preventDefault()
            }}
            onDrop={(e) => {
              const payload = (window as unknown as { __obsTabDrag?: { tabId: string; fromPaneId: string } }).__obsTabDrag
              if (payload && payload.tabId !== tab.id) {
                e.preventDefault()
                if (payload.fromPaneId === pane.id) reorderTabInPane(pane.id, payload.tabId, tab.id)
                else moveTabToPane(payload.tabId, pane.id)
                ;(window as unknown as { __obsTabDrag?: unknown }).__obsTabDrag = undefined
              }
            }}
            onClick={() => setActiveTab(pane.id, tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) closeTab(tab.id)
            }}
            onContextMenu={(e) => {
              // obsidian-exact tab menu: the More-options items + tab-specific ones
              showMenuAt(
                e,
                tabMenuItems({
                  pinned: !!tab.pinned,
                  noteId: tab.noteId ?? null,
                  isGraph: tab.type === "graph" || tab.type === "local-graph",
                  actions: {
                    pin: () => pinTab(tab.id),
                    close: () => closeTab(tab.id),
                    closeOthers: () => closeOtherTabs(tab.id),
                    closeAll: () => closeAllTabs(pane.id),
                    splitRight: () => splitCurrentPane("row"),
                    splitDown: () => splitCurrentPane("column"),
                    moveToNewWindow: () => {
                      if (tab.noteId) {
                        void import("./context-menu").then(({ openNoteInNewWindow }) => {
                          void openNoteInNewWindow(tab.noteId!)
                          closeTab(tab.id)
                        })
                      }
                    },
                    onRename: tab.noteId
                      ? () => {
                          const ws = useWorkspace.getState()
                          const name = ws.linkIndex.find((x) => x.id === tab.noteId)?.name ?? ""
                          useUi.getState().openRename({ kind: "note", id: tab.noteId!, currentName: name })
                        }
                      : undefined,
                    onMoveFile: tab.noteId
                      ? () => {
                          const ws = useWorkspace.getState()
                          const name = ws.linkIndex.find((x) => x.id === tab.noteId)?.name ?? ""
                          useUi.getState().openMove({ kind: "note", id: tab.noteId!, currentName: name })
                        }
                      : undefined,
                    onDelete: tab.noteId
                      ? () => {
                          const ws = useWorkspace.getState()
                          const name = ws.linkIndex.find((x) => x.id === tab.noteId)?.name ?? ""
                          useUi.getState().openConfirm({
                            title: `Delete "${name || "note"}"?`,
                            message: "This will move the file to trash or permanently delete it.",
                            confirmLabel: "Delete",
                            danger: true,
                            onConfirm: () => {
                              void import("../api").then(({ api }) =>
                                api.deleteNote(tab.noteId!).then(() => {
                                  window.dispatchEvent(
                                    new CustomEvent("obs-invalidate", { detail: { vaultId: ws.vaultId, kinds: ["tree", "index", "graph", "tags"] } }),
                                  )
                                  closeTabsForNote(tab.noteId!)
                                }),
                              )
                            },
                          })
                        }
                      : undefined,
                  },
                }),
              )
            }}
            title={tabTitle(tab, linkIndex)}
          >
            {tab.type === "graph" ? (
              <GitFork size={13} className="shrink-0" />
            ) : tab.type === "local-graph" ? (
              <GitFork size={13} className="shrink-0 opacity-70" />
            ) : tab.type === "attachment" ? (
              <ImageIcon size={13} className="shrink-0" />
            ) : tab.noteId?.endsWith(".canvas") || linkIndex.some((e) => e.id === tab.noteId && e.name.endsWith(".canvas")) ? (
              <LayoutDashboard size={13} className="shrink-0" />
            ) : (
              <FileText size={13} className="shrink-0" />
            )}
            <span className="truncate">{tabTitle(tab, linkIndex)}</span>
            {tab.pinned && (
              <span
                className="obs-icon-btn !h-5 !w-5 shrink-0 opacity-75"
                title="Unpin"
                onClick={(e) => {
                  e.stopPropagation()
                  pinTab(tab.id)
                }}
              >
                <Pin size={11} />
              </span>
            )}
            <span
              className="obs-tab-close obs-icon-btn !h-5 !w-5"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
            >
              <X size={12} />
            </span>
          </div>
        ))}
      </div>
      {/* obsidian: New tab (+) after tabs; tab switcher dropdown (v) + right sidebar expand at far end */}
      <div className="flex shrink-0 items-center px-0.5">
        <button className="obs-icon-btn !h-7 !w-7" title="New tab (Ctrl+T)" onClick={() => openTab(pane.id, makeTab("note"))}>
          <Plus size={15} />
        </button>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5 px-0.5">
        <button
          className="obs-icon-btn !h-7 !w-7"
          title="Tab list"
          onClick={(e) => {
            const items: MenuItem[] = [
              ...pane.tabs.map((t): MenuItem => ({
                label: tabTitle(t, linkIndex),
                onClick: () => setActiveTab(pane.id, t.id),
              })),
              ...(pane.tabs.length > 0
                ? ([
                    { type: "separator" },
                    { label: "Close all tabs", onClick: () => closeAllTabs(pane.id) },
                  ] satisfies MenuItem[])
                : []),
              ...(isSplit
                ? ([
                    { type: "separator" },
                    { label: "Close tab group", onClick: () => closePane(pane.id) },
                  ] satisfies MenuItem[])
                : []),
            ]
            showMenuAt(e, items)
          }}
        >
          <ChevronDown size={14} />
        </button>
        {showRightToggle && !rightOpen && (
          <button
            className="obs-icon-btn !h-7 !w-7"
            title="Open right sidebar"
            onClick={toggleRight}
          >
            <PanelRightOpen size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

function tabTitle(tab: Tab, linkIndex: { id: string; name: string }[]): string {
  if (tab.type === "graph") return "Graph view"
  if (tab.type === "local-graph") return "Local graph"
  if (tab.type === "attachment") return tab.noteId?.split("/").pop() ?? "Attachment"
  if (!tab.noteId) return "New tab"
  return linkIndex.find((e) => e.id === tab.noteId)?.name ?? "New tab"
}

// ─── Pane content ────────────────────────────────────────────────────────────

function PaneContent({ pane, isSplit }: { pane: Pane; isSplit: boolean }) {
  const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? null

  if (!activeTab || (activeTab.type === "note" && !activeTab.noteId)) {
    return <EmptyState paneId={pane.id} isSplit={isSplit} />
  }
  if (activeTab.type === "graph" || activeTab.type === "local-graph") {
    return <GraphView key={activeTab.type} local={activeTab.type === "local-graph"} />
  }
  if (activeTab.type === "attachment" && activeTab.noteId) {
    return <AttachmentViewer key={activeTab.noteId} fileId={activeTab.noteId} />
  }
  // key by tab + note: switching tabs/notes remounts cleanly while preserving edit/reading mode switches
  return <EditorPane key={`${activeTab.id}:${activeTab.noteId ?? "empty"}`} tab={activeTab} />
}

function EmptyState({ paneId, isSplit }: { paneId: string; isSplit: boolean }) {
  const vaultId = useWorkspace((s) => s.vaultId)
  const openNote = useWorkspace((s) => s.openNote)
  const openGraph = useWorkspace((s) => s.openGraph)
  const closePane = useWorkspace((s) => s.closePane)
  const graphEnabled = useWorkspace((s) => s.settings.corePlugins.graph)
  const ui = useUi()

  const createNote = async () => {
    if (!vaultId) return
    const { api } = await import("../api")
    const note = await api.createNote(vaultId, "Untitled", null, "")
    window.dispatchEvent(new CustomEvent("obs-invalidate", { detail: { vaultId, kinds: ["tree", "index", "graph"] } }))
    openNote(note.id, { paneId })
  }

  return (
    <div className="obs-empty-state" style={{ background: "var(--background-primary)" }} onMouseDown={() => useWorkspace.getState().setActivePane(paneId)}>
      <GemLogo size={88} />
      <div className="mt-4 text-[0.95rem]" style={{ color: "var(--text-muted)" }}>
        No file is open
      </div>
      <div className="mt-5 flex flex-col items-center gap-2">
        <button className="obs-btn-accent" onClick={() => void createNote()}>
          Create new note
        </button>
        <button className="obs-text-btn" onClick={() => ui.openPalette()}>
          Open command palette
        </button>
        {graphEnabled && (
          <button className="obs-text-btn" onClick={() => openGraph()}>
            Open graph view
          </button>
        )}
        {isSplit && (
          <button className="obs-text-btn" onClick={() => closePane(paneId)}>
            Close tab group
          </button>
        )}
      </div>
    </div>
  )
}

export function GemLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 1.5 3.5 8.2 12 22.5l8.5-14.3L12 1.5Z" fill="var(--interactive-accent)" opacity="0.85" />
      <path d="M12 1.5 6.3 8.2 12 22.5V1.5Z" fill="var(--interactive-accent)" opacity="0.55" />
      <path d="M12 1.5 3.5 8.2h17L12 1.5Z" fill="var(--interactive-accent)" opacity="0.35" />
    </svg>
  )
}
