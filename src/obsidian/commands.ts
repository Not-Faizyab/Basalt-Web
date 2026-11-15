"use client"

// ─── Command registry + daily notes + templates + new core plugins ──────────
import { format, addDays, subDays } from "date-fns"
import { api } from "./api"
import { collectPanes, useWorkspace, type LeftTab } from "./stores/workspace"
import { useUi } from "./stores/ui"
import { useDocs } from "./stores/docs"
import { effectiveHotkey, prettyCombo } from "@/lib/obsidian/settings"
import { renderMarkdown } from "@/lib/obsidian/markdown"
import type { TreeData } from "@/lib/obsidian/types"
import { toast } from "sonner"

export interface Command {
  id: string
  name: string
  section?: string
  hotkey?: string
  icon?: React.ReactNode
  run: () => void | Promise<void>
}

/** Normalize Moment.js-style tokens (obsidian's docs) to date-fns tokens. */
function nf(f: string): string {
  return f.replace(/YYYY/g, "yyyy").replace(/DDDD/g, "DDD").replace(/DD/g, "dd").replace(/dddd/g, "EEEE").replace(/ddd/g, "EEE")
}

function invalidate(kinds: string[], noteId?: string) {
  const vaultId = useWorkspace.getState().vaultId
  window.dispatchEvent(new CustomEvent("obs-invalidate", { detail: { vaultId, noteId, kinds } }))
}

function flushActiveDraft() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("obs-flush-active-draft"))
  }
}

async function resolveFolderByPath(vaultId: string, tree: TreeData, rawPath: string, createMissing: boolean): Promise<string | null> {
  const parts = rawPath
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  // Fast exact path match on desktop path-based folder IDs or top-level name
  const joined = parts.join("/")
  const exact = tree.folders.find((f) => f.id === joined || (parts.length === 1 && f.name.toLowerCase() === parts[0].toLowerCase()))
  if (exact) return exact.id

  let parentId: string | null = null
  const folders = [...tree.folders]
  for (const part of parts) {
    let hit = folders.find((f) => (f.parentId ?? null) === parentId && f.name.toLowerCase() === part.toLowerCase())
    if (!hit) {
      if (!createMissing) return null
      hit = await api.createFolder(vaultId, part, parentId)
      folders.push(hit)
      invalidate(["tree"])
    }
    parentId = hit.id
  }
  return parentId
}

export async function resolveNewNoteFolderId(folderIdOverride?: string | null): Promise<string | null> {
  if (folderIdOverride !== undefined) return folderIdOverride
  const ws = useWorkspace.getState()
  if (!ws.vaultId || ws.settings.files.newNoteLocation !== "currentFolder") return null
  const active = ws.getActiveTab()
  if (!active?.noteId) return null
  const tree = await api.tree(ws.vaultId)
  const note = tree.notes.find((n) => n.id === active.noteId)
  return note?.folderId ?? null
}

// ─── Daily notes ─────────────────────────────────────────────────────────────

export async function openDailyNote(offsetDays = 0): Promise<void> {
  const ws = useWorkspace.getState()
  if (!ws.vaultId) return
  const { folder, format: fmt, template } = ws.settings.dailyNotes
  const date = addDays(new Date(), offsetDays)
  const title = format(date, nf(fmt))

  // find (or create) folder, supporting nested paths like "Journal/Daily"
  const tree = await api.tree(ws.vaultId)
  const cleanTpl = template.trim().replace(/\.md$/i, "")
  const tplEntry = template.trim()
    ? tree.notes.find((n) => n.id === template.trim() || n.name === cleanTpl)
    : undefined
  const [folderId, tpl] = await Promise.all([
    folder.trim() ? resolveFolderByPath(ws.vaultId, tree, folder, true) : Promise.resolve(null),
    tplEntry ? api.note(tplEntry.id) : Promise.resolve(null),
  ])
  const existing = tree.notes.find((n) => n.name === title && (n.folderId ?? null) === folderId)

  if (existing) {
    ws.openNote(existing.id)
    return
  }

  // apply template
  let content = ""
  if (tpl) {
    const prevTitle = format(subDays(date, 1), nf(fmt))
    const nextTitle = format(addDays(date, 1), nf(fmt))
    const activeName = tree.notes.find((n) => n.id === ws.getActiveTab()?.noteId)?.name ?? title
    content = tpl.content
      .replace(/\{\{title\}\}/g, title)
      .replace(/\{\{date(?::([^}\s]+))?\}\}/g, (_m, f) => format(date, nf(f || fmt)))
      .replace(/\{\{time(?::([^}\s]+))?\}\}/g, (_m, f) => format(new Date(), nf(f || "HH:mm")))
      .replace(/\{\{prev_daily\}\}/g, prevTitle)
      .replace(/\{\{yesterday\}\}/g, prevTitle)
      .replace(/\{\{next_daily\}\}/g, nextTitle)
      .replace(/\{\{tomorrow\}\}/g, nextTitle)
      .replace(/\{\{current_note\}\}/g, activeName)
  }

  const note = await api.createNote(ws.vaultId, title, folderId, content)
  useDocs.getState().primeDoc(note.id, note.content ?? "")
  invalidate(["tree", "index", "graph", "tags"])
  useWorkspace.getState().openNote(note.id)
}

// ─── Templates ───────────────────────────────────────────────────────────────

export async function insertTemplate(templateName: string): Promise<void> {
  flushActiveDraft()
  const ws = useWorkspace.getState()
  if (!ws.vaultId) return
  const activeTab = ws.getActiveTab()
  const isCanvas = !!activeTab?.noteId && (/\.canvas$/i.test(activeTab.noteId) || ws.linkIndex.some((e) => e.id === activeTab.noteId && e.name.endsWith(".canvas")))
  if (!activeTab?.noteId || isCanvas) {
    return
  }
  const tree = await api.tree(ws.vaultId)
  const cleanTpl = templateName.trim().replace(/\.md$/i, "")
  const tplEntry = tree.notes.find((n) => n.id === templateName || n.name === cleanTpl)
  if (!tplEntry) return
  const tpl = await api.note(tplEntry.id)

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("obs-flush-active-draft"))
  }
  const docs = useDocs.getState()
  if (!docs.docs[activeTab.noteId]) {
    await docs.load(activeTab.noteId)
  }
  const doc = useDocs.getState().docs[activeTab.noteId]
  const currentName = tree.notes.find((n) => n.id === activeTab.noteId)?.name ?? ""
  const rendered = tpl.content
    .replace(/\{\{title\}\}/g, currentName)
    .replace(/\{\{date(?::([^}\s]+))?\}\}/g, (_m, f) => format(new Date(), nf(f || "yyyy-MM-dd")))
    .replace(/\{\{time(?::([^}\s]+))?\}\}/g, (_m, f) => format(new Date(), nf(f || "HH:mm")))

  const existing = doc?.content ?? ""
  const next = existing.trimEnd() + (existing.trim() === "" ? "" : "\n\n") + rendered.trimEnd() + "\n"
  useDocs.getState().setDoc(activeTab.noteId, next)
  await useDocs.getState().flush(activeTab.noteId)
  invalidate(["index", "graph", "backlinks", "tags"], activeTab.noteId)
}

export async function listTemplates(): Promise<{ id: string; name: string }[]> {
  const ws = useWorkspace.getState()
  if (!ws.vaultId) return []
  const tree = await api.tree(ws.vaultId)
  const tplFolderId = ws.settings.templates.folder.trim()
    ? await resolveFolderByPath(ws.vaultId, tree, ws.settings.templates.folder, false)
    : null
  return tree.notes
    .filter((n) => !/\.canvas$/i.test(n.id) && !n.name.endsWith(".canvas") && (tplFolderId ? n.folderId === tplFolderId : true))
    .map((n) => ({ id: n.id, name: n.name }))
}

// ─── Canvas ──────────────────────────────────────────────────────────────────

/** Create a new .canvas file (respecting the new-note location setting).
 *  `folderIdOverride` — undefined: use the setting; null: vault root; string: that folder. */
export async function createNewCanvas(folderIdOverride?: string | null): Promise<void> {
  const ws = useWorkspace.getState()
  if (!ws.vaultId) return
  const folderId = await resolveNewNoteFolderId(folderIdOverride)
  try {
    const canvas = await api.createCanvas(ws.vaultId, "Untitled canvas", folderId)
    useDocs.getState().primeDoc(canvas.id, canvas.content ?? "")
    useWorkspace.setState((s) => ({
      linkIndex: [...s.linkIndex.filter((e) => e.id !== canvas.id), { id: canvas.id, name: canvas.name, path: canvas.path, aliases: [], tags: [] }],
    }))
    invalidate(["tree", "index", "graph"])
    useWorkspace.getState().openNote(canvas.id)
  } catch (err) {
    toast(String((err as Error).message ?? err))
  }
}

// ─── Note composer: merge ───────────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** obsidian's "Merge current note with another note": append the source note
 *  to the target, rewrite [[source]] links across the vault to point at the
 *  target, then move the source to trash. Fully local. */
export async function mergeNoteInto(sourceId: string, targetId: string): Promise<void> {
  const ws = useWorkspace.getState()
  if (!ws.vaultId || sourceId === targetId) return
  try {
    flushActiveDraft()
    await useDocs.getState().flushAll()
    const [source, target] = await Promise.all([api.note(sourceId), api.note(targetId)])
    const separator = target.content.trim() && source.content.trim() ? "\n\n" : ""
    const merged = target.content.replace(/\s+$/, "") + separator + source.content
    await api.patchNote(targetId, { content: merged })

    // rewrite links to the source → target across every note that mentions it
    const sourceNoExt = source.path.replace(/\.md$/i, "")
    const linkRe = new RegExp(`(\\!?\\[\\[)(?:${escapeRegExp(sourceNoExt)}|${escapeRegExp(source.name)})(\\.md)?(\\]\\]|\\||#)`, "gi")
    const results = await api.search(ws.vaultId, source.name, false)
    const noteIds = [...new Set(results.hits.map((h) => h.noteId))].filter((id) => id !== sourceId && id !== targetId)
    for (const id of noteIds) {
      const n = await api.note(id)
      const rewritten = n.content.replace(linkRe, (_m, open: string, _ext: string | undefined, close: string) => `${open}${target.name}${close}`)
      if (rewritten !== n.content) {
        await api.patchNote(id, { content: rewritten })
      }
    }

    await api.deleteNote(sourceId)
    useDocs.getState().dropDoc(sourceId)
    await useDocs.getState().reload(targetId)
    useWorkspace.getState().closeTabsForNote(sourceId)
    invalidate(["tree", "index", "graph", "backlinks", "search", "bookmarks", "tags"], targetId)
    useWorkspace.getState().openNote(targetId)
    toast(`Merged "${source.name}" into "${target.name}"`)
  } catch (err) {
    toast(String((err as Error).message ?? err))
  }
}

// ─── Export to PDF ──────────────────────────────────────────────────────────

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: "Inter", "Segoe UI", -apple-system, sans-serif; color: #23252a; font-size: 11pt; line-height: 1.6; margin: 0; }
  .pdf-doc { max-width: 100%; }
  .pdf-title { font-size: 22pt; font-weight: 700; margin: 0 0 12pt; border: none; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 18pt 0 6pt; page-break-after: avoid; }
  h1 { font-size: 17pt; } h2 { font-size: 15pt; } h3 { font-size: 13pt; }
  h4 { font-size: 12pt; } h5 { font-size: 11pt; } h6 { font-size: 10pt; color: #555; }
  p { margin: 0 0 8pt; }
  ul, ol { margin: 4pt 0 8pt; padding-left: 20pt; }
  li { margin: 2pt 0; }
  a { color: #7c4dff; text-decoration: none; }
  code { font-family: Consolas, "Courier New", monospace; font-size: 9.5pt; background: #f2f2f4; padding: 1pt 3pt; border-radius: 3pt; }
  pre { font-family: Consolas, "Courier New", monospace; font-size: 9.5pt; background: #f5f5f7; border: 1pt solid #e3e3e8; border-radius: 4pt; padding: 8pt 10pt; overflow: hidden; white-space: pre-wrap; page-break-inside: avoid; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 8pt 0; padding: 2pt 0 2pt 12pt; border-left: 3pt solid #7c4dff; color: #444; }
  .obs-callout { margin: 8pt 0; padding: 8pt 12pt; border-left: 3pt solid #7c4dff; background: #f6f4ff; border-radius: 0 4pt 4pt 0; page-break-inside: avoid; }
  .obs-callout-title { font-weight: 600; margin-bottom: 4pt; }
  table { border-collapse: collapse; margin: 8pt 0; width: 100%; page-break-inside: avoid; }
  th, td { border: 0.75pt solid #c8c8ce; padding: 4pt 7pt; text-align: left; }
  th { background: #f2f2f5; font-weight: 600; }
  hr { border: none; border-top: 0.75pt solid #c8c8ce; margin: 14pt 0; }
  img { max-width: 100%; page-break-inside: avoid; }
  input[type="checkbox"] { margin-right: 4pt; }
  .obs-embed { margin: 8pt 0; padding: 6pt 10pt; border: 0.75pt solid #d8d8de; border-radius: 4pt; page-break-inside: avoid; }
  mark { background: #fff3a0; padding: 0 2pt; }
  .footnotes { font-size: 9.5pt; color: #555; }
`

async function buildPrintableHtml(title: string, content: string): Promise<string> {
  const ws = useWorkspace.getState()
  const tree = await api.tree(ws.vaultId!)
  const result = renderMarkdown(content, {
    index: ws.linkIndex,
    files: tree.files ?? [],
    resolveAttachmentUrl: (f) => api.attachmentUrl(ws.vaultId!, f.id),
  })
  let body = ""
  for (const seg of result.segments) if (seg.kind === "html") body += seg.html
  // inline every image as a data URI so the PDF is fully self-contained
  const srcs = new Set([...body.matchAll(/src="([^"]+)"/g)].map((m) => m[1]))
  for (const src of srcs) {
    try {
      const res = await fetch(src)
      if (!res.ok) continue
      const blob = await res.blob()
      const dataUri = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = reject
        r.readAsDataURL(blob)
      })
      body = body.split(src).join(dataUri)
    } catch {
      /* leave the original src */
    }
  }
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body><div class="pdf-doc"><h1 class="pdf-title">${esc(title)}</h1>${body}</div></body></html>`
}

/** obsidian's "Export to PDF" — desktop: rendered with the app's own markdown
 *  engine and saved into <vault>/Exports (then revealed); web: the browser's
 *  print dialog (Save as PDF). No network involved. */
export async function exportNoteToPdf(noteId: string): Promise<void> {
  const ws = useWorkspace.getState()
  if (!ws.vaultId) return
  try {
    flushActiveDraft()
    await useDocs.getState().flushAll() // flush pending autosaves first
    const note = await api.note(noteId)
    const html = await buildPrintableHtml(note.name, note.content)
    const desktop = (window as unknown as { desktop?: { exportPdf?: (v: string, f: string, h: string) => Promise<string> } }).desktop
    if (desktop?.exportPdf) {
      const saved = await desktop.exportPdf(ws.vaultId, note.name, html)
      if (saved && saved !== "canceled") toast(`Exported to ${saved}`)
    } else {
      const w = window.open("", "_blank")
      if (!w) {
        toast("Allow pop-ups to export to PDF")
        return
      }
      w.document.write(html)
      w.document.close()
      w.addEventListener("load", () => setTimeout(() => w.print(), 250))
    }
  } catch (err) {
    toast(String((err as Error).message ?? err))
  }
}

// ─── Zettelkasten / unique notes / random note ──────────────────────────────

/** Zettelkasten prefixer: new note named by a timestamp UID (e.g. 202601111432). */
export async function createZettelkastenNote(): Promise<void> {
  const ws = useWorkspace.getState()
  if (!ws.vaultId) return
  const uid = format(new Date(), nf(ws.settings.zettelkasten.format))
  let content = ""
  const template = ws.settings.zettelkasten.template.trim()
  if (template) {
    const tree = await api.tree(ws.vaultId)
    const tplEntry = tree.notes.find((n) => n.name === template)
    if (tplEntry) {
      const tpl = await api.note(tplEntry.id)
      content = tpl.content
        .replace(/\{\{title\}\}/g, uid)
        .replace(/\{\{date(?::([^}\s]+))?\}\}/g, (_m, f) => format(new Date(), nf(f || "yyyy-MM-dd")))
        .replace(/\{\{time(?::([^}\s]+))?\}\}/g, (_m, f) => format(new Date(), nf(f || "HH:mm")))
    }
  }
  const note = await api.createNote(ws.vaultId, uid, null, content)
  useDocs.getState().primeDoc(note.id, note.content ?? "")
  invalidate(["tree", "index", "graph", "tags"])
  useWorkspace.getState().openNote(note.id)
}

/** Unique note creator: "Untitled " + random 4-char suffix. */
export async function createUniqueNote(): Promise<void> {
  const ws = useWorkspace.getState()
  if (!ws.vaultId) return
  const suffix = Math.random().toString(36).slice(2, 6)
  const note = await api.createNote(ws.vaultId, `Untitled ${suffix}`, null, "")
  useDocs.getState().primeDoc(note.id, note.content ?? "")
  invalidate(["tree", "index", "graph", "tags"])
  useWorkspace.getState().openNote(note.id)
}

/** Random note: open a random note from the vault. */
export function openRandomNote(): void {
  const ws = useWorkspace.getState()
  const pool = ws.linkIndex.filter((e) => !e.id.endsWith(".canvas") && !e.name.endsWith(".canvas"))
  if (pool.length === 0) return
  const pick = pool[Math.floor(Math.random() * pool.length)]
  ws.openNote(pick.id)
}

// ─── Workspaces (save/load named layouts, per vault) ────────────────────────

interface SavedWorkspace {
  root: unknown
  activePaneId: string
  leftWidth: number
  rightWidth: number
  leftTab: LeftTab
  rightTab: string
  leftOpen: boolean
  rightOpen: boolean
}

function workspacesKey(): string | null {
  const vaultId = useWorkspace.getState().vaultId
  return vaultId ? `obs-workspaces-${vaultId}` : null
}

export function listWorkspaces(): string[] {
  const key = workspacesKey()
  if (!key) return []
  try {
    return Object.keys(JSON.parse(localStorage.getItem(key) ?? "{}"))
  } catch {
    return []
  }
}

export function saveWorkspace(name: string): void {
  const key = workspacesKey()
  if (!key || !name.trim()) return
  const ws = useWorkspace.getState()
  const entry: SavedWorkspace = {
    root: ws.root,
    activePaneId: ws.activePaneId,
    leftWidth: ws.leftSidebar.width,
    rightWidth: ws.rightSidebar.width,
    leftTab: ws.leftSidebar.tab,
    rightTab: ws.rightSidebar.tab,
    leftOpen: ws.leftSidebar.open,
    rightOpen: ws.rightSidebar.open,
  }
  try {
    const all = JSON.parse(localStorage.getItem(key) ?? "{}")
    all[name.trim()] = entry
    localStorage.setItem(key, JSON.stringify(all))
  } catch {
    /* storage full */
  }
}

export function loadWorkspace(name: string): boolean {
  const key = workspacesKey()
  if (!key) return false
  try {
    const all = JSON.parse(localStorage.getItem(key) ?? "{}")
    const entry = all[name] as SavedWorkspace | undefined
    if (!entry || !entry.root || typeof entry.root !== "object") return false
    const panes = collectPanes(entry.root as never)
    if (panes.length === 0) return false
    flushActiveDraft()
    const ws = useWorkspace.getState()
    const activePaneId = panes.some((p) => p.id === entry.activePaneId) ? entry.activePaneId : panes[0].id
    useWorkspace.setState({
      root: entry.root as never,
      activePaneId,
      leftSidebar: { width: entry.leftWidth || 260, open: !!entry.leftOpen, tab: entry.leftTab || "files" },
      rightSidebar: { width: entry.rightWidth || 304, open: !!entry.rightOpen, tab: (entry.rightTab as never) || "backlinks" },
    })
    ws.persist()
    return true
  } catch {
    return false
  }
}

export function deleteWorkspace(name: string): void {
  const key = workspacesKey()
  if (!key) return
  try {
    const all = JSON.parse(localStorage.getItem(key) ?? "{}")
    delete all[name]
    localStorage.setItem(key, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

// ─── Command list (built from current state) ─────────────────────────────────

export function buildCommands(): Command[] {
  const ws = useWorkspace.getState()
  const ui = useUi.getState()
  const activeTab = ws.getActiveTab()
  const settings = ws.settings
  const core = settings.corePlugins
  const hk = (id: string) => {
    const combo = effectiveHotkey(id, settings.hotkeys)
    return combo ? prettyCombo(combo) : undefined
  }

  const cmds: Command[] = []

  // ── Global
  if (core.quickSwitcher) cmds.push({ id: "switcher", name: "Quick switcher: Open quick switcher", hotkey: hk("switcher"), run: () => ui.openSwitcher() })
  if (core.commandPalette) cmds.push({ id: "palette", name: "Command palette: Open command palette", hotkey: hk("palette"), run: () => ui.openPalette() })
  cmds.push({ id: "new-note", name: "File: Create new note", hotkey: hk("new-note"), run: async () => {
    if (!ws.vaultId) return
    const folderId = await resolveNewNoteFolderId()
    const { api } = await import("./api")
    const note = await api.createNote(ws.vaultId, "Untitled", folderId, "")
    useDocs.getState().primeDoc(note.id, note.content ?? "")
    invalidate(["tree", "index", "graph", "tags"])
    useWorkspace.getState().openNote(note.id)
  } })
  if (core.canvas) cmds.push({ id: "new-canvas", name: "Canvas: Create new canvas", run: () => createNewCanvas() })
  cmds.push({ id: "settings", name: "Open settings", hotkey: hk("settings"), run: () => ui.openSettings() })
  cmds.push({ id: "vault-picker", name: "Open another vault…", run: () => ui.openVaultPicker() })

  // ── View toggles
  cmds.push({ id: "toggle-left", name: "View: Toggle left sidebar", run: () => ws.toggleLeftSidebar() })
  cmds.push({ id: "toggle-right", name: "View: Toggle right sidebar", run: () => ws.toggleRightSidebar() })
  cmds.push({ id: "files", name: "Show file explorer", run: () => ws.setLeftTab("files") })
  if (core.search) cmds.push({ id: "search", name: "Search in all files", hotkey: hk("search"), run: () => ws.setLeftTab("search") })
  if (core.bookmarks) cmds.push({ id: "bookmarks-panel", name: "Bookmarks: Show bookmarks", run: () => ws.setLeftTab("bookmarks") })
  if (core.backlinks) cmds.push({ id: "backlinks", name: "Show backlinks panel", run: () => ws.setRightTab("backlinks") })
  if (core.outgoingLinks) cmds.push({ id: "outgoing", name: "Show outgoing links panel", run: () => ws.setRightTab("outgoing") })
  if (core.outline) cmds.push({ id: "outline", name: "Show outline panel", run: () => ws.setRightTab("outline") })
  if (core.tags) cmds.push({ id: "tags", name: "Show tags panel", run: () => ws.setRightTab("tags") })

  // ── Graph
  if (core.graph) {
    cmds.push({ id: "graph", name: "Graph view: Open graph view", hotkey: hk("graph"), run: () => ws.openGraph() })
    cmds.push({ id: "local-graph", name: "Graph view: Open local graph", run: () => ws.openGraph({ local: true }) })
  }

  // ── Daily notes
  if (core.dailyNotes) {
    cmds.push({ id: "daily", name: "Daily notes: Open today's daily note", hotkey: hk("daily"), run: () => openDailyNote(0) })
    cmds.push({ id: "daily-yesterday", name: "Daily notes: Open yesterday's daily note", run: () => openDailyNote(-1) })
    cmds.push({ id: "daily-tomorrow", name: "Daily notes: Open tomorrow's daily note", run: () => openDailyNote(1) })
  }

  // ── Templates
  if (core.templates) cmds.push({ id: "template", name: "Templates: Insert template", run: () => ui.openTemplateModal() })

  // ── Editor / tabs
  cmds.push({ id: "new-tab", name: "Tabs: New tab", hotkey: hk("new-tab"), run: () => ws.newEmptyTab() })
  cmds.push({ id: "next-tab", name: "Tabs: Go to next tab", run: () => ws.cycleTab(1) })
  cmds.push({ id: "prev-tab", name: "Tabs: Go to previous tab", run: () => ws.cycleTab(-1) })
  cmds.push({ id: "reopen-tab", name: "Tabs: Reopen closed tab", run: () => ws.reopenClosedTab() })
  if (activeTab) {
    const isCanvasTab = activeTab.noteId
      ? (activeTab.noteId.endsWith(".canvas") || ws.linkIndex.some((e) => e.id === activeTab.noteId && e.name.endsWith(".canvas")))
      : false
    if (activeTab.noteId && !isCanvasTab && activeTab.type === "note") {
      cmds.push({ id: "toggle-mode", name: "Toggle edit/read view", hotkey: hk("toggle-mode"), run: () => {
        window.dispatchEvent(new CustomEvent("obs-flush-active-draft"))
        const mode = activeTab.mode === "read" ? settings.editor.defaultEditMode : "read"
        ws.setTabMode(activeTab.id, mode)
      } })
      cmds.push({ id: "toggle-source-live", name: "Toggle Live Preview/Source mode", run: () => {
        window.dispatchEvent(new CustomEvent("obs-flush-active-draft"))
        ws.setTabMode(activeTab.id, activeTab.mode === "source" ? "live" : "source")
      } })
      cmds.push({ id: "find", name: "Find in current file", hotkey: hk("find"), run: () => ui.requestFind(activeTab.id) })
      cmds.push({ id: "replace", name: "Find and replace in current file", hotkey: hk("replace"), run: () => ui.requestFind(activeTab.id, { showReplace: true }) })
    }
    cmds.push({ id: "close-tab", name: "Close current tab", hotkey: hk("close-tab"), run: () => ws.closeTab(activeTab.id) })
    cmds.push({ id: "close-all-tabs", name: "Close all tabs", run: () => ws.closeAllTabs() })
    cmds.push({ id: "pin-tab", name: activeTab.pinned ? "Unpin current tab" : "Pin current tab", run: () => ws.pinTab(activeTab.id) })
    if (core.slides && activeTab.noteId && !isCanvasTab) {
      cmds.push({ id: "slides", name: "Slides: Start presentation", hotkey: hk("slides"), run: () => ui.startSlides() })
    }
    if (activeTab.noteId) {
      const targetNoteId = activeTab.noteId
      const activeEntry = ws.linkIndex.find((e) => e.id === targetNoteId)
      cmds.push({ id: "rename", name: "Rename current file…", run: () => ui.openRename({ kind: "note", id: targetNoteId, currentName: activeEntry?.name ?? "" }) })
      cmds.push({ id: "delete-file", name: "Delete current file", hotkey: hk("delete-file"), run: () => {
        const name = activeEntry?.name ?? "this note"
        ui.openConfirm({
          title: `Delete "${name}"?`,
          message: "Are you sure you want to delete this file?",
          confirmLabel: "Delete",
          danger: true,
          onConfirm: async () => {
            await api.deleteNote(targetNoteId)
            useDocs.getState().dropDoc(targetNoteId)
            useWorkspace.getState().closeTabsForNote(targetNoteId)
            invalidate(["tree", "index", "graph", "tags", "backlinks", "bookmarks", "search"])
          },
        })
      } })
      if (core.bookmarks) {
        cmds.push({ id: "bookmark", name: "Bookmark current file", run: async () => {
          if (!ws.vaultId) return
          const entry = ws.linkIndex.find((e) => e.id === targetNoteId)
          await api.addBookmark({ vaultId: ws.vaultId, itemType: "note", itemId: targetNoteId, title: entry?.name ?? "", subtitle: entry?.path ?? "" })
          invalidate(["bookmarks"])
        } })
      }
      if (!isCanvasTab) {
        cmds.push({ id: "export-pdf", name: "Export to PDF", run: () => void exportNoteToPdf(targetNoteId) })
        cmds.push({ id: "export-md", name: "Export to Markdown (copy source)", run: async () => {
          flushActiveDraft()
          await useDocs.getState().flushAll()
          const note = await api.note(targetNoteId)
          await navigator.clipboard.writeText(note.content)
          toast("Markdown source copied to the clipboard")
        } })
      }
      if (core.noteComposer) {
        const entry = ws.linkIndex.find((e) => e.id === targetNoteId)
        cmds.push({ id: "merge-note", name: "Note composer: Merge current note with another note", run: () => ui.openMerge(targetNoteId, entry?.name ?? "") })
      }
    }
  }
  cmds.push({ id: "split-h", name: "Split pane right", run: () => ws.splitCurrentPane("row") })
  cmds.push({ id: "split-v", name: "Split pane down", run: () => ws.splitCurrentPane("column") })
  cmds.push({ id: "back", name: "Navigate back", hotkey: hk("back"), run: () => ws.navigateBack() })
  cmds.push({ id: "forward", name: "Navigate forward", hotkey: hk("forward"), run: () => ws.navigateForward() })

  // ── Zettelkasten / unique / random / workspaces / recovery
  if (core.zettelkasten) cmds.push({ id: "zettel", name: "Zettelkasten: Create new Zettelkasten note", hotkey: hk("zettel"), run: () => createZettelkastenNote() })
  if (core.uniqueNote) cmds.push({ id: "unique-note", name: "Unique note creator: Create new unique note", run: () => createUniqueNote() })
  if (core.randomNote) cmds.push({ id: "random", name: "Random note: Open a random note", hotkey: hk("random"), run: () => openRandomNote() })
  if (core.workspaces) cmds.push({ id: "workspaces", name: "Workspaces: Manage workspaces", run: () => ui.openWorkspaces() })
  if (core.fileRecovery) cmds.push({ id: "snapshots", name: "File recovery: Browse snapshots", run: () => ui.openSnapshots() })

  return cmds
}
