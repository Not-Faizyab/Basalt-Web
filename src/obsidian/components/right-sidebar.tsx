"use client"

// ─── Right sidebar: Backlinks / Outgoing / Outline / Tags ────────────────────
import { useMemo, useState } from "react"
import { ArrowRight, ChevronRight, Hash, Link2, List, Link, PanelRightClose } from "lucide-react"
import { useWorkspace, type RightTab } from "../stores/workspace"
import { useUi } from "../stores/ui"
import { useBacklinks, useIndex, useTagCounts } from "../hooks"
import { useDocs } from "../stores/docs"
import { extractOutline } from "@/lib/obsidian/blocks"
import { buildIndexMap, extractLinks, resolveLink, linkOccurrence } from "@/lib/obsidian/links"
import { api } from "../api"

export function RightSidebar() {
  const sidebar = useWorkspace((s) => s.rightSidebar)
  const setRightTab = useWorkspace((s) => s.setRightTab)
  const toggleRight = useWorkspace((s) => s.toggleRightSidebar)
  const core = useWorkspace((s) => s.settings.corePlugins)

  const tabs: { id: RightTab; icon: React.ReactNode; label: string; enabled: boolean }[] = [
    { id: "backlinks", icon: <Link2 size={16} />, label: "Backlinks", enabled: core.backlinks },
    { id: "outgoing", icon: <ArrowRight size={16} />, label: "Outgoing links", enabled: core.outgoingLinks },
    { id: "outline", icon: <List size={16} />, label: "Outline", enabled: core.outline },
    { id: "tags", icon: <Hash size={16} />, label: "Tags", enabled: core.tags },
  ]
  const enabledTabs = tabs.filter((t) => t.enabled)
  const activeRightTab = enabledTabs.some((t) => t.id === sidebar.tab) ? sidebar.tab : (enabledTabs[0]?.id ?? null)

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--background-secondary)" }}>
      {/* horizontal tab strip at the top (40px, matches left sidebar & pane tabbar) */}
      <div className="obs-sidebar-header obs-win-caption-slot">
        {enabledTabs.map((t) => (
          <button
            key={t.id}
            className={`obs-icon-btn !h-7 !w-7 ${activeRightTab === t.id ? "is-active" : ""}`}
            title={t.label}
            onClick={() => setRightTab(t.id)}
          >
            {t.icon}
          </button>
        ))}
        <button
          className="obs-icon-btn !h-7 !w-7 ml-auto"
          title="Close right sidebar"
          onClick={toggleRight}
        >
          <PanelRightClose size={15} />
        </button>
      </div>
      {/* panel */}
      <div className="min-h-0 flex-1">
        {activeRightTab === "backlinks" && <BacklinksPanel />}
        {activeRightTab === "outgoing" && <OutgoingPanel />}
        {activeRightTab === "outline" && <OutlinePanel />}
        {activeRightTab === "tags" && <TagsPanel />}
        {!activeRightTab && (
          <div className="px-3 py-6 text-center text-[0.82rem]" style={{ color: "var(--text-faint)" }}>
            Enable core plugins in Settings to view panels here.
          </div>
        )}
      </div>
    </div>
  )
}

function PanelHeader({ title, extra }: { title: string; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-1 text-[0.8125rem] font-medium" style={{ minHeight: 32 }}>
      <span>{title}</span>
      {extra}
    </div>
  )
}

// ─── Backlinks ───────────────────────────────────────────────────────────────

function BacklinksPanel() {
  const activeTab = useWorkspace((s) => s.getActiveTab())
  const noteId = activeTab?.noteId ?? null
  const { data } = useBacklinks(noteId)
  const openNote = useWorkspace((s) => s.openNote)
  const vaultId = useWorkspace((s) => s.vaultId)
  const [linkedOpen, setLinkedOpen] = useState(true)
  const [unlinkedOpen, setUnlinkedOpen] = useState(false)

  if (!noteId) {
    return (
      <div className="px-3 py-6 text-center text-[0.85rem]" style={{ color: "var(--text-faint)" }}>
        No file open
      </div>
    )
  }

  const linkMention = async (sourceNoteId: string, noteName: string, occurrenceIndex: number, snippetMatch: string) => {
    // flush active edits first so linkMention never overwrites uncommitted keystrokes
    window.dispatchEvent(new CustomEvent("obs-flush-active-draft"))
    await useDocs.getState().flushAll()
    const note = await api.note(sourceNoteId)
    const next = linkOccurrence(note.content, snippetMatch, occurrenceIndex, noteName)
    await api.patchNote(sourceNoteId, { content: next })
    window.dispatchEvent(new CustomEvent("obs-invalidate", { detail: { vaultId, noteId: sourceNoteId, kinds: ["index", "graph", "backlinks"] } }))
    const docs = useDocs.getState()
    if (docs.docs[sourceNoteId]) docs.renameInDocs(sourceNoteId, next)
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Backlinks" />
      <div className="flex-1 overflow-y-auto px-1 pb-8 pt-1">
        {/* linked mentions */}
        <div
          className="obs-tree-row !text-[0.8rem] font-semibold"
          onClick={() => setLinkedOpen(!linkedOpen)}
          style={{ color: "var(--text-muted)" }}
        >
          <ChevronRight size={12} className="shrink-0" style={{ transform: linkedOpen ? "rotate(90deg)" : undefined }} />
          Linked mentions ({data?.linked.length ?? 0})
        </div>
        {linkedOpen &&
          (data?.linked.length ? (
            data.linked.map((m) => (
              <div key={m.noteId} className="ml-2">
                <div className="obs-tree-row !min-h-[26px] !text-[0.82rem] font-medium" onClick={() => openNote(m.noteId)}>
                  <span className="truncate">{m.noteName}</span>
                  {m.occurrences > 1 && (
                    <span className="ml-auto text-[0.65rem]" style={{ color: "var(--text-faint)" }}>
                      ×{m.occurrences}
                    </span>
                  )}
                </div>
                <div className="obs-snippet ml-4 !mb-1.5" onClick={() => openNote(m.noteId)}>
                  {m.before}
                  <b style={{ color: "var(--text-accent)" }}>{m.match}</b>
                  {m.after}
                </div>
              </div>
            ))
          ) : (
            <div className="ml-6 py-2 text-[0.78rem]" style={{ color: "var(--text-faint)" }}>
              No linked mentions
            </div>
          ))}

        {/* unlinked mentions */}
        <div
          className="obs-tree-row mt-2 !text-[0.8rem] font-semibold"
          onClick={() => setUnlinkedOpen(!unlinkedOpen)}
          style={{ color: "var(--text-muted)" }}
        >
          <ChevronRight size={12} className="shrink-0" style={{ transform: unlinkedOpen ? "rotate(90deg)" : undefined }} />
          Unlinked mentions ({data?.unlinked.length ?? 0})
        </div>
        {unlinkedOpen &&
          (data?.unlinked.length ? (
            data.unlinked.map((m) => (
              <div key={m.noteId} className="ml-2">
                <div className="obs-tree-row !min-h-[26px] !text-[0.82rem] font-medium" onClick={() => openNote(m.noteId)}>
                  <span className="truncate">{m.noteName}</span>
                  <span className="ml-auto text-[0.65rem]" style={{ color: "var(--text-faint)" }}>
                    ×{m.occurrences}
                  </span>
                </div>
                <div className="obs-snippet ml-4 !mb-1.5">
                  {m.before}
                  <b>{m.match}</b>
                  {m.after}
                  <button
                    className="ml-2 shrink-0 rounded px-1.5 py-0.5 text-[0.7rem]"
                    style={{ background: "var(--interactive-accent)", color: "var(--text-on-accent)" }}
                    onClick={(e) => {
                      e.stopPropagation()
                      void linkMention(m.noteId, data.noteName, 0, m.match)
                    }}
                  >
                    Link
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="ml-6 py-2 text-[0.78rem]" style={{ color: "var(--text-faint)" }}>
              No unlinked mentions
            </div>
          ))}
      </div>
    </div>
  )
}

// ─── Outgoing links ──────────────────────────────────────────────────────────

function OutgoingPanel() {
  const activeTab = useWorkspace((s) => s.getActiveTab())
  const noteId = activeTab?.noteId ?? null
  const { data: index } = useIndex()
  const docs = useDocs((s) => s.docs)
  const openNote = useWorkspace((s) => s.openNote)
  const maps = useMemo(() => buildIndexMap(index ?? []), [index])
  const isCanvas = !!noteId && (/\.canvas$/i.test(noteId) || index?.some((e) => e.id === noteId && e.name.endsWith(".canvas")) === true)
  const content = noteId && !isCanvas ? docs[noteId]?.content : undefined

  const { resolved, unresolved } = useMemo(() => {
    if (!content || !index) return { resolved: [], unresolved: [] as string[] }
    const seenR = new Set<string>()
    const seenU = new Set<string>()
    const resolved: { id: string; name: string; display: string }[] = []
    const unresolved: string[] = []
    for (const link of extractLinks(content)) {
      const entry = resolveLink(link.target, maps)
      if (entry) {
        if (!seenR.has(entry.id)) {
          seenR.add(entry.id)
          resolved.push({ id: entry.id, name: entry.name, display: link.alias || link.target })
        }
      } else if (link.target && !seenU.has(link.target.toLowerCase())) {
        seenU.add(link.target.toLowerCase())
        unresolved.push(link.target)
      }
    }
    return { resolved, unresolved }
  }, [content, index, maps])

  if (!noteId) {
    return (
      <div className="px-3 py-6 text-center text-[0.85rem]" style={{ color: "var(--text-faint)" }}>
        No file open
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Outgoing links" />
      <div className="flex-1 overflow-y-auto px-1 pb-8">
        <div className="obs-tree-row !text-[0.8rem] font-semibold" style={{ color: "var(--text-muted)" }}>
          Links ({resolved.length})
        </div>
        {resolved.map((r) => (
          <div key={r.id} className="obs-tree-row ml-3 !text-[0.82rem]" onClick={() => openNote(r.id)}>
            <Link size={12} className="shrink-0 opacity-60" />
            <span className="truncate">{r.display}</span>
          </div>
        ))}
        {resolved.length === 0 && (
          <div className="ml-6 py-1.5 text-[0.78rem]" style={{ color: "var(--text-faint)" }}>
            No outgoing links
          </div>
        )}
        {unresolved.length > 0 && (
          <>
            <div className="obs-tree-row mt-2 !text-[0.8rem] font-semibold" style={{ color: "var(--text-muted)" }}>
              Unresolved ({unresolved.length})
            </div>
            {unresolved.map((u) => (
              <div key={u} className="obs-tree-row ml-3 !text-[0.82rem]" onClick={() => openNote(u)}>
                <Link size={12} className="shrink-0 opacity-40" />
                <span className="truncate" style={{ color: "var(--text-faint)" }}>
                  {u}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Outline ─────────────────────────────────────────────────────────────────

function OutlinePanel() {
  const activeTab = useWorkspace((s) => s.getActiveTab())
  const linkIndex = useWorkspace((s) => s.linkIndex)
  const noteId = activeTab?.noteId ?? null
  const docs = useDocs((s) => s.docs)
  const isCanvas = !!noteId && (/\.canvas$/i.test(noteId) || linkIndex.some((e) => e.id === noteId && e.name.endsWith(".canvas")))
  const content = noteId && !isCanvas ? docs[noteId]?.content : undefined
  const outline = useMemo(() => (content ? extractOutline(content) : []), [content])

  if (!noteId) {
    return (
      <div className="px-3 py-6 text-center text-[0.85rem]" style={{ color: "var(--text-faint)" }}>
        No file open
      </div>
    )
  }

  const scrollTo = (headingText: string, index: number) => {
    window.dispatchEvent(new CustomEvent("obs-scroll-to", { detail: { noteId, subpath: "#" + headingText, headingIndex: index } }))
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Outline" extra={<span className="text-[0.72rem]" style={{ color: "var(--text-faint)" }}>{outline.length} headings</span>} />
      <div className="flex-1 overflow-y-auto px-1 pb-8">
        {outline.length === 0 ? (
          <div className="px-3 py-6 text-center text-[0.85rem]" style={{ color: "var(--text-faint)" }}>
            No headings in this note
          </div>
        ) : (
          outline.map((h, i) => (
            <div
              key={i}
              className="obs-tree-row !text-[0.82rem]"
              style={{ paddingLeft: 8 + (h.level - 1) * 14 }}
              onClick={() => scrollTo(h.text, h.index)}
            >
              <span className="truncate">{h.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Tags ────────────────────────────────────────────────────────────────────

interface TagTreeNode {
  seg: string
  fullTag: string
  count: number
  children: TagTreeNode[]
}

function TagsPanel() {
  const { data: tags } = useTagCounts()
  const [sortAZ, setSortAZ] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const setSearchQuery = useUi((s) => s.setSearchQuery)
  const setLeftTab = useWorkspace((s) => s.setLeftTab)

  const tree = useMemo<TagTreeNode[]>(() => {
    const roots = new Map<string, TagTreeNode>()
    for (const entry of tags ?? []) {
      const clean = entry.tag.replace(/^#/, "")
      const parts = clean.split("/").filter(Boolean)
      if (parts.length === 0) continue
      let level = roots
      let prefix = ""
      for (let i = 0; i < parts.length; i++) {
        const seg = parts[i]
        prefix = prefix ? `${prefix}/${seg}` : seg
        let node = level.get(seg)
        if (!node) {
          node = { seg, fullTag: prefix, count: 0, children: [] }
          level.set(seg, node)
        }
        if (i === parts.length - 1) node.count += entry.count
        if (i < parts.length - 1) {
          const nextSeg = parts[i + 1]
          let child = node.children.find((c) => c.seg === nextSeg)
          if (!child) {
            child = { seg: nextSeg, fullTag: `${prefix}/${nextSeg}`, count: 0, children: [] }
            node.children.push(child)
          }
          level = new Map([[nextSeg, child]])
        }
      }
    }
    const subtotal = (n: TagTreeNode): number => n.count + n.children.reduce((s, c) => s + subtotal(c), 0)
    const sortList = (list: TagTreeNode[]) => {
      list.sort((a, b) => (sortAZ ? a.seg.localeCompare(b.seg) : subtotal(b) - subtotal(a) || a.seg.localeCompare(b.seg)))
      list.forEach((n) => sortList(n.children))
    }
    const result = [...roots.values()]
    sortList(result)
    return result
  }, [tags, sortAZ])

  const renderNode = (node: TagTreeNode, depth: number) => {
    const hasKids = node.children.length > 0
    const isCollapsed = collapsed.has(node.fullTag)
    return (
      <div key={node.fullTag}>
        <div
          className="obs-tree-row !text-[0.82rem]"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => {
            setSearchQuery("tag:#" + node.fullTag)
            setLeftTab("search")
          }}
        >
          {hasKids ? (
            <ChevronRight
              size={12}
              className="shrink-0 opacity-70 transition-transform"
              style={{ transform: isCollapsed ? undefined : "rotate(90deg)" }}
              onClick={(e) => {
                e.stopPropagation()
                setCollapsed((prev) => {
                  const n = new Set(prev)
                  if (n.has(node.fullTag)) n.delete(node.fullTag)
                  else n.add(node.fullTag)
                  return n
                })
              }}
            />
          ) : (
            <Hash size={12} className="shrink-0 opacity-60" />
          )}
          <span className="truncate">{depth === 0 && hasKids ? `#${node.seg}` : node.seg}</span>
          {node.count > 0 && (
            <span className="ml-auto text-[0.68rem]" style={{ color: "var(--text-faint)" }}>
              {node.count}
            </span>
          )}
        </div>
        {hasKids && !isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Tags"
        extra={
          <button className="obs-text-btn !px-1.5 !py-0 !text-[0.72rem]" onClick={() => setSortAZ(!sortAZ)}>
            {sortAZ ? "A–Z" : "By frequency"}
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-1 pb-8">
        {tree.length === 0 ? (
          <div className="px-3 py-6 text-center text-[0.85rem]" style={{ color: "var(--text-faint)" }}>
            No tags yet — add #tags to notes
          </div>
        ) : (
          tree.map((t) => renderNode(t, 0))
        )}
      </div>
    </div>
  )
}
