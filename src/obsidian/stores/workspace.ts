"use client"

// ─── Workspace store: vault, panes/tabs/splits, sidebars, settings ──────────
import { create } from "zustand"
import type { EditorMode, IndexEntry, Pane, SplitNode, Tab, TabType } from "@/lib/obsidian/types"
import { DEFAULT_SETTINGS, mergeSettings, type AppSettings } from "@/lib/obsidian/settings"
import { buildIndexMap, resolveLink } from "@/lib/obsidian/links"

export type LeftTab = "files" | "search" | "bookmarks"
export type RightTab = "backlinks" | "outgoing" | "outline" | "tags"

let uidCounter = 0
const uid = () => `u${Date.now().toString(36)}${(uidCounter++).toString(36)}`

export function makeTab(type: TabType, noteId?: string, mode: EditorMode = "live"): Tab {
  return { id: uid(), type, noteId, mode, history: noteId ? [noteId] : [], historyIndex: 0 }
}

export function makePane(tab?: Tab): Pane {
  return { id: uid(), tabs: tab ? [tab] : [], activeTabId: tab?.id ?? null }
}

function makeRoot(): Extract<SplitNode, { kind: "pane" }> {
  const pane = makePane()
  return { id: uid(), kind: "pane", pane }
}

interface PersistedLayout {
  root: SplitNode
  activePaneId: string
  leftWidth: number
  rightWidth: number
  leftOpen?: boolean
  rightOpen?: boolean
  leftTab?: LeftTab
  rightTab?: RightTab
}

function isValidSplitNode(n: unknown): n is SplitNode {
  if (!n || typeof n !== "object") return false
  const node = n as SplitNode
  if (node.kind === "pane") {
    return !!node.pane && typeof node.pane.id === "string" && Array.isArray(node.pane.tabs)
  }
  if (node.kind === "split") {
    return (
      (node.dir === "row" || node.dir === "column") &&
      Array.isArray(node.children) &&
      node.children.length > 0 &&
      node.children.every(isValidSplitNode)
    )
  }
  return false
}

function flushActiveDraft() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("obs-flush-active-draft"))
  }
}

function loadPersisted(vaultId: string): PersistedLayout | null {
  try {
    const raw = localStorage.getItem(`obs-web-workspace-${vaultId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedLayout
    if (!isValidSplitNode(parsed.root)) return null
    return parsed
  } catch {
    return null
  }
}

// ── split node utilities (pure) ──────────────────────────────────────────────

function mapPanes(node: SplitNode, fn: (pane: Pane) => Pane): SplitNode {
  if (node.kind === "pane") return { ...node, pane: fn(node.pane) }
  return { ...node, children: node.children.map((c) => mapPanes(c, fn)) }
}

function findPane(node: SplitNode, paneId: string): Pane | null {
  if (node.kind === "pane") return node.pane.id === paneId ? node.pane : null
  for (const c of node.children) {
    const found = findPane(c, paneId)
    if (found) return found
  }
  return null
}

function collectPanes(node: SplitNode, out: Pane[] = []): Pane[] {
  if (node.kind === "pane") {
    out.push(node.pane)
    return out
  }
  node.children.forEach((c) => collectPanes(c, out))
  return out
}

function removePane(node: SplitNode, paneId: string): SplitNode {
  if (node.kind === "split") {
    const children = node.children.map((c) => removePane(c, paneId))
    const kept = children.filter((c) => c !== null) as SplitNode[]
    if (kept.length === 0) return null as unknown as SplitNode
    if (kept.length === 1) return kept[0]
    return { ...node, children: kept, sizes: kept.map(() => 100 / kept.length) }
  }
  return node.pane.id === paneId ? (null as unknown as SplitNode) : node
}

function replacePane(node: SplitNode, paneId: string, newPane: Pane): SplitNode {
  return mapPanes(node, (p) => (p.id === paneId ? newPane : p))
}

/** Splits a pane: returns new root + id of the new pane. */
function splitAt(node: SplitNode, paneId: string, dir: "row" | "column"): { root: SplitNode; newPaneId: string } {
  const target = findPane(node, paneId)
  if (!target) return { root: node, newPaneId: paneId }
  const activeTab = target.tabs.find((t) => t.id === target.activeTabId) ?? target.tabs[0]
  const newTab = activeTab
    ? { ...activeTab, id: uid(), history: activeTab.noteId ? [activeTab.noteId] : [], historyIndex: 0 }
    : undefined
  const newPane = makePane(newTab)

  const walk = (n: SplitNode): SplitNode => {
    if (n.kind === "pane") {
      if (n.pane.id !== paneId) return n
      const split: SplitNode = {
        id: uid(),
        kind: "split",
        dir,
        children: [n, { id: uid(), kind: "pane", pane: newPane }],
        sizes: [50, 50],
      }
      return split
    }
    const idx = n.children.findIndex((c) => c.kind === "pane" && c.pane.id === paneId)
    if (idx !== -1) {
      const split: SplitNode = {
        id: uid(),
        kind: "split",
        dir,
        children: [n.children[idx], { id: uid(), kind: "pane", pane: newPane }],
        sizes: [50, 50],
      }
      const children = [...n.children]
      children.splice(idx, 1, split)
      // if parent has same dir, flatten
      if (n.dir === dir) {
        const flat: SplitNode[] = []
        children.forEach((c) => {
          if (c.kind === "split" && c.dir === dir) flat.push(...c.children)
          else flat.push(c)
        })
        return { ...n, children: flat, sizes: flat.map(() => 100 / flat.length) }
      }
      return { ...n, children, sizes: children.map(() => 100 / children.length) }
    }
    return { ...n, children: n.children.map(walk) }
  }

  return { root: walk(node), newPaneId: newPane.id }
}

// ── store ────────────────────────────────────────────────────────────────────

function openResolved(
  noteId: string,
  opts: { newTab?: boolean; paneId?: string },
  subpath: string | null,
  set: (partial: Partial<WorkspaceState>) => void,
  get: () => WorkspaceState,
) {
  flushActiveDraft()
  const state = get()
  const paneId = opts.paneId ?? state.activePaneId
  const pane = findPane(state.root, paneId) ?? collectPanes(state.root)[0]
  if (!pane) return
  const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId)

  const openInTab = (tab: Tab): Tab => {
    if (tab.noteId === noteId) return tab
    const history = [...tab.history.slice(0, tab.historyIndex + 1), noteId]
    return { ...tab, noteId, type: "note", history, historyIndex: history.length - 1 }
  }

  if (!opts.newTab && activeTab && !activeTab.pinned && activeTab.type === "note") {
    const newTab = openInTab(activeTab)
    const newPane = { ...pane, tabs: pane.tabs.map((t) => (t.id === activeTab.id ? newTab : t)), activeTabId: newTab.id }
    set({ root: replacePane(state.root, pane.id, newPane), activePaneId: pane.id })
  } else if (activeTab?.pinned) {
    const tab = makeTab("note", noteId, state.settings.editor.defaultEditMode)
    const idx = pane.tabs.findIndex((t) => t.id === activeTab.id)
    const tabs = [...pane.tabs]
    tabs.splice(idx + 1, 0, tab)
    set({ root: replacePane(state.root, pane.id, { ...pane, tabs, activeTabId: tab.id }), activePaneId: pane.id })
  } else {
    const tab = makeTab("note", noteId, state.settings.editor.defaultEditMode)
    const tabs = [...pane.tabs, tab]
    set({ root: replacePane(state.root, pane.id, { ...pane, tabs, activeTabId: tab.id }), activePaneId: pane.id })
  }
  get().persist()

  // subpath scroll (heading / ^block)
  if (subpath && typeof window !== "undefined") {
    const detail = { noteId, subpath, nonce: Date.now() }
    setTimeout(() => window.dispatchEvent(new CustomEvent("obs-scroll-to", { detail })), 120)
  }
}

export interface WorkspaceState {
  vaultId: string | null
  vaultName: string
  root: SplitNode
  activePaneId: string
  leftSidebar: { open: boolean; width: number; tab: LeftTab }
  rightSidebar: { open: boolean; width: number; tab: RightTab }
  settings: AppSettings
  hydrated: boolean
  linkIndex: IndexEntry[]
  closedTabs: Tab[]

  hydrate: (vaultId: string, vaultName: string) => void
  reset: () => void
  persist: () => void
  setLinkIndex: (entries: IndexEntry[]) => void

  openNote: (ref: string, opts?: { newTab?: boolean; paneId?: string; subpath?: string | null }) => void
  /** Open a non-markdown vault file (image/audio/video/pdf) in a viewer tab. */
  openAttachment: (fileId: string, opts?: { newTab?: boolean }) => void
  openGraph: (opts?: { local?: boolean }) => void
  openTab: (paneId: string, tab: Tab) => void
  newEmptyTab: () => void
  closeTab: (tabId: string) => void
  reopenClosedTab: () => void
  cycleTab: (delta: 1 | -1) => void
  closeOtherTabs: (tabId: string) => void
  closeAllTabs: (paneId?: string) => void
  pinTab: (tabId: string) => void
  /** Move a tab to a different pane (drag & drop between tab bars). */
  moveTabToPane: (tabId: string, toPaneId: string) => void
  /** Reorder a tab before another tab within its pane. */
  reorderTabInPane: (paneId: string, tabId: string, beforeTabId: string) => void
  setActiveTab: (paneId: string, tabId: string) => void
  setActivePane: (paneId: string) => void
  splitCurrentPane: (dir: "row" | "column") => void
  closePane: (paneId: string) => void
  setTabMode: (tabId: string, mode: EditorMode) => void
  /** Update all open tabs and histories referencing `oldId` after a file rename/move. */
  remapNoteId: (oldId: string, newId: string) => void
  /** Close tabs currently viewing a deleted/merged note. */
  closeTabsForNote: (noteId: string) => void
  navigateBack: () => void
  navigateForward: () => void
  goToTabHistory: (paneId: string, delta: number) => void
  navigateTabHistory: (tabId: string, delta: number) => void

  toggleLeftSidebar: () => void
  toggleRightSidebar: () => void
  setLeftTab: (tab: LeftTab) => void
  setRightTab: (tab: RightTab) => void
  setSidebarWidth: (side: "left" | "right", width: number) => void

  applySettings: (settings: AppSettings) => void
  updateSettings: (patch: Partial<AppSettings>) => void

  // selectors (non-reactive helpers)
  getActivePane: () => Pane | null
  getActiveTab: () => Tab | null
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  vaultId: null,
  vaultName: "",
  root: makeRoot(),
  activePaneId: "",
  leftSidebar: { open: true, width: 260, tab: "files" },
  rightSidebar: { open: true, width: 304, tab: "backlinks" },
  settings: DEFAULT_SETTINGS,
  hydrated: false,
  linkIndex: [],
  closedTabs: [],

  setLinkIndex: (entries) => set({ linkIndex: entries }),

  hydrate: (vaultId, vaultName) => {
    const persisted = loadPersisted(vaultId)
    if (persisted) {
      const panes = collectPanes(persisted.root)
      const root = panes.length > 0 ? persisted.root : makeRoot()
      const validPanes = collectPanes(root)
      const activePaneId = validPanes.some((p) => p.id === persisted.activePaneId)
        ? persisted.activePaneId
        : (validPanes[0]?.id ?? "")
      const leftTabs: LeftTab[] = ["files", "search", "bookmarks"]
      const rightTabs: RightTab[] = ["backlinks", "outgoing", "outline", "tags"]
      const prevLeft = get().leftSidebar
      const prevRight = get().rightSidebar
      set({
        vaultId,
        vaultName,
        root,
        activePaneId,
        closedTabs: [],
        leftSidebar: {
          open: typeof persisted.leftOpen === "boolean" ? persisted.leftOpen : prevLeft.open,
          width: typeof persisted.leftWidth === "number" ? Math.max(180, Math.min(500, persisted.leftWidth)) : 260,
          tab: persisted.leftTab && leftTabs.includes(persisted.leftTab) ? persisted.leftTab : prevLeft.tab,
        },
        rightSidebar: {
          open: typeof persisted.rightOpen === "boolean" ? persisted.rightOpen : prevRight.open,
          width: typeof persisted.rightWidth === "number" ? Math.max(180, Math.min(500, persisted.rightWidth)) : 304,
          tab: persisted.rightTab && rightTabs.includes(persisted.rightTab) ? persisted.rightTab : prevRight.tab,
        },
        hydrated: true,
      })
    } else {
      const root = makeRoot()
      set({ vaultId, vaultName, root, activePaneId: root.pane.id, closedTabs: [], hydrated: true })
    }
    get().persist()
  },

  reset: () => {
    const root = makeRoot()
    set({ root, activePaneId: root.pane.id, closedTabs: [], hydrated: false })
  },

  persist: () => {
    const { vaultId, root, activePaneId, leftSidebar, rightSidebar } = get()
    if (!vaultId) return
    try {
      localStorage.setItem(
        `obs-web-workspace-${vaultId}`,
        JSON.stringify({
          root,
          activePaneId,
          leftWidth: leftSidebar.width,
          rightWidth: rightSidebar.width,
          leftOpen: leftSidebar.open,
          rightOpen: rightSidebar.open,
          leftTab: leftSidebar.tab,
          rightTab: rightSidebar.tab,
        }),
      )
    } catch {
      // storage full — ignore
    }
  },

  openNote: (ref, opts = {}) => {
    const state = get()
    // resolve ref → note id (ids pass through; names/paths resolved via index)
    const byId = state.linkIndex.find((e) => e.id === ref)
    const entry = byId ?? resolveLink(ref, buildIndexMap(state.linkIndex))
    const subpath = opts.subpath ?? null

    if (entry) {
      openResolved(entry.id, opts, subpath, set, get)
    } else {
      // obsidian behaviour: clicking an unresolved link creates the note.
      // But first confirm with the server — the local index may be stale
      // (e.g. right after creating a note, callers pass the new note id).
      const cleanName = ref.split("#")[0].split("|")[0].trim().split("/").pop() ?? ref
      void (async () => {
        const { api } = await import("../api")
        try {
          let target: { id: string; name: string } | null = null
          if (state.vaultId) {
            try {
              const tree = await api.tree(state.vaultId)
              const idHit = tree.notes.find((n) => n.id === ref)
              if (idHit) {
                target = idHit
              } else {
                const nameHit = tree.notes.find((n) => n.name.toLowerCase() === cleanName.toLowerCase())
                if (nameHit) target = nameHit
              }
            } catch {
              /* tree fetch failed — fall through to create */
            }
          }
          if (target) {
            openResolved(target.id, opts, subpath, set, get)
            return
          }
          const note = await api.createNote(state.vaultId!, cleanName, null, "")
          // refresh caches
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("obs-invalidate", { detail: { vaultId: state.vaultId, noteId: note.id, kinds: ["tree", "index", "graph", "tags"] } }))
          }
          set({ linkIndex: [...get().linkIndex, { id: note.id, name: note.name, path: note.path, aliases: [], tags: [] }] })
          openResolved(note.id, opts, subpath, set, get)
        } catch {
          // ignore
        }
      })()
    }
  },

  openAttachment: (fileId, opts = {}) => {
    flushActiveDraft()
    const state = get()
    const pane = findPane(state.root, state.activePaneId) ?? collectPanes(state.root)[0]
    if (!pane) return
    const tab = makeTab("attachment", fileId)
    ;(tab as { attachmentId?: string }).attachmentId = fileId
    tab.noteId = fileId
    tab.mode = "read"
    const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId)
    const replaceEmpty = !opts.newTab && activeTab && !activeTab.pinned && activeTab.type === "note" && !activeTab.noteId
    const tabs = replaceEmpty ? pane.tabs.map((t) => (t.id === activeTab.id ? tab : t)) : [...pane.tabs, tab]
    set({ root: replacePane(state.root, pane.id, { ...pane, tabs, activeTabId: tab.id }), activePaneId: pane.id })
    get().persist()
  },

  openGraph: (opts = {}) => {
    const state = get()
    if (!state.settings.corePlugins.graph) return
    flushActiveDraft()
    const pane = findPane(state.root, state.activePaneId) ?? collectPanes(state.root)[0]
    if (!pane) return
    const tab = makeTab(opts.local ? "local-graph" : "graph")
    const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId)
    const replaceEmpty = activeTab && !activeTab.pinned && activeTab.type === "note" && !activeTab.noteId
    const tabs = replaceEmpty ? pane.tabs.map((t) => (t.id === activeTab.id ? tab : t)) : [...pane.tabs, tab]
    set({ root: replacePane(state.root, pane.id, { ...pane, tabs, activeTabId: tab.id }), activePaneId: pane.id })
    get().persist()
  },

  openTab: (paneId, tab) => {
    flushActiveDraft()
    const state = get()
    const pane = findPane(state.root, paneId)
    if (!pane) return
    set({ root: replacePane(state.root, paneId, { ...pane, tabs: [...pane.tabs, tab], activeTabId: tab.id }), activePaneId: paneId })
    get().persist()
  },

  newEmptyTab: () => {
    flushActiveDraft()
    const state = get()
    const pane = findPane(state.root, state.activePaneId) ?? collectPanes(state.root)[0]
    if (!pane) return
    const tab = makeTab("note")
    set({ root: replacePane(state.root, pane.id, { ...pane, tabs: [...pane.tabs, tab], activeTabId: tab.id }), activePaneId: pane.id })
    get().persist()
  },

  closeTab: (tabId) => {
    const state = get()
    const pane = collectPanes(state.root).find((p) => p.tabs.some((t) => t.id === tabId))
    if (!pane) return
    if (pane.activeTabId === tabId) flushActiveDraft()
    const idx = pane.tabs.findIndex((t) => t.id === tabId)
    const closing = pane.tabs[idx]
    const tabs = pane.tabs.filter((t) => t.id !== tabId)
    let activeTabId = pane.activeTabId
    if (activeTabId === tabId) {
      activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null
    }
    const closedTabs =
      closing && (closing.noteId || closing.type === "graph" || closing.type === "local-graph" || closing.type === "attachment")
        ? [...state.closedTabs.slice(-19), { ...closing, pinned: false }]
        : state.closedTabs
    set({ root: replacePane(state.root, pane.id, { ...pane, tabs, activeTabId }), closedTabs })
    get().persist()
  },

  reopenClosedTab: () => {
    const state = get()
    if (state.closedTabs.length === 0) return
    const last = state.closedTabs[state.closedTabs.length - 1]
    const restClosed = state.closedTabs.slice(0, -1)
    const pane = findPane(state.root, state.activePaneId) ?? collectPanes(state.root)[0]
    if (!pane) return
    flushActiveDraft()
    const reopened: Tab = { ...last, id: uid() }
    set({
      root: replacePane(state.root, pane.id, { ...pane, tabs: [...pane.tabs, reopened], activeTabId: reopened.id }),
      activePaneId: pane.id,
      closedTabs: restClosed,
    })
    get().persist()
  },

  cycleTab: (delta) => {
    const state = get()
    const pane = findPane(state.root, state.activePaneId) ?? collectPanes(state.root)[0]
    if (!pane || pane.tabs.length <= 1) return
    flushActiveDraft()
    const idx = pane.tabs.findIndex((t) => t.id === pane.activeTabId)
    const cur = idx === -1 ? 0 : idx
    const nextIdx = (cur + delta + pane.tabs.length) % pane.tabs.length
    set({ root: replacePane(state.root, pane.id, { ...pane, activeTabId: pane.tabs[nextIdx].id }), activePaneId: pane.id })
    get().persist()
  },

  closeOtherTabs: (tabId) => {
    const state = get()
    const pane = collectPanes(state.root).find((p) => p.tabs.some((t) => t.id === tabId))
    if (!pane) return
    if (pane.activeTabId && pane.activeTabId !== tabId) flushActiveDraft()
    const keep = pane.tabs.filter((t) => t.id === tabId || !!t.pinned)
    if (keep.length === 0) return
    set({ root: replacePane(state.root, pane.id, { ...pane, tabs: keep, activeTabId: tabId }), activePaneId: pane.id })
    get().persist()
  },

  closeAllTabs: (paneId) => {
    const state = get()
    const pid = paneId ?? state.activePaneId
    const pane = findPane(state.root, pid)
    if (!pane) return
    flushActiveDraft()
    const keep = pane.tabs.filter((t) => !!t.pinned)
    const activeTabId = keep.some((t) => t.id === pane.activeTabId) ? pane.activeTabId : (keep[0]?.id ?? null)
    set({ root: replacePane(state.root, pid, { ...pane, tabs: keep, activeTabId }) })
    get().persist()
  },

  pinTab: (tabId) => {
    const state = get()
    const pane = collectPanes(state.root).find((p) => p.tabs.some((t) => t.id === tabId))
    if (!pane) return
    const tabs = pane.tabs.map((t) => (t.id === tabId ? { ...t, pinned: !t.pinned } : t))
    // pinned tabs sort first (obsidian behaviour)
    tabs.sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false))
    set({ root: replacePane(state.root, pane.id, { ...pane, tabs }) })
    get().persist()
  },

  moveTabToPane: (tabId, toPaneId) => {
    const state = get()
    const from = collectPanes(state.root).find((p) => p.tabs.some((t) => t.id === tabId))
    const to = findPane(state.root, toPaneId)
    if (!from || !to || from.id === toPaneId) return
    const tab = from.tabs.find((t) => t.id === tabId)
    if (!tab) return
    let fromTabs = from.tabs.filter((t) => t.id !== tabId)
    let fromActive = from.activeTabId
    if (fromActive === tabId) fromActive = fromTabs[0]?.id ?? null
    // inserting an unpinned tab after pinned ones keeps pinned-first ordering
    const insertAt = tab.pinned ? 0 : Math.max(0, to.tabs.filter((t) => t.pinned).length)
    const toTabs = [...to.tabs]
    toTabs.splice(insertAt, 0, tab)
    if (fromTabs.length === 0) {
      // keep an empty pane alive with a blank tab so the split isn't destroyed
      fromTabs = [makeTab("note")]
      fromActive = fromTabs[0].id
    }
    let root: SplitNode = replacePane(state.root, from.id, { ...from, tabs: fromTabs, activeTabId: fromActive })
    root = replacePane(root, to.id, { ...to, tabs: toTabs, activeTabId: tab.id })
    set({ root, activePaneId: to.id })
    get().persist()
  },

  reorderTabInPane: (paneId, tabId, beforeTabId) => {
    const state = get()
    const pane = findPane(state.root, paneId)
    if (!pane) return
    const tab = pane.tabs.find((t) => t.id === tabId)
    if (!tab) return
    const rest = pane.tabs.filter((t) => t.id !== tabId)
    const idx = rest.findIndex((t) => t.id === beforeTabId)
    rest.splice(idx === -1 ? rest.length : idx, 0, tab)
    const tabs = rest.sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false))
    set({ root: replacePane(state.root, pane.id, { ...pane, tabs }) })
    get().persist()
  },

  setActiveTab: (paneId, tabId) => {
    const state = get()
    const pane = findPane(state.root, paneId)
    if (!pane) return
    if (pane.activeTabId !== tabId || state.activePaneId !== paneId) flushActiveDraft()
    set({ root: replacePane(state.root, paneId, { ...pane, activeTabId: tabId }), activePaneId: paneId })
    get().persist()
  },

  setActivePane: (paneId) => {
    if (get().activePaneId === paneId) return
    set({ activePaneId: paneId })
  },

  splitCurrentPane: (dir) => {
    flushActiveDraft()
    const state = get()
    const { root, newPaneId } = splitAt(state.root, state.activePaneId, dir)
    set({ root, activePaneId: newPaneId })
    get().persist()
  },

  closePane: (paneId) => {
    const state = get()
    const panes = collectPanes(state.root)
    if (panes.length <= 1) {
      // never close the last pane — clear it instead
      const pane = panes[0]
      set({ root: replacePane(state.root, pane.id, { ...pane, tabs: [], activeTabId: null }) })
      get().persist()
      return
    }
    const next = removePane(state.root, paneId)
    const remaining = collectPanes(next)
    const activePaneId = remaining.some((p) => p.id === state.activePaneId) ? state.activePaneId : remaining[0]?.id ?? ""
    set({ root: next, activePaneId })
    get().persist()
  },

  setTabMode: (tabId, mode) => {
    const state = get()
    const pane = collectPanes(state.root).find((p) => p.tabs.some((t) => t.id === tabId))
    if (!pane) return
    const tabs = pane.tabs.map((t) => (t.id === tabId ? { ...t, mode } : t))
    set({ root: replacePane(state.root, pane.id, { ...pane, tabs }) })
    get().persist()
  },

  remapNoteId: (oldId, newId) => {
    if (!oldId || !newId || oldId === newId) return
    const walk = (n: SplitNode): SplitNode => {
      if (n.kind === "pane") {
        const tabs = n.pane.tabs.map((t) => ({
          ...t,
          noteId: t.noteId === oldId ? newId : t.noteId,
          history: t.history.map((h) => (h === oldId ? newId : h)),
        }))
        return { id: n.id, kind: "pane", pane: { ...n.pane, tabs } }
      }
      return { ...n, children: n.children.map(walk) }
    }
    set((s) => ({
      root: walk(s.root),
      closedTabs: s.closedTabs.map((t) => ({
        ...t,
        noteId: t.noteId === oldId ? newId : t.noteId,
        history: t.history.map((h) => (h === oldId ? newId : h)),
      })),
    }))
    get().persist()
  },

  closeTabsForNote: (noteId) => {
    if (!noteId) return
    set((s) => ({ closedTabs: s.closedTabs.filter((t) => t.noteId !== noteId) }))
    const matching: string[] = []
    for (const p of collectPanes(get().root)) {
      for (const t of p.tabs) {
        if (t.noteId === noteId) matching.push(t.id)
      }
    }
    for (const tid of matching) get().closeTab(tid)
  },

  navigateBack: () => get().goToTabHistory(get().activePaneId, -1),
  navigateForward: () => get().goToTabHistory(get().activePaneId, 1),
  navigateTabHistory: (tabId, delta) => {
    const pane = collectPanes(get().root).find((p) => p.tabs.some((t) => t.id === tabId))
    if (!pane) return
    const tab = pane.tabs.find((t) => t.id === tabId)
    if (!tab || !tab.noteId) return
    const idx = tab.historyIndex + delta
    if (idx < 0 || idx >= tab.history.length) return
    flushActiveDraft()
    const noteId = tab.history[idx]
    const tabs = pane.tabs.map((t) => (t.id === tab.id ? { ...t, noteId, type: "note" as TabType, historyIndex: idx } : t))
    set({ root: replacePane(get().root, pane.id, { ...pane, tabs }) })
    get().persist()
  },

  goToTabHistory: (paneId, delta) => {
    const state = get()
    const pane = findPane(state.root, paneId)
    if (!pane) return
    const tab = pane.tabs.find((t) => t.id === pane.activeTabId)
    if (!tab || !tab.noteId) return
    const idx = tab.historyIndex + delta
    if (idx < 0 || idx >= tab.history.length) return
    flushActiveDraft()
    const noteId = tab.history[idx]
    const tabs = pane.tabs.map((t) =>
      t.id === tab.id ? { ...t, noteId, type: "note" as TabType, historyIndex: idx } : t,
    )
    set({ root: replacePane(state.root, pane.id, { ...pane, tabs }) })
    get().persist()
  },

  toggleLeftSidebar: () => {
    set({ leftSidebar: { ...get().leftSidebar, open: !get().leftSidebar.open } })
    get().persist()
  },
  toggleRightSidebar: () => {
    set({ rightSidebar: { ...get().rightSidebar, open: !get().rightSidebar.open } })
    get().persist()
  },
  setLeftTab: (tab) => {
    set({ leftSidebar: { ...get().leftSidebar, tab, open: true } })
    get().persist()
  },
  setRightTab: (tab) => {
    set({ rightSidebar: { ...get().rightSidebar, tab, open: true } })
    get().persist()
  },
  setSidebarWidth: (side, width) => {
    const clamped = Math.max(180, Math.min(500, width))
    if (side === "left") set({ leftSidebar: { ...get().leftSidebar, width: clamped } })
    else set({ rightSidebar: { ...get().rightSidebar, width: clamped } })
    get().persist()
  },

  applySettings: (settings) => set({ settings: mergeSettings(DEFAULT_SETTINGS, settings) }),

  updateSettings: (patch) => {
    const merged = mergeSettings(get().settings, patch)
    set({ settings: merged })
    void apiPutSettings(patch)
  },

  getActivePane: () => {
    const { root, activePaneId } = get()
    return findPane(root, activePaneId) ?? collectPanes(root)[0] ?? null
  },

  getActiveTab: () => {
    const pane = get().getActivePane()
    if (!pane) return null
    return pane.tabs.find((t) => t.id === pane.activeTabId) ?? null
  },
}))

// avoid circular import of api in store module top-level
async function apiPutSettings(patch: Partial<AppSettings>) {
  try {
    const { api } = await import("../api")
    await api.putSettings(patch)
  } catch {
    // offline — keep optimistic value
  }
}

export { findPane, collectPanes, replacePane }
