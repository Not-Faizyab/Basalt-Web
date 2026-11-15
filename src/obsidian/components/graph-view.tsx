"use client"

// ─── Graph view: d3-force + canvas, with obsidian's control panel ────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force"
import { Crosshair, Minus, Plus, RotateCcw, Settings2, X, Trash2 } from "lucide-react"
import type { GraphLink, GraphNode } from "@/lib/obsidian/types"
import { matchSearchExpr, parseSearchQuery } from "@/lib/obsidian/search"
import { DEFAULT_SETTINGS } from "@/lib/obsidian/settings"
import { useGraphData, useIndex } from "../hooks"
import { useWorkspace } from "../stores/workspace"

interface SimNode extends SimulationNodeDatum, GraphNode {
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
  color?: string
  isTag?: boolean
}

type SimLink = Omit<GraphLink, "source" | "target"> & {
  source: string | SimNode
  target: string | SimNode
}

function linkEndpointId(ep: string | SimNode): string {
  return typeof ep === "object" ? ep.id : ep
}

function matchesGraphQuery(query: string, node: SimNode, tags: string[]): boolean {
  const q = query.trim()
  if (!q) return true
  const expr = parseSearchQuery(q)
  const tagList = node.isTag ? [node.name.replace(/^#/, "")] : tags
  return matchSearchExpr(expr, {
    content: `${node.name} ${node.path} ${tagList.map((t) => "#" + t).join(" ")}`,
    name: node.name,
    path: node.path,
    tags: tagList,
    caseSensitive: false,
  })
}

export function GraphView({ local }: { local: boolean }) {
  const { data: graph } = useGraphData()
  const { data: index } = useIndex()
  const settings = useWorkspace((s) => s.settings)
  const updateSettings = useWorkspace((s) => s.updateSettings)
  const openNote = useWorkspace((s) => s.openNote)
  const activeTab = useWorkspace((s) => s.getActiveTab())
  const coreGraphOn = settings.corePlugins.graph

  // Track the last opened markdown note so focusing a Local Graph tab preserves its source note
  const [trackedNoteId, setTrackedNoteId] = useState<string | null>(() => activeTab?.noteId ?? null)
  useEffect(() => {
    if (activeTab?.noteId) setTrackedNoteId(activeTab.noteId)
  }, [activeTab?.noteId])
  const currentNoteId = activeTab?.noteId ?? trackedNoteId

  const graphSettings = settings.graph
  const [showControls, setShowControls] = useState(true)
  const [filterText, setFilterText] = useState("")
  const [depth, setDepth] = useState(1)
  const [showOrphans, setShowOrphans] = useState(true)
  const [showTags, setShowTags] = useState(false)
  const [showAttachments, setShowAttachments] = useState(false)
  const [localIncoming, setLocalIncoming] = useState(true)
  const [localOutgoing, setLocalOutgoing] = useState(true)
  const [hovered, setHovered] = useState<string | null>(null)
  const [hoverInfo, setHoverInfo] = useState<{ name: string; degree: number; color: string | null; unresolved?: boolean } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const linksRef = useRef<SimLink[]>([])
  const viewRef = useRef({ x: 0, y: 0, k: 1 })
  const sizeRef = useRef({ w: 800, h: 600 })
  const rafRef = useRef<number>(0)
  const pinnedRef = useRef<Set<string>>(new Set())
  const lastPanRef = useRef({ x: 0, y: 0 })
  const dragDistRef = useRef({ x: 0, y: 0, moved: false })

  const tagsById = useMemo(() => {
    const m = new Map<string, string[]>()
    ;(index ?? []).forEach((e) => m.set(e.id, e.tags))
    return m
  }, [index])

  const currentNoteName = useMemo(() => {
    if (!currentNoteId) return null
    return index?.find((e) => e.id === currentNoteId)?.name ?? graph?.nodes.find((n) => n.id === currentNoteId)?.name ?? currentNoteId.replace(/\.md$/i, "")
  }, [currentNoteId, index, graph])

  // ── filtered / local / tag dataset ────────────────────────────────────────
  const activeData = useMemo(() => {
    if (!graph) return null
    let baseNodes: SimNode[] = graph.nodes.map((n) => ({ ...n }))
    let baseLinks: GraphLink[] = [...graph.links]

    if (!showAttachments) {
      const attachSet = new Set(
        baseNodes.filter((n) => /\.(png|jpe?g|gif|webp|avif|bmp|svg|pdf|mp[34]|wav|ogg)$/i.test(n.path || n.id)).map((n) => n.id),
      )
      if (attachSet.size > 0) {
        baseNodes = baseNodes.filter((n) => !attachSet.has(n.id))
        baseLinks = baseLinks.filter((l) => !attachSet.has(l.source) && !attachSet.has(l.target))
      }
    }

    if (showTags) {
      const tagSet = new Map<string, number>()
      const tagLinks: GraphLink[] = []
      for (const n of baseNodes) {
        const ts = tagsById.get(n.id) ?? []
        for (const t of ts) {
          const tid = `tag:${t}`
          tagSet.set(tid, (tagSet.get(tid) ?? 0) + 1)
          tagLinks.push({ source: n.id, target: tid })
        }
      }
      for (const [tid, deg] of tagSet) {
        baseNodes.push({ id: tid, name: `#${tid.slice(4)}`, path: tid, degree: deg, unresolved: false, isTag: true })
      }
      baseLinks = [...baseLinks, ...tagLinks]
    }

    if (local) {
      if (!currentNoteId) return { nodes: [], links: [] }
      const adj = new Map<string, string[]>()
      const addAdj = (a: string, b: string) => {
        if (!adj.has(a)) adj.set(a, [])
        adj.get(a)!.push(b)
      }
      for (const l of baseLinks) {
        if (localOutgoing) addAdj(l.source, l.target)
        if (localIncoming) addAdj(l.target, l.source)
      }
      const keep = new Set<string>([currentNoteId])
      let frontier = [currentNoteId]
      for (let d = 0; d < depth; d++) {
        const next: string[] = []
        for (const id of frontier) {
          for (const nb of adj.get(id) ?? []) {
            if (!keep.has(nb)) {
              keep.add(nb)
              next.push(nb)
            }
          }
        }
        frontier = next
      }
      baseNodes = baseNodes.filter((n) => keep.has(n.id))
      baseLinks = baseLinks.filter((l) => keep.has(l.source) && keep.has(l.target))
    }

    if (graphSettings.existingOnly) {
      baseNodes = baseNodes.filter((n) => !n.unresolved)
    }

    const activeNodeIds = new Set(baseNodes.map((n) => n.id))
    baseLinks = baseLinks.filter((l) => activeNodeIds.has(l.source) && activeNodeIds.has(l.target))

    if (!showOrphans) {
      const linked = new Set<string>()
      for (const l of baseLinks) {
        linked.add(l.source)
        linked.add(l.target)
      }
      baseNodes = baseNodes.filter((n) => linked.has(n.id) || (local && n.id === currentNoteId))
    }

    return { nodes: baseNodes, links: baseLinks }
  }, [graph, local, currentNoteId, depth, localIncoming, localOutgoing, showOrphans, showTags, showAttachments, graphSettings.existingOnly, tagsById])

  const groupColor = useCallback(
    (node: SimNode): string | null => {
      const tags = tagsById.get(node.id) ?? []
      for (const g of graphSettings.groups) {
        const q = g.query.trim()
        if (!q) continue
        if (matchesGraphQuery(q, node, tags)) return g.color
      }
      return null
    },
    [graphSettings.groups, tagsById],
  )

  // ── simulation ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeData || !coreGraphOn) return
    const nodes: SimNode[] = activeData.nodes.map((n) => {
      const existing = nodesRef.current.find((e) => e.id === n.id)
      const pinned = pinnedRef.current.has(n.id)
      return existing
        ? { ...existing, ...n, fx: pinned ? existing.fx : null, fy: pinned ? existing.fy : null }
        : { ...n, x: (Math.random() - 0.5) * 400, y: (Math.random() - 0.5) * 400 }
    })
    const nodeIds = new Set(nodes.map((n) => n.id))
    const links: SimLink[] = activeData.links
      .filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target))
      .map((l) => ({ ...l, source: l.source, target: l.target }))

    nodesRef.current = nodes
    linksRef.current = links

    simRef.current?.stop()
    const sim = forceSimulation<SimNode>(nodes)
      .force("charge", forceManyBody<SimNode>().strength(-120 * graphSettings.repelForce))
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(graphSettings.linkDistance)
          .strength(0.3 * graphSettings.linkForce),
      )
      .force("center", forceCenter(0, 0).strength(0.5 * graphSettings.centerForce))
      .force("x", forceX(0).strength(0.04 * graphSettings.centerForce))
      .force("y", forceY(0).strength(0.04 * graphSettings.centerForce))
      .force("collide", forceCollide<SimNode>(12))
      .alphaDecay(0.02)
    simRef.current = sim
    sim.restart()

    return () => {
      sim.stop()
    }
  }, [activeData, coreGraphOn, graphSettings.repelForce, graphSettings.linkForce, graphSettings.linkDistance, graphSettings.centerForce])

  // ── canvas render loop ─────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const { w, h } = sizeRef.current
    if (w <= 0 || h <= 0) return
    const dpr = window.devicePixelRatio || 1
    const targetW = Math.max(1, Math.round(w * dpr))
    const targetH = Math.max(1, Math.round(h * dpr))
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const cs = getComputedStyle(canvas)
    const bg = cs.getPropertyValue("--background-primary") || "#1e1e1e"
    const faint = cs.getPropertyValue("--text-faint") || "#666"
    const accent = cs.getPropertyValue("--interactive-accent") || "#8b6cef"
    const muted = cs.getPropertyValue("--text-muted") || "#999"
    const normal = cs.getPropertyValue("--text-normal") || "#dadada"

    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)

    const view = viewRef.current
    const nodes = nodesRef.current
    const links = linksRef.current
    const nodeMap = new Map(nodes.map((n) => [n.id, n]))

    const neighborIds = new Set<string>()
    if (hovered) {
      neighborIds.add(hovered)
      for (const l of links) {
        const s = linkEndpointId(l.source)
        const t = linkEndpointId(l.target)
        if (s === hovered) neighborIds.add(t)
        if (t === hovered) neighborIds.add(s)
      }
    }

    const filterMatch = (n: SimNode) => matchesGraphQuery(filterText, n, tagsById.get(n.id) ?? [])
    const toScreen = (x: number, y: number): [number, number] => [w / 2 + (x + view.x) * view.k, h / 2 + (y + view.y) * view.k]

    // links (highlight only directly incident links on hover)
    for (const l of links) {
      const s = nodeMap.get(linkEndpointId(l.source))
      const t = nodeMap.get(linkEndpointId(l.target))
      if (!s || !t) continue
      const [x1, y1] = toScreen(s.x ?? 0, s.y ?? 0)
      const [x2, y2] = toScreen(t.x ?? 0, t.y ?? 0)
      const dimmed = hovered !== null && s.id !== hovered && t.id !== hovered
      const filteredOut = !filterMatch(s) || !filterMatch(t)
      ctx.globalAlpha = dimmed || filteredOut ? 0.08 : 0.35
      ctx.strokeStyle = hovered !== null && !dimmed ? accent : faint
      ctx.lineWidth = Math.max(0.5, 1 * graphSettings.linkThickness * view.k * 0.7)
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      if (graphSettings.arrows && !dimmed && !filteredOut) {
        const angle = Math.atan2(y2 - y1, x2 - x1)
        const r = nodeRadius(t, graphSettings.nodeSize) * view.k
        const ax = x2 - Math.cos(angle) * (r + 3)
        const ay = y2 - Math.sin(angle) * (r + 3)
        ctx.fillStyle = ctx.strokeStyle
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(ax - Math.cos(angle - 0.4) * 6, ay - Math.sin(angle - 0.4) * 6)
        ctx.lineTo(ax - Math.cos(angle + 0.4) * 6, ay - Math.sin(angle + 0.4) * 6)
        ctx.closePath()
        ctx.fill()
      }
    }

    // nodes
    for (const n of nodes) {
      const [x, y] = toScreen(n.x ?? 0, n.y ?? 0)
      const r = nodeRadius(n, graphSettings.nodeSize) * view.k
      const dimmed = (hovered !== null && !neighborIds.has(n.id)) || !filterMatch(n)
      ctx.globalAlpha = dimmed ? 0.15 : 1

      const gc = groupColor(n)
      let color: string
      if (n.id === currentNoteId && local) color = accent
      else if (hovered === n.id) color = accent
      else if (n.isTag) color = "#7ec699"
      else if (n.unresolved) color = faint
      else if (gc) color = gc
      else color = muted

      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.globalAlpha *= n.unresolved ? 0.6 : 1
      ctx.fill()
      if (hovered === n.id) {
        ctx.strokeStyle = color
        ctx.lineWidth = 2.5
        ctx.globalAlpha = 0.5
        ctx.beginPath()
        ctx.arc(x, y, r + 3, 0, Math.PI * 2)
        ctx.stroke()
      }

      const labelAlpha =
        hovered === n.id || (hovered && neighborIds.has(n.id))
          ? 1
          : Math.max(0, Math.min(1, (view.k - 0.4) / Math.max(0.1, graphSettings.textFade * 0.25)))
      if (labelAlpha > 0.03 && !dimmed) {
        ctx.globalAlpha = labelAlpha * (n.unresolved ? 0.55 : 0.9)
        ctx.fillStyle = normal
        ctx.font = `${Math.min(13, Math.max(10, 11 * view.k))}px Inter, sans-serif`
        ctx.textAlign = "center"
        ctx.fillText(n.name, x, y + r + 13)
      }
    }
    ctx.globalAlpha = 1
  }, [hovered, filterText, graphSettings, groupColor, currentNoteId, local, tagsById])

  useEffect(() => {
    if (!coreGraphOn) return
    const loop = () => {
      draw()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw, coreGraphOn])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      sizeRef.current = { w: el.clientWidth, h: el.clientHeight }
      draw()
    })
    ro.observe(el)
    sizeRef.current = { w: el.clientWidth, h: el.clientHeight }
    return () => ro.disconnect()
  }, [draw])

  // ── pointer interactions ──────────────────────────────────────────────────
  const hitTest = (mx: number, my: number): SimNode | null => {
    const { w, h } = sizeRef.current
    const view = viewRef.current
    let best: SimNode | null = null
    let bestDist = Infinity
    for (const n of nodesRef.current) {
      const x = w / 2 + ((n.x ?? 0) + view.x) * view.k
      const y = h / 2 + ((n.y ?? 0) + view.y) * view.k
      const r = nodeRadius(n, graphSettings.nodeSize) * view.k + 6
      const d = (mx - x) ** 2 + (my - y) ** 2
      if (d < r * r && d < bestDist) {
        best = n
        bestDist = d
      }
    }
    return best
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    dragDistRef.current = { x: e.clientX, y: e.clientY, moved: false }
    lastPanRef.current = { x: mx, y: my }
    const hit = hitTest(mx, my)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (hit) {
      setDraggingId(hit.id)
      setHovered(hit.id)
      setHoverInfo({ name: hit.name, degree: hit.degree, color: groupColor(hit), unresolved: hit.unresolved })
      simRef.current?.alphaTarget(0.25).restart()
    } else {
      setDraggingId("__pan__")
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const view = viewRef.current
    const { w, h } = sizeRef.current

    if (draggingId) {
      if (Math.hypot(e.clientX - dragDistRef.current.x, e.clientY - dragDistRef.current.y) > 4) {
        dragDistRef.current.moved = true
      }
    }

    if (draggingId && draggingId !== "__pan__") {
      const node = nodesRef.current.find((n) => n.id === draggingId)
      if (node) {
        node.fx = (mx - w / 2) / view.k - view.x
        node.fy = (my - h / 2) / view.k - view.y
        if (e.shiftKey) pinnedRef.current.add(node.id)
      }
      return
    }
    if (draggingId === "__pan__") {
      view.x += (mx - lastPanRef.current.x) / view.k
      view.y += (my - lastPanRef.current.y) / view.k
      lastPanRef.current = { x: mx, y: my }
      return
    }
    const hit = hitTest(mx, my)
    setHovered(hit?.id ?? null)
    setHoverInfo(hit ? { name: hit.name, degree: hit.degree, color: groupColor(hit), unresolved: hit.unresolved } : null)
    if (canvasRef.current) canvasRef.current.style.cursor = hit ? "pointer" : "default"
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if ((e.currentTarget as HTMLElement).hasPointerCapture?.(e.pointerId)) {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    }
    if (draggingId && draggingId !== "__pan__") {
      const node = nodesRef.current.find((n) => n.id === draggingId)
      if (node) {
        if (e.shiftKey) pinnedRef.current.add(node.id)
        if (!pinnedRef.current.has(node.id)) {
          node.fx = null
          node.fy = null
        }
      }
      simRef.current?.alphaTarget(0)
    }
    setDraggingId(null)
  }

  const onClick = (e: React.MouseEvent) => {
    if (dragDistRef.current.moved) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top)
    if (!hit) return
    if (hit.isTag) {
      window.dispatchEvent(new CustomEvent("obs-open-search", { detail: { query: `tag:#${hit.id.slice(4)}` } }))
      return
    }
    openNote(hit.unresolved ? hit.name : hit.id)
  }

  // Register native non-passive wheel listener so zoom never scrolls ancestor or warns
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const { w, h } = sizeRef.current
      const view = viewRef.current
      const oldK = view.k
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const newK = Math.max(0.08, Math.min(14, oldK * factor))
      const wx = (mx - w / 2) / oldK - view.x
      const wy = (my - h / 2) / oldK - view.y
      view.k = newK
      view.x = (mx - w / 2) / newK - wx
      view.y = (my - h / 2) / newK - wy
    }
    canvas.addEventListener("wheel", onWheelNative, { passive: false })
    return () => canvas.removeEventListener("wheel", onWheelNative)
  }, [coreGraphOn, activeData])

  const fit = () => {
    const nodes = nodesRef.current
    if (nodes.length === 0) return
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity
    for (const n of nodes) {
      minX = Math.min(minX, n.x ?? 0)
      maxX = Math.max(maxX, n.x ?? 0)
      minY = Math.min(minY, n.y ?? 0)
      maxY = Math.max(maxY, n.y ?? 0)
    }
    const { w, h } = sizeRef.current
    const pad = 80
    const rawK = Math.min(Math.max(40, w - pad) / Math.max(1, maxX - minX), Math.max(40, h - pad) / Math.max(1, maxY - minY), 3)
    const k = Math.max(0.15, rawK)
    viewRef.current = {
      k,
      x: -(minX + maxX) / 2,
      y: -(minY + maxY) / 2,
    }
  }

  const zoomBy = (f: number) => {
    const view = viewRef.current
    view.k = Math.max(0.08, Math.min(14, view.k * f))
  }

  const restoreDefaults = () => {
    setFilterText("")
    setShowOrphans(true)
    setShowTags(false)
    setShowAttachments(false)
    setDepth(1)
    setLocalIncoming(true)
    setLocalOutgoing(true)
    updateSettings({
      graph: {
        ...DEFAULT_SETTINGS.graph,
        groups: [],
      },
    })
  }

  if (!coreGraphOn) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-[0.85rem]" style={{ background: "var(--background-primary)", color: "var(--text-faint)" }}>
        Graph view is disabled in Settings → Core plugins.
      </div>
    )
  }

  if (!activeData) {
    return (
      <div className="flex h-full items-center justify-center text-[0.85rem]" style={{ background: "var(--background-primary)", color: "var(--text-faint)" }}>
        Loading graph…
      </div>
    )
  }

  if (local && !currentNoteId) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-[0.85rem]" style={{ background: "var(--background-primary)", color: "var(--text-faint)" }}>
        Open a note to view its local graph.
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative h-full overflow-hidden" style={{ background: "var(--background-primary)" }}>
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        style={{ display: "block" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
        onDoubleClick={fit}
      />

      {local && currentNoteName && !hovered && (
        <div className="pointer-events-none absolute left-3 top-3 obs-graph-panel px-2.5 py-1 text-[0.76rem]" style={{ color: "var(--text-muted)" }}>
          Graph of <span className="font-medium" style={{ color: "var(--text-normal)" }}>{currentNoteName}</span>
        </div>
      )}

      {/* toolbar */}
      <div className="absolute right-3 top-3 flex flex-col gap-1">
        <button className="obs-icon-btn obs-graph-panel" title="Graph settings" onClick={() => setShowControls(!showControls)}>
          <Settings2 size={15} />
        </button>
        <button className="obs-icon-btn obs-graph-panel" title="Zoom in" onClick={() => zoomBy(1.25)}>
          <Plus size={15} />
        </button>
        <button className="obs-icon-btn obs-graph-panel" title="Zoom out" onClick={() => zoomBy(0.8)}>
          <Minus size={15} />
        </button>
        <button className="obs-icon-btn obs-graph-panel" title="Fit to screen" onClick={fit}>
          <Crosshair size={15} />
        </button>
        <button
          className="obs-icon-btn obs-graph-panel"
          title="Restart force layout"
          onClick={() => {
            pinnedRef.current.clear()
            nodesRef.current.forEach((n) => {
              n.fx = null
              n.fy = null
            })
            simRef.current?.alpha(1).restart()
          }}
        >
          <RotateCcw size={15} />
        </button>
      </div>

      {hovered && hoverInfo && (
        <div className="pointer-events-none absolute left-3 top-3 obs-graph-panel px-2.5 py-1.5 text-[0.8rem]">
          <span className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: hoverInfo.color ?? (hoverInfo.unresolved ? "var(--text-faint)" : "var(--interactive-accent)") }} />
            <span className="font-medium">{hoverInfo.name}</span>
            <span style={{ color: "var(--text-faint)" }}>{hoverInfo.degree} links</span>
          </span>
        </div>
      )}

      {/* controls */}
      {showControls && (
        <div className="obs-graph-panel absolute right-14 top-3 max-h-[calc(100%-24px)] w-64 overflow-y-auto p-3 text-[0.8rem]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[0.72rem] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
              {local && currentNoteName ? `Graph of ${currentNoteName}` : local ? "Local graph" : "Filters"}
            </span>
            <div className="flex items-center gap-0.5">
              <button className="obs-icon-btn !h-5 !w-5" title="Restore default settings" onClick={restoreDefaults}>
                <RotateCcw size={11} />
              </button>
              <button className="obs-icon-btn !h-5 !w-5" onClick={() => setShowControls(false)}>
                <X size={12} />
              </button>
            </div>
          </div>

          <input
            className="obs-input mb-2 !py-1 !text-[0.8rem]"
            placeholder="Search files… (tag:, path:, -)"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />

          <div className="mb-2 space-y-1">
            <label className="flex cursor-pointer items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={showTags}
                onChange={(e) => setShowTags(e.target.checked)}
                style={{ accentColor: "var(--interactive-accent)" }}
              />
              Tags
            </label>
            <label className="flex cursor-pointer items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={showAttachments}
                onChange={(e) => setShowAttachments(e.target.checked)}
                style={{ accentColor: "var(--interactive-accent)" }}
              />
              Attachments
            </label>
            <label className="flex cursor-pointer items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={graphSettings.existingOnly}
                onChange={(e) => updateSettings({ graph: { ...graphSettings, existingOnly: e.target.checked } })}
                style={{ accentColor: "var(--interactive-accent)" }}
              />
              Existing files only
            </label>
            <label className="flex cursor-pointer items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={showOrphans}
                onChange={(e) => setShowOrphans(e.target.checked)}
                style={{ accentColor: "var(--interactive-accent)" }}
              />
              Orphans
            </label>
          </div>

          {local && (
            <div className="mb-3 space-y-1.5 border-t pt-2" style={{ borderColor: "var(--background-modifier-border)" }}>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span style={{ color: "var(--text-muted)" }}>Depth</span>
                  <span style={{ color: "var(--text-faint)" }}>{depth}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={1}
                  value={depth}
                  onChange={(e) => setDepth(parseInt(e.target.value, 10))}
                  className="w-full"
                  style={{ accentColor: "var(--interactive-accent)" }}
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 select-none">
                <input
                  type="checkbox"
                  checked={localIncoming}
                  onChange={(e) => setLocalIncoming(e.target.checked)}
                  style={{ accentColor: "var(--interactive-accent)" }}
                />
                Incoming links
              </label>
              <label className="flex cursor-pointer items-center gap-2 select-none">
                <input
                  type="checkbox"
                  checked={localOutgoing}
                  onChange={(e) => setLocalOutgoing(e.target.checked)}
                  style={{ accentColor: "var(--interactive-accent)" }}
                />
                Outgoing links
              </label>
            </div>
          )}

          <Section title="Groups">
            {graphSettings.groups.map((g, i) => (
              <div key={i} className="mb-1.5 flex items-center gap-1.5">
                <input
                  type="color"
                  value={g.color}
                  onChange={(e) => {
                    const groups = [...graphSettings.groups]
                    groups[i] = { ...g, color: e.target.value }
                    updateSettings({ graph: { ...graphSettings, groups } })
                  }}
                  className="h-5 w-5 shrink-0 cursor-pointer rounded border-none bg-transparent"
                />
                <input
                  className="obs-input !py-0.5 !text-[0.78rem]"
                  value={g.query}
                  placeholder="tag:#x or path:x"
                  onChange={(e) => {
                    const groups = [...graphSettings.groups]
                    groups[i] = { ...g, query: e.target.value }
                    updateSettings({ graph: { ...graphSettings, groups } })
                  }}
                />
                <button
                  className="obs-icon-btn !h-5 !w-5"
                  onClick={() => updateSettings({ graph: { ...graphSettings, groups: graphSettings.groups.filter((_, j) => j !== i) } })}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            <button
              className="obs-text-btn !px-1 !py-0.5 !text-[0.75rem]"
              onClick={() => updateSettings({ graph: { ...graphSettings, groups: [...graphSettings.groups, { query: "", color: "#e9967a" }] } })}
            >
              + Add group
            </button>
          </Section>

          <Section title="Display">
            <Slider label="Arrows" value={null} onChange={null} checkbox={{ checked: graphSettings.arrows, set: (v) => updateSettings({ graph: { ...graphSettings, arrows: v } }) }} />
            <Slider label="Text fade threshold" value={graphSettings.textFade} min={0} max={10} step={0.5} onChange={(v) => updateSettings({ graph: { ...graphSettings, textFade: v } })} />
            <Slider label="Node size" value={graphSettings.nodeSize} min={0.5} max={2.5} step={0.1} onChange={(v) => updateSettings({ graph: { ...graphSettings, nodeSize: v } })} />
            <Slider label="Link thickness" value={graphSettings.linkThickness} min={0.5} max={2.5} step={0.1} onChange={(v) => updateSettings({ graph: { ...graphSettings, linkThickness: v } })} />
          </Section>

          <Section title="Forces">
            <Slider label="Center force" value={graphSettings.centerForce} min={0} max={2} step={0.1} onChange={(v) => updateSettings({ graph: { ...graphSettings, centerForce: v } })} />
            <Slider label="Repel force" value={graphSettings.repelForce} min={0} max={3} step={0.1} onChange={(v) => updateSettings({ graph: { ...graphSettings, repelForce: v } })} />
            <Slider label="Link force" value={graphSettings.linkForce} min={0} max={2} step={0.1} onChange={(v) => updateSettings({ graph: { ...graphSettings, linkForce: v } })} />
            <Slider label="Link distance" value={graphSettings.linkDistance} min={30} max={400} step={10} onChange={(v) => updateSettings({ graph: { ...graphSettings, linkDistance: v } })} />
          </Section>
        </div>
      )}
    </div>
  )
}

function nodeRadius(n: { degree: number }, nodeSize: number): number {
  return (3.5 + Math.sqrt(n.degree) * 1.6) * nodeSize
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 border-t pt-2" style={{ borderColor: "var(--background-modifier-border)" }}>
      <div className="mb-1.5 text-[0.72rem] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  checkbox,
}: {
  label: string
  value: number | null
  min?: number
  max?: number
  step?: number
  onChange: ((v: number) => void) | null
  checkbox?: { checked: boolean; set: (v: boolean) => void }
}) {
  if (checkbox && value === null) {
    return (
      <label className="mb-1.5 flex cursor-pointer items-center justify-between select-none">
        <span>{label}</span>
        <input type="checkbox" checked={checkbox.checked} onChange={(e) => checkbox.set(e.target.checked)} style={{ accentColor: "var(--interactive-accent)" }} />
      </label>
    )
  }
  return (
    <div className="mb-1.5">
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <span className="text-[0.72rem]" style={{ color: "var(--text-faint)" }}>
          {value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value ?? 0}
        onChange={(e) => onChange?.(parseFloat(e.target.value))}
        className="w-full"
        style={{ accentColor: "var(--interactive-accent)" }}
      />
    </div>
  )
}
