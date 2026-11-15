"use client"

// ─── Canvas editor — obsidian-compatible .canvas whiteboard files ────────────
// Reads and writes the exact JSON format obsidian uses (nodes/edges), so a
// obsidian canvas opens in obsidian and vice-versa. Fully local, no servers.
//   • pan (drag background) / zoom (wheel, ctrl+wheel anywhere) / zoom buttons
//   • text cards (double-click background, or toolbar) — inline markdown editing
//   • file cards (notes + images) with live preview, click header to open
//   • edges: drag from a side dot to another card; labels; colors
//   • undo/redo (Ctrl+Z / Ctrl+Shift+Z), delete selection, card colors
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useQuery } from "@tanstack/react-query"
import {
  FileText,
  Globe,
  Grid,
  HelpCircle,
  Image as ImageIcon,
  Maximize2,
  Minus,
  Plus,
  Redo2,
  RotateCcw,
  Search,
  SquareDashed,
  StickyNote,
  Undo2,
} from "lucide-react"
import { parseCanvas, serializeCanvas, type CanvasData, type CanvasEdge, type CanvasNode, type CanvasNodeSide } from "@/lib/obsidian/types"
import { renderMarkdown } from "@/lib/obsidian/markdown"
import { fuzzyRank } from "@/lib/obsidian/fuzzy"
import { api } from "../api"
import { useWorkspace } from "../stores/workspace"
import { useUi } from "../stores/ui"
import { useAttachmentRenderOpts, useIndex, useVaultFiles } from "../hooks"
import { MarkdownBody } from "./markdown-render"
import { showMenuAt } from "./context-menu"
import { toast } from "sonner"

/** obsidian's canvas palette (ids are the strings stored in the file). */
const CANVAS_COLORS: Record<string, { label: string; rgb: string }> = {
  "1": { label: "Red", rgb: "226, 85, 75" },
  "2": { label: "Orange", rgb: "226, 149, 76" },
  "3": { label: "Yellow", rgb: "227, 197, 92" },
  "4": { label: "Green", rgb: "120, 199, 108" },
  "5": { label: "Cyan", rgb: "93, 199, 214" },
  "6": { label: "Purple", rgb: "160, 137, 245" },
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico"])

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export const CanvasEditor = memo(function CanvasEditor({
  content,
  onChange,
  noteId,
}: {
  content: string
  onChange: (next: string) => void
  noteId: string
}) {
  const vaultId = useWorkspace((s) => s.vaultId)
  const openNote = useWorkspace((s) => s.openNote)
  const { data: index } = useIndex()
  const files = useVaultFiles()
  const coreCanvasOn = useWorkspace((s) => s.settings.corePlugins.canvas)

  // ── data + external-change detection ───────────────────────────────────────
  const [data, setData] = useState<CanvasData>(() => parseCanvas(content))
  const dataRef = useRef(data)
  dataRef.current = data
  const lastSerialized = useRef<string>(serializeCanvas(parseCanvas(content)))
  useEffect(() => {
    if (content !== lastSerialized.current) {
      const parsed = parseCanvas(content)
      lastSerialized.current = content
      setData(parsed)
    }
  }, [content])

  // ── undo / redo ────────────────────────────────────────────────────────────
  const undoStack = useRef<string[]>([])
  const redoStack = useRef<string[]>([])
  const [, forceRender] = useState(0)

  const commit = (next: CanvasData, history = true) => {
    if (history) {
      undoStack.current.push(lastSerialized.current)
      if (undoStack.current.length > 60) undoStack.current.shift()
      redoStack.current = []
    }
    lastSerialized.current = serializeCanvas(next)
    onChange(lastSerialized.current)
    setData(next)
    forceRender((n) => n + 1)
  }

  const undo = () => {
    const prev = undoStack.current.pop()
    if (prev === undefined) return
    redoStack.current.push(lastSerialized.current)
    const parsed = parseCanvas(prev)
    lastSerialized.current = prev
    onChange(prev)
    setData(parsed)
    forceRender((n) => n + 1)
  }
  const redo = () => {
    const next = redoStack.current.pop()
    if (next === undefined) return
    undoStack.current.push(lastSerialized.current)
    const parsed = parseCanvas(next)
    lastSerialized.current = next
    onChange(next)
    setData(parsed)
    forceRender((n) => n + 1)
  }

  // ── viewport (pan / zoom) ──────────────────────────────────────────────────
  const [pan, setPan] = useState({ x: 60, y: 40 })
  const [zoom, setZoom] = useState(1)
  const panRef = useRef(pan)
  panRef.current = pan
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const wrapRef = useRef<HTMLDivElement>(null)

  const screenToCanvas = (sx: number, sy: number) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return { x: sx, y: sy }
    return { x: (sx - rect.left - pan.x) / zoom, y: (sy - rect.top - pan.y) / zoom }
  }

  // ── interaction state ──────────────────────────────────────────────────────
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null)
  const [edgeLabelDraft, setEdgeLabelDraft] = useState("")
  const [cardMenu, setCardMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const [addNoteOpen, setAddNoteOpen] = useState(false)
  const [addNoteQuery, setAddNoteQuery] = useState("")
  const [addLinkOpen, setAddLinkOpen] = useState(false)
  const [addLinkUrl, setAddLinkUrl] = useState("")
  const [snapToGrid, setSnapToGrid] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  const drag = useRef<
    | { mode: "pan"; sx: number; sy: number; panX: number; panY: number }
    | { mode: "node"; origins: { id: string; x: number; y: number }[]; startCanvas: { x: number; y: number }; moved: boolean }
    | { mode: "resize"; id: string; startX: number; startY: number; w: number; h: number; moved: boolean }
    | { mode: "connect"; fromId: string; fromSide: CanvasNodeSide; x: number; y: number }
    | null
  >(null)
  const [connectPreview, setConnectPreview] = useState<{ x: number; y: number } | null>(null)

  const nodeById = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes])
  const selectedSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds])
  const clipRef = useRef<CanvasNode[] | null>(null)
  const ctxPointRef = useRef<{ x: number; y: number } | null>(null)

  const addNode = (partial: Partial<CanvasNode> & { x: number; y: number }): CanvasNode => {
    const step = snapToGrid ? 20 : 1
    const snap = (v: number) => Math.round(v / step) * step
    const node: CanvasNode = {
      id: newId(),
      type: partial.type ?? "text",
      ...(partial.type === "text" || (!partial.type && partial.text !== undefined) ? { text: partial.text ?? "" } : {}),
      ...(partial.file !== undefined ? { file: partial.file } : {}),
      ...(partial.url !== undefined ? { url: partial.url } : {}),
      ...(partial.label !== undefined ? { label: partial.label } : {}),
      x: snap(partial.x),
      y: snap(partial.y),
      width: partial.width ?? (partial.type === "group" ? 420 : 260),
      height: partial.height ?? (partial.type === "group" ? 280 : 120),
      color: partial.color,
    }
    commit({ nodes: [...data.nodes, node], edges: data.edges })
    setSelectedNodeIds([node.id])
    setSelectedEdgeId(null)
    return node
  }

  const updateNode = (id: string, patch: Partial<CanvasNode>, history = true) => {
    commit({ nodes: data.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)), edges: data.edges }, history)
  }

  const deleteSelection = () => {
    if (selectedNodeIds.length > 0) {
      const delSet = new Set(selectedNodeIds)
      commit({
        nodes: data.nodes.filter((n) => !delSet.has(n.id)),
        edges: data.edges.filter((e) => !delSet.has(e.fromNode) && !delSet.has(e.toNode)),
      })
      setSelectedNodeIds([])
      return
    }
    if (selectedEdgeId) {
      commit({ nodes: data.nodes, edges: data.edges.filter((e) => e.id !== selectedEdgeId) })
      setSelectedEdgeId(null)
    }
  }

  const sideAnchor = (n: CanvasNode, side: CanvasNodeSide) => {
    switch (side) {
      case "top":
        return { x: n.x + n.width / 2, y: n.y }
      case "bottom":
        return { x: n.x + n.width / 2, y: n.y + n.height }
      case "left":
        return { x: n.x, y: n.y + n.height / 2 }
      case "right":
        return { x: n.x + n.width, y: n.y + n.height / 2 }
    }
  }

  const nearestSide = (n: CanvasNode, px: number, py: number): CanvasNodeSide => {
    const cx = n.x + n.width / 2
    const cy = n.y + n.height / 2
    const dx = (px - cx) / Math.max(1, n.width)
    const dy = (py - cy) / Math.max(1, n.height)
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left"
    return dy > 0 ? "bottom" : "top"
  }

  const copySelection = () => {
    if (selectedNodeIds.length > 0) {
      const copied = selectedNodeIds.map((id) => nodeById.get(id)).filter((n): n is CanvasNode => !!n)
      if (copied.length > 0) clipRef.current = copied
    }
  }

  const pasteNodes = (at?: { x: number; y: number }) => {
    const clip = clipRef.current
    if (!clip || clip.length === 0) return
    const rect = wrapRef.current?.getBoundingClientRect()
    const cx = at?.x ?? (rect ? (rect.width / 2 - pan.x) / zoom : 0)
    const cy = at?.y ?? (rect ? (rect.height / 2 - pan.y) / zoom : 0)
    const baseX = Math.min(...clip.map((n) => n.x))
    const baseY = Math.min(...clip.map((n) => n.y))
    const created = clip.map((n) => ({
      ...n,
      id: newId(),
      x: cx + (n.x - baseX) + 16,
      y: cy + (n.y - baseY) + 16,
    }))
    commit({ nodes: [...data.nodes, ...created], edges: data.edges })
    setSelectedNodeIds(created.map((n) => n.id))
    setSelectedEdgeId(null)
  }

  // Native non-passive wheel listener: Ctrl/Meta+scroll zooms toward cursor; plain scroll pans
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const z = zoomRef.current
      const p = panRef.current
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
        const nextZoom = Math.max(0.2, Math.min(3, z * factor))
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        setPan({
          x: cx - ((cx - p.x) * nextZoom) / z,
          y: cy - ((cy - p.y) * nextZoom) / z,
        })
        setZoom(nextZoom)
      } else {
        setPan({ x: p.x - e.deltaX, y: p.y - e.deltaY })
      }
    }
    el.addEventListener("wheel", onWheelNative, { passive: false })
    return () => el.removeEventListener("wheel", onWheelNative)
  }, [coreCanvasOn])

  // Close card menu on Escape
  useEffect(() => {
    if (!cardMenu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCardMenu(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [cardMenu])

  // ── add-note search (kept above early coreCanvasOn return to satisfy Hooks rules) ──
  const noteResults = useMemo(() => {
    if (!index) return []
    const q = addNoteQuery.trim()
    const list = index.filter((e) => e.kind !== "canvas")
    if (!q) return list.slice(0, 8)
    return fuzzyRank(q, list, (e) => e.name + " " + e.path).slice(0, 8).map((r) => r.item)
  }, [index, addNoteQuery])

  const imageResults = useMemo(() => {
    return files.filter((f) => IMAGE_EXTS.has(f.ext))
  }, [files])

  void noteId

  if (!coreCanvasOn) {
    return (
      <div className="flex h-full items-center justify-center text-[0.9rem]" style={{ color: "var(--text-faint)" }}>
        Canvas is disabled in Settings → Core plugins.
      </div>
    )
  }

  // ── pane-scoped keyboard shortcuts ─────────────────────────────────────────
  const onSurfaceKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName
    const typing = tag === "TEXTAREA" || tag === "INPUT" || (e.target as HTMLElement)?.isContentEditable
    if (typing) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault()
      redo()
      return
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "c") {
      copySelection()
      return
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault()
      copySelection()
      pasteNodes()
      return
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "v") {
      if (clipRef.current?.length) {
        e.preventDefault()
        pasteNodes()
      }
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault()
      setSelectedNodeIds(data.nodes.map((n) => n.id))
      return
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (selectedNodeIds.length > 0 || selectedEdgeId) {
        e.preventDefault()
        deleteSelection()
      }
      return
    }
    if (e.key === "Escape") {
      setSelectedNodeIds([])
      setSelectedEdgeId(null)
      setCardMenu(null)
      setEditingEdgeId(null)
    }
  }

  // ── pointer handling (pan / drag / resize / connect) ───────────────────────
  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    wrapRef.current?.focus({ preventScroll: true })
    if (e.button === 2) return
    setSelectedNodeIds([])
    setSelectedEdgeId(null)
    setEditingNodeId(null)
    setEditingEdgeId(null)
    setCardMenu(null)
    drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, panX: pan.x, panY: pan.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onNodePointerDown = (e: React.PointerEvent, n: CanvasNode) => {
    if (e.button === 2) return
    // Let clicks on interactive links, inputs, or buttons inside cards behave normally
    if ((e.target as HTMLElement).closest("a, button, input, textarea")) return
    e.stopPropagation()
    wrapRef.current?.focus({ preventScroll: true })
    if (editingNodeId === n.id) return
    setCardMenu(null)
    setSelectedEdgeId(null)
    let nextIds: string[]
    if (e.shiftKey) {
      nextIds = selectedSet.has(n.id) ? selectedNodeIds.filter((id) => id !== n.id) : [...selectedNodeIds, n.id]
      setSelectedNodeIds(nextIds)
    } else if (selectedSet.has(n.id)) {
      nextIds = selectedNodeIds
    } else {
      nextIds = [n.id]
      setSelectedNodeIds(nextIds)
    }
    const moveIds = nextIds.includes(n.id) ? nextIds : [n.id]
    // Dragging a group also carries cards wholly contained inside it
    const extraInside =
      n.type === "group" && !e.shiftKey
        ? data.nodes
            .filter((child) => child.id !== n.id && !moveIds.includes(child.id) && child.x >= n.x && child.y >= n.y && child.x + child.width <= n.x + n.width && child.y + child.height <= n.y + n.height)
            .map((child) => child.id)
        : []
    const origins = [...moveIds, ...extraInside]
      .map((id) => nodeById.get(id))
      .filter((x): x is CanvasNode => !!x)
      .map((x) => ({ id: x.id, x: x.x, y: x.y }))
    const pt = screenToCanvas(e.clientX, e.clientY)
    drag.current = { mode: "node", origins, startCanvas: pt, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onResizePointerDown = (e: React.PointerEvent, n: CanvasNode) => {
    e.stopPropagation()
    const pt = screenToCanvas(e.clientX, e.clientY)
    drag.current = { mode: "resize", id: n.id, startX: pt.x, startY: pt.y, w: n.width, h: n.height, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onConnectPointerDown = (e: React.PointerEvent, n: CanvasNode, side: CanvasNodeSide) => {
    e.stopPropagation()
    drag.current = { mode: "connect", fromId: n.id, fromSide: side, x: 0, y: 0 }
    setConnectPreview(screenToCanvas(e.clientX, e.clientY))
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const pushHistoryBeforeMutate = () => {
    undoStack.current.push(lastSerialized.current)
    if (undoStack.current.length > 60) undoStack.current.shift()
    redoStack.current = []
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const step = snapToGrid ? 20 : 1
    const snap = (v: number) => Math.round(v / step) * step
    if (d.mode === "pan") {
      setPan({ x: d.panX + (e.clientX - d.sx), y: d.panY + (e.clientY - d.sy) })
    } else if (d.mode === "node") {
      const pt = screenToCanvas(e.clientX, e.clientY)
      const dx = snap(pt.x - d.startCanvas.x)
      const dy = snap(pt.y - d.startCanvas.y)
      if (!d.moved && Math.abs(pt.x - d.startCanvas.x) < 2 && Math.abs(pt.y - d.startCanvas.y) < 2) return
      if (!d.moved) {
        d.moved = true
        pushHistoryBeforeMutate()
      }
      const originMap = new Map(d.origins.map((o) => [o.id, o]))
      setData((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          const orig = originMap.get(n.id)
          return orig ? { ...n, x: snap(orig.x + dx), y: snap(orig.y + dy) } : n
        }),
      }))
    } else if (d.mode === "resize") {
      const pt = screenToCanvas(e.clientX, e.clientY)
      const w = Math.max(140, snap(d.w + (pt.x - d.startX)))
      const h = Math.max(60, snap(d.h + (pt.y - d.startY)))
      if (!d.moved && w === d.w && h === d.h) return
      if (!d.moved) {
        d.moved = true
        pushHistoryBeforeMutate()
      }
      setData((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.id === d.id ? { ...n, width: w, height: h } : n)) }))
    } else if (d.mode === "connect") {
      setConnectPreview(screenToCanvas(e.clientX, e.clientY))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement
    if (target?.hasPointerCapture?.(e.pointerId)) target.releasePointerCapture(e.pointerId)
    const d = drag.current
    drag.current = null
    if (!d) return
    if ((d.mode === "node" || d.mode === "resize") && d.moved) {
      lastSerialized.current = serializeCanvas(dataRef.current)
      onChange(lastSerialized.current)
      forceRender((n) => n + 1)
    } else if (d.mode === "connect" && connectPreview) {
      const targetNode = [...dataRef.current.nodes]
        .reverse()
        .find((n) => connectPreview.x >= n.x && connectPreview.x <= n.x + n.width && connectPreview.y >= n.y && connectPreview.y <= n.y + n.height && n.id !== d.fromId)
      if (targetNode) {
        const toSide = nearestSide(targetNode, connectPreview.x, connectPreview.y)
        const edge: CanvasEdge = {
          id: newId(),
          fromNode: d.fromId,
          fromSide: d.fromSide,
          fromEnd: "none",
          toNode: targetNode.id,
          toSide,
          toEnd: "arrow",
        }
        commit({ nodes: dataRef.current.nodes, edges: [...dataRef.current.edges, edge] })
      }
      setConnectPreview(null)
    } else if (d.mode === "connect") {
      setConnectPreview(null)
    }
  }

  const fitView = () => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect || data.nodes.length === 0) {
      setPan({ x: 60, y: 40 })
      setZoom(1)
      return
    }
    const minX = Math.min(...data.nodes.map((n) => n.x))
    const minY = Math.min(...data.nodes.map((n) => n.y))
    const maxX = Math.max(...data.nodes.map((n) => n.x + n.width))
    const maxY = Math.max(...data.nodes.map((n) => n.y + n.height))
    const w = Math.max(1, maxX - minX)
    const h = Math.max(1, maxY - minY)
    const z = Math.max(0.2, Math.min(2, Math.min((rect.width - 120) / w, (rect.height - 120) / h)))
    setZoom(z)
    setPan({ x: (rect.width - w * z) / 2 - minX * z, y: (rect.height - h * z) / 2 - minY * z })
  }

  const edgePath = (e: CanvasEdge) => {
    const a = nodeById.get(e.fromNode)
    const b = nodeById.get(e.toNode)
    if (!a || !b) return null
    const p1 = sideAnchor(a, e.fromSide ?? "right")
    const p2 = sideAnchor(b, e.toSide ?? "left")
    const dx = Math.abs(p2.x - p1.x)
    const dy = Math.abs(p2.y - p1.y)
    const c = Math.max(40, Math.min(160, (dx + dy) / 3))
    let c1 = { x: p1.x, y: p1.y }
    let c2 = { x: p2.x, y: p2.y }
    if ((e.fromSide ?? "right") === "right") c1 = { x: p1.x + c, y: p1.y }
    if (e.fromSide === "left") c1 = { x: p1.x - c, y: p1.y }
    if (e.fromSide === "top") c1 = { x: p1.x, y: p1.y - c }
    if (e.fromSide === "bottom") c1 = { x: p1.x, y: p1.y + c }
    if (e.toSide === "right") c2 = { x: p2.x + c, y: p2.y }
    if ((e.toSide ?? "left") === "left") c2 = { x: p2.x - c, y: p2.y }
    if (e.toSide === "top") c2 = { x: p2.x, y: p2.y - c }
    if (e.toSide === "bottom") c2 = { x: p2.x, y: p2.y + c }
    return { path: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } }
  }

  const edgeColor = (e: CanvasEdge): string => {
    const c = e.color ? CANVAS_COLORS[e.color] : null
    return c ? `rgb(${c.rgb})` : "var(--text-faint)"
  }

  // Render groups behind other nodes (JSON Canvas 1.0 convention)
  const orderedNodes = [...data.nodes].sort((a, b) => (a.type === "group" ? 0 : 1) - (b.type === "group" ? 0 : 1))
  const menuNode = cardMenu ? nodeById.get(cardMenu.nodeId) ?? null : null
  const activeEditingEdge = editingEdgeId ? data.edges.find((e) => e.id === editingEdgeId) ?? null : null
  const activeEditingEdgeGeo = activeEditingEdge ? edgePath(activeEditingEdge) : null

  return (
    <div className="relative flex h-full flex-col select-none" style={{ background: "var(--background-primary)" }}>
      <div
        ref={wrapRef}
        tabIndex={0}
        className="obs-canvas-surface relative flex-1 overflow-hidden outline-none"
        style={{
          backgroundImage: "radial-gradient(circle, var(--canvas-dot) 1px, transparent 1px)",
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        onKeyDown={onSurfaceKeyDown}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList?.contains("obs-canvas-space")) {
            const pt = screenToCanvas(e.clientX, e.clientY)
            const node = addNode({ type: "text", text: "", x: pt.x - 130, y: pt.y - 30, width: 260, height: 120 })
            setEditingNodeId(node.id)
          }
        }}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList?.contains("obs-canvas-space")) {
            e.preventDefault()
            const pt = screenToCanvas(e.clientX, e.clientY)
            ctxPointRef.current = pt
            showMenuAt(e, [
              {
                label: "Add text",
                onClick: () => {
                  const at = ctxPointRef.current ?? pt
                  const node = addNode({ type: "text", text: "", x: at.x - 130, y: at.y - 30, width: 260, height: 120 })
                  setEditingNodeId(node.id)
                  ctxPointRef.current = null
                },
              },
              {
                label: "Add group",
                onClick: () => {
                  const at = ctxPointRef.current ?? pt
                  addNode({ type: "group", label: "Group", x: at.x - 210, y: at.y - 140, width: 420, height: 280 })
                  ctxPointRef.current = null
                },
              },
              {
                label: "Add note from vault…",
                onClick: () => {
                  ctxPointRef.current = pt
                  setAddNoteOpen(true)
                  setAddLinkOpen(false)
                  setAddNoteQuery("")
                },
              },
              {
                label: "Add web page…",
                onClick: () => {
                  ctxPointRef.current = pt
                  setAddLinkOpen(true)
                  setAddNoteOpen(false)
                  setAddLinkUrl("https://")
                },
              },
              { type: "separator" },
              {
                label: "Paste",
                disabled: !clipRef.current?.length,
                onClick: () => {
                  pasteNodes(ctxPointRef.current ?? pt)
                  ctxPointRef.current = null
                },
              },
            ])
          }
        }}
      >
        <div
          className="obs-canvas-space absolute left-0 top-0 h-0 w-0"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}
        >
          {/* edges */}
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" style={{ width: 1, height: 1 }}>
            <defs>
              <marker id="obs-canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-faint)" />
              </marker>
            </defs>
            {data.edges.map((e) => {
              const geo = edgePath(e)
              if (!geo) return null
              const sel = selectedEdgeId === e.id
              const startMarker = e.fromEnd === "arrow" ? "url(#obs-canvas-arrow)" : undefined
              const endMarker = e.toEnd === "none" ? undefined : "url(#obs-canvas-arrow)"
              const startEditEdge = (ev: React.MouseEvent) => {
                ev.stopPropagation()
                setEditingEdgeId(e.id)
                setEdgeLabelDraft(e.label ?? "")
              }
              const openEdgeMenu = (ev: React.MouseEvent) => {
                ev.preventDefault()
                ev.stopPropagation()
                setSelectedEdgeId(e.id)
                setSelectedNodeIds([])
                showMenuAt(ev, [
                  { label: "Edit label…", onClick: () => { setEditingEdgeId(e.id); setEdgeLabelDraft(e.label ?? "") } },
                  {
                    label: "Reverse direction",
                    onClick: () =>
                      commit({
                        nodes: data.nodes,
                        edges: data.edges.map((x) =>
                          x.id === e.id ? { ...x, fromNode: x.toNode, fromSide: x.toSide, fromEnd: x.toEnd, toNode: x.fromNode, toSide: x.fromSide, toEnd: x.fromEnd } : x,
                        ),
                      }),
                  },
                  {
                    label: e.toEnd === "none" ? "Show end arrow" : "Hide end arrow",
                    onClick: () =>
                      commit({
                        nodes: data.nodes,
                        edges: data.edges.map((x) => (x.id === e.id ? { ...x, toEnd: x.toEnd === "none" ? "arrow" : "none" } : x)),
                      }),
                  },
                  { type: "separator" },
                  {
                    label: "Delete edge",
                    danger: true,
                    onClick: () => {
                      commit({ nodes: data.nodes, edges: data.edges.filter((x) => x.id !== e.id) })
                      if (selectedEdgeId === e.id) setSelectedEdgeId(null)
                    },
                  },
                ])
              }
              return (
                <g key={e.id} className="pointer-events-auto" style={{ cursor: "pointer" }} onContextMenu={openEdgeMenu}>
                  <path
                    d={geo.path}
                    fill="none"
                    stroke={edgeColor(e)}
                    strokeWidth={sel ? 3 : 1.75}
                    opacity={sel ? 1 : 0.7}
                    markerStart={startMarker}
                    markerEnd={endMarker}
                    onPointerDown={(ev) => {
                      ev.stopPropagation()
                      setSelectedEdgeId(e.id)
                      setSelectedNodeIds([])
                    }}
                    onDoubleClick={startEditEdge}
                  />
                  <path
                    d={geo.path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    style={{ cursor: "pointer" }}
                    onPointerDown={(ev) => {
                      ev.stopPropagation()
                      setSelectedEdgeId(e.id)
                      setSelectedNodeIds([])
                    }}
                    onDoubleClick={startEditEdge}
                  />
                  {e.label && editingEdgeId !== e.id && (
                    <text x={geo.mid.x} y={geo.mid.y - 6} textAnchor="middle" style={{ pointerEvents: "none", fontSize: 12, fill: "var(--text-muted)" }}>
                      {e.label}
                    </text>
                  )}
                </g>
              )
            })}
            {drag.current?.mode === "connect" && connectPreview && (() => {
              const from = nodeById.get(drag.current.fromId)
              if (!from) return null
              const p1 = sideAnchor(from, drag.current.fromSide)
              return <path d={`M ${p1.x} ${p1.y} L ${connectPreview.x} ${connectPreview.y}`} stroke="var(--interactive-accent)" strokeWidth={2} fill="none" strokeDasharray="6 4" />
            })()}
          </svg>

          {/* nodes */}
          {orderedNodes.map((n) => (
            <CanvasCard
              key={n.id}
              node={n}
              selected={selectedSet.has(n.id)}
              editing={editingNodeId === n.id}
              vaultId={vaultId}
              onPointerDown={(e) => onNodePointerDown(e, n)}
              onResizeDown={(e) => onResizePointerDown(e, n)}
              onConnectDown={(e, side) => onConnectPointerDown(e, n, side)}
              onDoubleClick={() => {
                if (n.type === "text" || n.type === "group") setEditingNodeId(n.id)
              }}
              onOpenFile={(id) => openNote(id)}
              onCommitText={(text) => {
                setEditingNodeId(null)
                updateNode(n.id, n.type === "group" ? { label: text } : { text })
              }}
              onOpenMenu={(x, y) => setCardMenu({ nodeId: n.id, x, y })}
            />
          ))}
        </div>

        {/* Unscaled inline edge-label editor (works inside Electron without window.prompt) */}
        {activeEditingEdge && activeEditingEdgeGeo && (
          <input
            className="obs-input fixed z-30 !w-44 !py-1 !text-[0.8rem] shadow-md"
            style={{
              left: Math.max(8, (wrapRef.current?.getBoundingClientRect().left ?? 0) + pan.x + activeEditingEdgeGeo.mid.x * zoom - 88),
              top: Math.max(8, (wrapRef.current?.getBoundingClientRect().top ?? 0) + pan.y + activeEditingEdgeGeo.mid.y * zoom - 16),
            }}
            autoFocus
            placeholder="Edge label…"
            value={edgeLabelDraft}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setEdgeLabelDraft(e.target.value)}
            onBlur={() => {
              commit({
                nodes: data.nodes,
                edges: data.edges.map((x) => (x.id === activeEditingEdge.id ? { ...x, label: edgeLabelDraft || undefined } : x)),
              })
              setEditingEdgeId(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur()
              } else if (e.key === "Escape") {
                setEditingEdgeId(null)
              }
            }}
          />
        )}

        {/* add-note / image search popover */}
        {addNoteOpen && (
          <div className="obs-modal absolute bottom-16 left-1/2 -translate-x-1/2 z-30 w-[320px] p-2" onPointerDown={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center gap-1.5 px-1 text-[0.75rem] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
              <Search size={12} /> Add note card
            </div>
            <input
              className="obs-input !text-[0.85rem]"
              autoFocus
              placeholder="Search notes…"
              value={addNoteQuery}
              onChange={(e) => setAddNoteQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setAddNoteOpen(false); ctxPointRef.current = null }
                if (e.key === "Enter" && noteResults[0]) {
                  const entry = noteResults[0]
                  const rect = wrapRef.current?.getBoundingClientRect()
                  const base = ctxPointRef.current
                  const cx = base ? base.x - 140 : rect ? (rect.width / 2 - pan.x) / zoom - 140 : 0
                  const cy = base ? base.y - 100 : rect ? (rect.height / 2 - pan.y) / zoom - 100 : 0
                  addNode({ type: "file", file: entry.id, x: cx, y: cy, width: 280, height: 200 })
                  setAddNoteOpen(false)
                  setAddNoteQuery("")
                  ctxPointRef.current = null
                }
              }}
            />
            <div className="mt-1 max-h-56 overflow-y-auto">
              {noteResults.map((entry) => (
                <div
                  key={entry.id}
                  className="obs-tree-row !min-h-[28px] !text-[0.82rem]"
                  onClick={() => {
                    const rect = wrapRef.current?.getBoundingClientRect()
                    const base = ctxPointRef.current
                    const cx = base ? base.x - 140 : rect ? (rect.width / 2 - pan.x) / zoom - 140 : 0
                    const cy = base ? base.y - 100 : rect ? (rect.height / 2 - pan.y) / zoom - 100 : 0
                    addNode({ type: "file", file: entry.id, x: cx, y: cy, width: 280, height: 200 })
                    setAddNoteOpen(false)
                    setAddNoteQuery("")
                    ctxPointRef.current = null
                  }}
                >
                  <FileText size={12} className="shrink-0 opacity-60" />
                  <span className="truncate">{entry.name}</span>
                </div>
              ))}
              {imageResults.length > 0 && (
                <>
                  <div className="mt-1 px-1 text-[0.7rem] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
                    Images in vault
                  </div>
                  {imageResults.slice(0, 6).map((f) => (
                    <div
                      key={f.id}
                      className="obs-tree-row !min-h-[28px] !text-[0.82rem]"
                      onClick={() => {
                        const rect = wrapRef.current?.getBoundingClientRect()
                        const base = ctxPointRef.current
                        const cx = base ? base.x - 180 : rect ? (rect.width / 2 - pan.x) / zoom - 180 : 0
                        const cy = base ? base.y - 120 : rect ? (rect.height / 2 - pan.y) / zoom - 120 : 0
                        addNode({ type: "file", file: f.id, x: cx, y: cy, width: 360, height: 240 })
                        setAddNoteOpen(false)
                        ctxPointRef.current = null
                      }}
                    >
                      <ImageIcon size={12} className="shrink-0 opacity-60" />
                      <span className="truncate">{f.name}.{f.ext}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {/* add web page link popover */}
        {addLinkOpen && (
          <div className="obs-modal absolute bottom-16 left-1/2 -translate-x-1/2 z-30 w-[320px] p-2.5" onPointerDown={(e) => e.stopPropagation()}>
            <div className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[0.75rem] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
              <Globe size={12} /> Add web page
            </div>
            <input
              className="obs-input !text-[0.85rem]"
              autoFocus
              placeholder="https://example.com"
              value={addLinkUrl}
              onChange={(e) => setAddLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setAddLinkOpen(false); ctxPointRef.current = null }
                if (e.key === "Enter" && /^https?:\/\//i.test(addLinkUrl.trim())) {
                  const rect = wrapRef.current?.getBoundingClientRect()
                  const base = ctxPointRef.current
                  const cx = base ? base.x - 150 : rect ? (rect.width / 2 - pan.x) / zoom - 150 : 0
                  const cy = base ? base.y - 70 : rect ? (rect.height / 2 - pan.y) / zoom - 70 : 0
                  addNode({ type: "link", url: addLinkUrl.trim(), x: cx, y: cy, width: 300, height: 140 })
                  setAddLinkOpen(false)
                  setAddLinkUrl("")
                  ctxPointRef.current = null
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Unscaled portal card options menu (immune to canvas zoom & clipping) */}
      {menuNode && cardMenu && typeof document !== "undefined" && createPortal(
        <div className="obs-canvas-card-menu">
          <div
            className="fixed inset-0 z-[240]"
            onClick={(e) => { e.stopPropagation(); setCardMenu(null) }}
            onContextMenu={(e) => { e.preventDefault(); setCardMenu(null) }}
          />
          <div
            className="obs-modal fixed z-[250] w-44 p-1.5 obs-anim-in"
            style={{
              left: Math.max(8, Math.min(cardMenu.x, window.innerWidth - 184)),
              top: Math.max(8, Math.min(cardMenu.y, window.innerHeight - 132)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 px-1 text-[0.68rem] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
              Color
            </div>
            <div className="mb-1.5 flex gap-1.5 px-1">
              {["", "1", "2", "3", "4", "5", "6"].map((c) => (
                <button
                  key={c || "none"}
                  className="h-4 w-4 rounded-full border"
                  title={c ? CANVAS_COLORS[c].label : "None"}
                  style={{
                    background: c ? `rgb(${CANVAS_COLORS[c].rgb})` : "transparent",
                    borderColor: "var(--background-modifier-border)",
                    outline: menuNode.color === c || (!menuNode.color && c === "") ? "2px solid var(--text-normal)" : "none",
                    outlineOffset: 1,
                  }}
                  onClick={() => {
                    setCardMenu(null)
                    updateNode(menuNode.id, { color: c === menuNode.color || !c ? undefined : c })
                  }}
                />
              ))}
            </div>
            {(menuNode.type === "text" || menuNode.type === "group") && (
              <button
                className="obs-tree-row w-full !text-[0.8rem]"
                onClick={() => {
                  setCardMenu(null)
                  setEditingNodeId(menuNode.id)
                }}
              >
                {menuNode.type === "group" ? "Rename group" : "Edit card"}
              </button>
            )}
            <button
              className="obs-tree-row w-full !text-[0.8rem]"
              style={{ color: "var(--text-error)" }}
              onClick={() => {
                setCardMenu(null)
                commit({
                  nodes: data.nodes.filter((x) => x.id !== menuNode.id),
                  edges: data.edges.filter((e) => e.fromNode !== menuNode.id && e.toNode !== menuNode.id),
                })
                setSelectedNodeIds((ids) => ids.filter((id) => id !== menuNode.id))
              }}
            >
              Delete card
            </button>
          </div>
        </div>,
        document.body,
      )}

      {/* bottom-center creation dock (matches obsidian Canvas) */}
      <div
        className="obs-canvas-controls absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-lg border p-1 shadow-md"
        style={{ background: "var(--background-secondary)", borderColor: "var(--background-modifier-border)" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          className="obs-icon-btn !h-8 !w-8"
          title="Add card"
          onClick={() => {
            const rect = wrapRef.current?.getBoundingClientRect()
            const cx = rect ? (rect.width / 2 - pan.x) / zoom - 130 : 0
            const cy = rect ? (rect.height / 2 - pan.y) / zoom - 60 : 0
            const node = addNode({ type: "text", text: "", x: cx, y: cy })
            setEditingNodeId(node.id)
          }}
        >
          <StickyNote size={16} />
        </button>
        <button
          className="obs-icon-btn !h-8 !w-8"
          title="Add note from vault"
          onClick={() => { setAddNoteOpen(!addNoteOpen); setAddLinkOpen(false) }}
        >
          <FileText size={16} />
        </button>
        <button
          className="obs-icon-btn !h-8 !w-8"
          title="Add web page"
          onClick={() => { setAddLinkOpen(!addLinkOpen); setAddNoteOpen(false); setAddLinkUrl("https://") }}
        >
          <Globe size={16} />
        </button>
        <button
          className="obs-icon-btn !h-8 !w-8"
          title="Add group"
          onClick={() => {
            const rect = wrapRef.current?.getBoundingClientRect()
            const cx = rect ? (rect.width / 2 - pan.x) / zoom - 210 : 0
            const cy = rect ? (rect.height / 2 - pan.y) / zoom - 140 : 0
            addNode({ type: "group", label: "Group", x: cx, y: cy, width: 420, height: 280 })
          }}
        >
          <SquareDashed size={16} />
        </button>
        <button
          className="obs-icon-btn !h-8 !w-8"
          title={snapToGrid ? "Snap to grid (on)" : "Snap to grid (off)"}
          style={snapToGrid ? { color: "var(--interactive-accent)", background: "var(--background-modifier-active-hover)" } : undefined}
          onClick={() => setSnapToGrid(!snapToGrid)}
        >
          <Grid size={15} />
        </button>
      </div>

      {/* top-right vertical control stacks (Zoom, Undo/Redo, Help — matches obsidian Canvas) */}
      <div className="absolute right-3 top-3 z-20 flex flex-col items-end gap-2" onPointerDown={(e) => e.stopPropagation()}>
        <div
          className="obs-canvas-controls flex flex-col items-center gap-0.5 rounded-lg border p-1 shadow-sm"
          style={{ background: "var(--background-secondary)", borderColor: "var(--background-modifier-border)" }}
        >
          <button className="obs-icon-btn !h-7 !w-7" title="Zoom in" onClick={() => setZoom((z) => Math.min(3, z * 1.2))}>
            <Plus size={14} />
          </button>
          <button
            className="obs-icon-btn !h-7 !w-7"
            title={`Reset zoom (${Math.round(zoom * 100)}%)`}
            onClick={() => setZoom(1)}
          >
            <RotateCcw size={13} />
          </button>
          <button className="obs-icon-btn !h-7 !w-7" title="Zoom to fit" onClick={fitView}>
            <Maximize2 size={14} />
          </button>
          <button className="obs-icon-btn !h-7 !w-7" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.2, z / 1.2))}>
            <Minus size={14} />
          </button>
        </div>

        <div
          className="obs-canvas-controls flex flex-col items-center gap-0.5 rounded-lg border p-1 shadow-sm"
          style={{ background: "var(--background-secondary)", borderColor: "var(--background-modifier-border)" }}
        >
          <button className="obs-icon-btn !h-7 !w-7" title="Undo (Ctrl+Z)" onClick={undo} disabled={undoStack.current.length === 0}>
            <Undo2 size={14} />
          </button>
          <button className="obs-icon-btn !h-7 !w-7" title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={redoStack.current.length === 0}>
            <Redo2 size={14} />
          </button>
        </div>

        <div className="relative">
          <button
            className="obs-icon-btn !h-7 !w-7 rounded-lg border shadow-sm"
            style={{ background: "var(--background-secondary)", borderColor: "var(--background-modifier-border)" }}
            title="Canvas controls"
            onClick={() => setHelpOpen(!helpOpen)}
          >
            <HelpCircle size={14} />
          </button>
          {helpOpen && (
            <div className="obs-modal absolute right-0 top-9 w-56 p-2.5 text-[0.76rem]" style={{ color: "var(--text-muted)" }}>
              <div className="font-semibold mb-1" style={{ color: "var(--text-normal)" }}>Canvas ({data.nodes.length} cards)</div>
              <div>Double-click background to add card</div>
              <div>Shift+click to multi-select cards</div>
              <div>Drag card edge dots to connect</div>
              <div>Scroll to pan · Ctrl+scroll to zoom</div>
              <div>Delete or Backspace removes selection</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

// ─── One canvas card ─────────────────────────────────────────────────────────

const CanvasCard = memo(function CanvasCard({
  node,
  selected,
  editing,
  vaultId,
  onPointerDown,
  onResizeDown,
  onConnectDown,
  onDoubleClick,
  onOpenFile,
  onCommitText,
  onOpenMenu,
}: {
  node: CanvasNode
  selected: boolean
  editing: boolean
  vaultId: string | null
  onPointerDown: (e: React.PointerEvent) => void
  onResizeDown: (e: React.PointerEvent) => void
  onConnectDown: (e: React.PointerEvent, side: CanvasNodeSide) => void
  onDoubleClick: () => void
  onOpenFile: (noteId: string) => void
  onCommitText: (text: string) => void
  onOpenMenu: (x: number, y: number) => void
}) {
  const isImageFile =
    node.type === "file" && IMAGE_EXTS.has(node.file?.includes(".") ? node.file.slice(node.file.lastIndexOf(".") + 1).toLowerCase() : "")
  const noteId = node.type === "file" && !isImageFile ? node.file?.replace(/\.md$/i, "") : null
  const imgUrl = node.type === "file" && isImageFile && vaultId && node.file ? api.attachmentUrl(vaultId, node.file) : null
  const isGroup = node.type === "group"

  return (
    <div
      className={`obs-canvas-card ${isGroup ? "is-group" : ""} ${selected ? "is-selected" : ""} group`}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        zIndex: isGroup ? 0 : 1,
        ...(isGroup
          ? {
              background: "color-mix(in srgb, var(--background-secondary) 38%, transparent)",
              borderStyle: "dashed",
            }
          : {}),
        ...colorStyleOf(node),
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onDoubleClick()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onOpenMenu(e.clientX, e.clientY)
      }}
    >
      {/* connection dots (4 sides) */}
      {(["top", "right", "bottom", "left"] as CanvasNodeSide[]).map((side) => (
        <div
          key={side}
          className="obs-canvas-dot"
          style={dotStyle(side)}
          onPointerDown={(e) => {
            e.stopPropagation()
            onConnectDown(e, side)
          }}
        />
      ))}

      {isGroup && (
        <div className="px-2.5 pt-1.5 text-[0.8rem] font-semibold" style={{ color: "var(--text-muted)" }}>
          {editing ? (
            <input
              className="obs-input !py-0.5 !text-[0.8rem]"
              autoFocus
              defaultValue={node.label ?? ""}
              onBlur={(e) => onCommitText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                  e.preventDefault()
                  onCommitText((e.currentTarget as HTMLInputElement).value)
                }
              }}
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : (
            <span>{node.label || "Group"}</span>
          )}
        </div>
      )}

      {node.type === "text" &&
        (editing ? (
          <textarea
            className="obs-canvas-card-edit"
            autoFocus
            defaultValue={node.text ?? ""}
            onBlur={(e) => onCommitText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
                e.preventDefault()
                onCommitText((e.currentTarget as HTMLTextAreaElement).value)
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="obs-canvas-card-body">
            <CardMarkdown text={node.text ?? ""} />
          </div>
        ))}

      {node.type === "link" && (
        <div className="obs-canvas-card-body flex flex-col justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[0.78rem] font-medium" style={{ color: "var(--text-muted)" }}>
            <Globe size={13} className="shrink-0 opacity-70" />
            <span className="truncate">Web page</span>
          </div>
          <a
            href={node.url}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-[0.84rem] underline"
            style={{ color: "var(--text-accent)" }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {node.url}
          </a>
        </div>
      )}

      {node.type === "file" && isImageFile && imgUrl && (
        <img
          src={imgUrl}
          alt={node.file ?? ""}
          className="obs-canvas-card-img"
          draggable={false}
          onPointerDown={(e) => e.stopPropagation()}
        />
      )}

      {node.type === "file" && !isImageFile && (
        <FileCardBody noteId={noteId ?? null} fileRef={node.file ?? ""} onOpen={() => noteId && onOpenFile(noteId + (noteId.endsWith(".md") ? "" : ".md"))} />
      )}

      {/* card menu trigger */}
      <div className="obs-canvas-card-menu">
        <button
          className="obs-icon-btn !h-5 !w-5"
          title="Card options"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            onOpenMenu(r.left, r.bottom + 4)
          }}
        >
          ⋯
        </button>
      </div>

      {/* resize handle */}
      <div className="obs-canvas-resize" onPointerDown={onResizeDown} />
    </div>
  )
})

/** Small markdown renderer for card bodies. */
const CardMarkdown = memo(function CardMarkdown({ text }: { text: string }) {
  const { data: index } = useQuery({
    queryKey: ["index", useWorkspace((s) => s.vaultId)],
    queryFn: () => api.index(useWorkspace.getState().vaultId!),
    enabled: !!useWorkspace((s) => s.vaultId),
    staleTime: 10_000,
  })
  const attachOpts = useAttachmentRenderOpts()
  const result = useMemo(() => (text.trim() ? renderMarkdown(text, { index: index ?? [], ...attachOpts }) : null), [text, index, attachOpts])
  if (!text.trim()) return <span className="text-[0.78rem]" style={{ color: "var(--text-faint)" }}>Empty card — double-click to edit</span>
  return <MarkdownBody result={result ?? { segments: [], headings: [], taskCount: 0 }} index={index ?? []} />
})

/** File card: note title bar + rendered preview. */
const FileCardBody = memo(function FileCardBody({ noteId, fileRef, onOpen }: { noteId: string | null; fileRef: string; onOpen: () => void }) {
  const fullId = noteId ? (noteId.endsWith(".md") ? noteId : noteId + ".md") : null
  const { data: note } = useQuery({
    queryKey: ["note", fullId],
    queryFn: () => api.note(fullId!),
    enabled: !!fullId,
    staleTime: 5_000,
  })
  const { data: index } = useQuery({
    queryKey: ["index", useWorkspace((s) => s.vaultId)],
    queryFn: () => api.index(useWorkspace.getState().vaultId!),
    enabled: !!useWorkspace((s) => s.vaultId),
    staleTime: 10_000,
  })
  const attachOpts = useAttachmentRenderOpts()
  const content = note?.content ?? ""
  const result = useMemo(() => (content.trim() ? renderMarkdown(content.slice(0, 600), { index: index ?? [], ...attachOpts }) : null), [content, index, attachOpts])

  if (!noteId) {
    return (
      <div className="obs-canvas-card-body text-[0.8rem]" style={{ color: "var(--text-faint)" }}>
        {fileRef || "Empty file reference"}
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col">
      <button
        className="obs-canvas-card-title"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
        title="Double-click to open the note"
      >
        <FileText size={11} className="shrink-0" />
        <span className="truncate">{note?.name ?? fileRef}</span>
      </button>
      <div className="obs-canvas-card-body obs-canvas-card-preview">
        {result ? <MarkdownBody result={result} index={index ?? []} /> : <span style={{ color: "var(--text-faint)" }}>Loading…</span>}
      </div>
    </div>
  )
})

function colorStyleOf(n: CanvasNode): React.CSSProperties {
  const c = n.color ? CANVAS_COLORS[n.color] : null
  if (!c) return {}
  return { borderColor: `rgba(${c.rgb}, 0.75)`, ["--canvas-color" as string]: `rgb(${c.rgb})` }
}

function dotStyle(side: CanvasNodeSide): React.CSSProperties {
  switch (side) {
    case "top":
      return { left: "50%", top: -5, transform: "translateX(-50%)" }
    case "bottom":
      return { left: "50%", bottom: -5, transform: "translateX(-50%)" }
    case "left":
      return { left: -5, top: "50%", transform: "translateY(-50%)" }
    case "right":
      return { right: -5, top: "50%", transform: "translateY(-50%)" }
  }
}

void useUi
void toast
