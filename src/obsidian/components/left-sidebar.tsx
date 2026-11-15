"use client"

// ─── Left sidebar: Files / Search / Bookmarks ────────────────────────────────
import { useState } from "react"
import { Bookmark, ChevronRight, ChevronsUpDown, ChevronsDownUp, FolderClosed, PanelLeftClose, Search, X, CaseSensitive } from "lucide-react"
import { useWorkspace, type LeftTab } from "../stores/workspace"
import { useUi } from "../stores/ui"
import { useSearchResults, useBookmarks, useBookmarkMutations } from "../hooks"
import { FileExplorer } from "./file-explorer"

export function LeftSidebar() {
  const sidebar = useWorkspace((s) => s.leftSidebar)
  const setLeftTab = useWorkspace((s) => s.setLeftTab)
  const toggleLeft = useWorkspace((s) => s.toggleLeftSidebar)
  const vaultName = useWorkspace((s) => s.vaultName)
  const ui = useUi()
  const corePlugins = useWorkspace((s) => s.settings.corePlugins)

  const tabs: { id: LeftTab; icon: React.ReactNode; label: string; enabled: boolean }[] = [
    { id: "files", icon: <FolderClosed size={16} />, label: "Files", enabled: corePlugins.fileExplorer },
    { id: "search", icon: <Search size={16} />, label: "Search", enabled: corePlugins.search },
    { id: "bookmarks", icon: <Bookmark size={16} />, label: "Bookmarks", enabled: corePlugins.bookmarks },
  ]
  const enabledTabs = tabs.filter((t) => t.enabled)
  const activeLeftTab = enabledTabs.some((t) => t.id === sidebar.tab) ? sidebar.tab : (enabledTabs[0]?.id ?? null)

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--background-secondary)" }}>
      {/* horizontal tab strip at the top (40px, matches pane tab strip) */}
      <div className="obs-sidebar-header">
        {enabledTabs.map((t) => (
          <button
            key={t.id}
            className={`obs-icon-btn !h-7 !w-7 ${activeLeftTab === t.id ? "is-active" : ""}`}
            title={t.label}
            onClick={() => setLeftTab(t.id)}
          >
            {t.icon}
          </button>
        ))}
        <button
          className="obs-icon-btn !h-7 !w-7 ml-auto"
          title="Close left sidebar"
          onClick={toggleLeft}
        >
          <PanelLeftClose size={15} />
        </button>
      </div>
      {/* panel */}
      <div className="min-h-0 flex-1">
        {activeLeftTab === "files" && <FileExplorer />}
        {activeLeftTab === "search" && <SearchPanel />}
        {activeLeftTab === "bookmarks" && <BookmarksPanel />}
        {!activeLeftTab && (
          <div className="px-3 py-6 text-center text-[0.82rem]" style={{ color: "var(--text-faint)" }}>
            Enable core plugins in Settings to view panels here.
          </div>
        )}
      </div>
      {/* Vault switcher footer bar (matches obsidian desktop left sidebar footer) */}
      <div
        className="flex shrink-0 items-center justify-between px-2"
        style={{ height: 38, borderTop: "1px solid var(--background-modifier-border)" }}
      >
        <button
          className="obs-tree-row !min-h-[28px] !px-2 flex-1 justify-start"
          title="Open another vault"
          onClick={() => ui.openVaultPicker()}
        >
          <ChevronsUpDown size={13} className="shrink-0 opacity-70" />
          <span className="truncate font-medium" style={{ color: "var(--text-normal)" }}>{vaultName || "Vault"}</span>
        </button>
      </div>
    </div>
  )
}

// ─── Search panel ────────────────────────────────────────────────────────────

function SearchPanel() {
  const query = useUi((s) => s.searchQuery)
  const setQuery = useUi((s) => s.setSearchQuery)
  const caseSensitive = useUi((s) => s.searchCaseSensitive)
  const toggleCase = useUi((s) => s.toggleSearchCase)
  const { data, isLoading } = useSearchResults(query, caseSensitive)
  const openNote = useWorkspace((s) => s.openNote)
  const requestFind = useUi((s) => s.requestFind)
  const vaultId = useWorkspace((s) => s.vaultId)
  const coreBookmarks = useWorkspace((s) => s.settings.corePlugins.bookmarks)
  const { addBookmark } = useBookmarkMutations()
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set())

  const hits = query.trim() === "" ? [] : (data?.hits ?? [])
  const allCollapsed = hits.length > 0 && collapsedFiles.size >= hits.length

  return (
    <div className="flex h-full flex-col">
      <div className="p-2">
        <div className="flex items-center gap-1">
          <Search size={13} className="ml-1.5 shrink-0" style={{ color: "var(--text-faint)" }} />
          <input
            className="obs-input !py-1 !text-[0.85rem]"
            placeholder="Search…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="obs-icon-btn !h-6 !w-6"
              title="Clear search"
              onClick={() => setQuery("")}
            >
              <X size={13} />
            </button>
          )}
          <button
            className="obs-icon-btn !h-6 !w-6 !text-[11px] font-semibold"
            title="Match case"
            style={caseSensitive ? { color: "var(--interactive-accent)", background: "var(--background-modifier-active-hover)" } : undefined}
            onClick={toggleCase}
          >
            <CaseSensitive size={14} />
          </button>
          {coreBookmarks && query.trim() !== "" && vaultId && (
            <button
              className="obs-icon-btn !h-6 !w-6"
              title="Bookmark this search"
              onClick={() =>
                addBookmark.mutate({
                  vaultId,
                  itemType: "search",
                  itemId: null,
                  title: `Search: ${query.trim()}`,
                  query: query.trim(),
                })
              }
            >
              <Bookmark size={13} />
            </button>
          )}
          {hits.length > 0 && (
            <button
              className="obs-icon-btn !h-6 !w-6"
              title={allCollapsed ? "Expand all results" : "Collapse all results"}
              onClick={() => setCollapsedFiles(allCollapsed ? new Set() : new Set(hits.map((h) => h.noteId)))}
            >
              {allCollapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
            </button>
          )}
        </div>
        <div className="mt-1.5 px-1 text-[0.72rem]" style={{ color: "var(--text-faint)" }}>
          {query.trim() === ""
            ? "Search all files. Try tag:#x, path:x, file:x, OR, -term"
            : isLoading
              ? "Searching…"
              : `${data?.totalMatches ?? 0} matches in ${data?.totalFiles ?? 0} files`}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1 pb-8">
        {hits.map((hit) => {
          const collapsed = collapsedFiles.has(hit.noteId)
          return (
            <div key={hit.noteId} className="mb-0.5">
              <div
                className="obs-tree-row"
                onClick={() => {
                  // clicking the file title opens the note (obsidian behaviour)
                  openNote(hit.noteId)
                  setCollapsedFiles((prev) => {
                    const n = new Set(prev)
                    if (n.has(hit.noteId)) n.delete(hit.noteId)
                    else n.add(hit.noteId)
                    return n
                  })
                }}
              >
                <ChevronRight
                  size={12}
                  className="shrink-0 transition-transform"
                  style={{ transform: collapsed ? undefined : "rotate(90deg)" }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setCollapsedFiles((prev) => {
                      const n = new Set(prev)
                      if (n.has(hit.noteId)) n.delete(hit.noteId)
                      else n.add(hit.noteId)
                      return n
                    })
                  }}
                />
                <span className="truncate font-medium">{hit.name}</span>
                <span className="ml-auto rounded-full px-1.5 text-[0.68rem]" style={{ background: "var(--background-modifier-hover)", color: "var(--text-muted)" }}>
                  {hit.matchCount}
                </span>
              </div>
              {!collapsed &&
                hit.snippets.map((sn, i) => (
                  <div
                    key={i}
                    className="obs-snippet ml-4 py-0.5"
                    onClick={() => {
                      openNote(hit.noteId)
                      // after opening, trigger find using the actual matched text (handles operator queries like tag:/path:)
                      const findText = sn.match?.trim() || query.trim()
                      setTimeout(() => {
                        const tab = useWorkspace.getState().getActiveTab()
                        if (tab) requestFind(tab.id, { query: findText })
                      }, 150)
                    }}
                  >
                    {sn.before}
                    <b>{sn.match}</b>
                    {sn.after}
                  </div>
                ))}
            </div>
          )
        })}
        {query.trim() !== "" && !isLoading && hits.length === 0 && (
          <div className="px-3 py-4 text-[0.85rem]" style={{ color: "var(--text-faint)" }}>
            No matches found
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Bookmarks panel ─────────────────────────────────────────────────────────

function BookmarksPanel() {
  const { data: bookmarks } = useBookmarks()
  const { removeBookmark } = useBookmarkMutations()
  const openNote = useWorkspace((s) => s.openNote)
  const openGraph = useWorkspace((s) => s.openGraph)
  const setLeftTab = useWorkspace((s) => s.setLeftTab)
  const setSearchQuery = useUi((s) => s.setSearchQuery)

  const open = (b: NonNullable<typeof bookmarks>[number]) => {
    if (b.itemType === "note" && b.itemId) openNote(b.itemId)
    else if (b.itemType === "folder" && b.itemId) {
      // reveal the folder in the file explorer (expand + scroll to it)
      setLeftTab("files")
      window.dispatchEvent(new CustomEvent("obs-reveal-folder", { detail: b.itemId }))
    }
    else if (b.itemType === "graph") openGraph()
    else if (b.itemType === "search") {
      setSearchQuery(b.query)
      setLeftTab("search")
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center px-2 py-1 text-[0.8125rem] font-medium" style={{ minHeight: 32 }}>
        Bookmarks
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-8">
        {!bookmarks || bookmarks.length === 0 ? (
          <div className="px-3 py-6 text-center text-[0.85rem]" style={{ color: "var(--text-faint)" }}>
            No bookmarks yet.
            <br />
            Use the ⋯ menu or right-click a tab.
          </div>
        ) : (
          bookmarks.map((b) => (
            <div key={b.id} className="obs-tree-row group" onClick={() => open(b)}>
              <span className="truncate">{b.title}</span>
              <span className="ml-auto flex items-center gap-1">
                {b.itemType === "graph" && <span className="text-[0.65rem]" style={{ color: "var(--text-faint)" }}>graph</span>}
                <button
                  className="obs-icon-btn !h-5 !w-5 opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeBookmark.mutate(b.id)
                  }}
                >
                  <X size={11} />
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
