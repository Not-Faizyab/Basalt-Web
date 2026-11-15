// ─── App settings (persisted locally, mirrored from obsidian's settings) ─────

export interface CorePluginToggles {
  fileExplorer: boolean
  search: boolean
  quickSwitcher: boolean
  commandPalette: boolean
  graph: boolean
  backlinks: boolean
  outgoingLinks: boolean
  outline: boolean
  tags: boolean
  pagePreview: boolean
  dailyNotes: boolean
  templates: boolean
  noteComposer: boolean
  wordCount: boolean
  bookmarks: boolean
  properties: boolean
  canvas: boolean
  zettelkasten: boolean
  uniqueNote: boolean
  randomNote: boolean
  slides: boolean
  workspaces: boolean
  fileRecovery: boolean
}

export interface AppSettings {
  appearance: {
    theme: "dark" | "light" // obsidian: "Dark" | "Moonstone"
    accentColor: string
    baseFontSize: number
    readableLineLength: boolean
    showInlineTitle: boolean
  }
  editor: {
    defaultEditMode: "live" | "source"
    strictLineBreaks: boolean
    spellcheck: boolean
    showProperties: "visible" | "hidden"
    indentWithTabs: boolean
    tabSize: number
  }
  files: {
    newNoteLocation: "root" | "currentFolder"
    useWikilinks: boolean
    /** Where pasted/dropped attachments are stored */
    attachmentLocation: "root" | "currentFolder" | "folder"
    /** Folder id/path used when attachmentLocation === "folder" */
    attachmentFolder: string
  }
  dailyNotes: {
    format: string
    folder: string
    template: string
  }
  templates: {
    folder: string
  }
  zettelkasten: {
    /** Moment-style format used to generate the unique ID prefix */
    format: string
    /** Note name/template used for new Zettelkasten notes */
    template: string
  }
  fileRecovery: {
    /** Keep snapshots before overwriting/deleting (in .obsidian/snapshots) */
    enabled: boolean
    /** Minimum minutes between snapshots of the same file */
    intervalMinutes: number
    /** Days to keep snapshots */
    retentionDays: number
  }
  graph: {
    groups: { query: string; color: string }[]
    existingOnly: boolean
    arrows: boolean
    textFade: number
    nodeSize: number
    linkThickness: number
    centerForce: number
    repelForce: number
    linkForce: number
    linkDistance: number
    /** Local graph: how many links out from the active note */
    localDepth: number
    /** Local graph: include links pointing INTO the active note */
    localIncoming: boolean
    /** Local graph: include links going OUT of the active note */
    localOutgoing: boolean
    /** Global/local: show nodes with no links */
    showOrphans: boolean
  }
  /** User hotkey overrides: command id → combo, e.g. "palette": "Ctrl+Alt+P" */
  hotkeys: Record<string, string>
  corePlugins: CorePluginToggles
}

export const DEFAULT_SETTINGS: AppSettings = {
  appearance: {
    theme: "dark",
    accentColor: "#8b6cef",
    baseFontSize: 16,
    readableLineLength: true,
    showInlineTitle: true,
  },
  editor: {
    defaultEditMode: "live",
    strictLineBreaks: false,
    spellcheck: false,
    showProperties: "visible",
    indentWithTabs: true,
    tabSize: 4,
  },
  files: {
    newNoteLocation: "root",
    useWikilinks: true,
    attachmentLocation: "root",
    attachmentFolder: "attachments",
  },
  dailyNotes: {
    format: "YYYY-MM-DD",
    folder: "Daily notes",
    template: "Daily template",
  },
  templates: {
    folder: "Templates",
  },
  zettelkasten: {
    format: "YYYYMMDDHHmm",
    template: "",
  },
  fileRecovery: {
    enabled: true,
    intervalMinutes: 5,
    retentionDays: 30,
  },
  graph: {
    groups: [
      { query: "path:Workshop", color: "#e9967a" },
      { query: "tag:#project", color: "#4dd0e1" },
    ],
    existingOnly: false,
    arrows: true,
    textFade: 6,
    nodeSize: 1,
    linkThickness: 1,
    centerForce: 1,
    repelForce: 1,
    linkForce: 1,
    linkDistance: 150,
    localDepth: 1,
    localIncoming: true,
    localOutgoing: true,
    showOrphans: true,
  },
  hotkeys: {},
  corePlugins: {
    fileExplorer: true,
    search: true,
    quickSwitcher: true,
    commandPalette: true,
    graph: true,
    backlinks: true,
    outgoingLinks: true,
    outline: true,
    tags: true,
    pagePreview: true,
    dailyNotes: true,
    templates: true,
    noteComposer: true,
    wordCount: true,
    bookmarks: true,
    properties: true,
    canvas: true,
    zettelkasten: true,
    uniqueNote: true,
    randomNote: true,
    slides: true,
    workspaces: true,
    fileRecovery: true,
  },
}

export interface HotkeyDef {
  command: string
  /** default combo, e.g. "Mod+P" */
  hotkey: string
  label: string
}

export const HOTKEYS: HotkeyDef[] = [
  { command: "palette", hotkey: "Mod+P", label: "Open command palette" },
  { command: "switcher", hotkey: "Mod+O", label: "Open quick switcher" },
  { command: "new-note", hotkey: "Mod+N", label: "Create new note" },
  { command: "toggle-mode", hotkey: "Mod+E", label: "Toggle edit/read view" },
  { command: "graph", hotkey: "Mod+G", label: "Open graph view" },
  { command: "search", hotkey: "Mod+Shift+F", label: "Search in all files" },
  { command: "find", hotkey: "Mod+F", label: "Find in current file" },
  { command: "replace", hotkey: "Mod+H", label: "Find and replace" },
  { command: "settings", hotkey: "Mod+,", label: "Open settings" },
  { command: "new-tab", hotkey: "Mod+T", label: "New tab" },
  { command: "close-tab", hotkey: "Mod+W", label: "Close current tab" },
  { command: "reopen-tab", hotkey: "Mod+Shift+T", label: "Reopen closed tab" },
  { command: "back", hotkey: "Alt+Left", label: "Navigate back" },
  { command: "forward", hotkey: "Alt+Right", label: "Navigate forward" },
  { command: "delete-file", hotkey: "Mod+Shift+Backspace", label: "Delete current file" },
  { command: "bold", hotkey: "Mod+B", label: "Bold selection" },
  { command: "italic", hotkey: "Mod+I", label: "Italicize selection" },
  { command: "insert-link", hotkey: "Mod+K", label: "Insert link" },
  { command: "checkbox", hotkey: "Mod+L", label: "Toggle checkbox status" },
  { command: "daily", hotkey: "Mod+Shift+D", label: "Open today's daily note" },
  { command: "zettel", hotkey: "Mod+Shift+Z", label: "Create new Zettelkasten note" },
  { command: "random", hotkey: "", label: "Open random note" },
  { command: "slides", hotkey: "", label: "Start presentation" },
]

export function mergeSettings(base: AppSettings, patch: Partial<AppSettings> | null | undefined): AppSettings {
  if (!patch) return base
  return {
    appearance: { ...base.appearance, ...(patch.appearance ?? {}) },
    editor: { ...base.editor, ...(patch.editor ?? {}) },
    files: { ...base.files, ...(patch.files ?? {}) },
    dailyNotes: { ...base.dailyNotes, ...(patch.dailyNotes ?? {}) },
    templates: { ...base.templates, ...(patch.templates ?? {}) },
    zettelkasten: { ...base.zettelkasten, ...(patch.zettelkasten ?? {}) },
    fileRecovery: { ...base.fileRecovery, ...(patch.fileRecovery ?? {}) },
    graph: { ...base.graph, ...(patch.graph ?? {}) },
    hotkeys: { ...base.hotkeys, ...(patch.hotkeys ?? {}) },
    corePlugins: { ...base.corePlugins, ...(patch.corePlugins ?? {}) },
  }
}

// ─── Hotkey matching (user overrides on top of defaults) ─────────────────────

/** Normalize a combo string: lowercase, sorted modifiers, canonical key names. */
export function normalizeCombo(combo: string): string {
  const parts = combo
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
  const mods = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()))
  let key = (parts[parts.length - 1] ?? "").toLowerCase()
  // canonical key names (must match eventCombo's output)
  const keyAliases: Record<string, string> = {
    left: "arrowleft",
    right: "arrowright",
    up: "arrowup",
    down: "arrowdown",
    esc: "escape",
    space: " ",
  }
  key = keyAliases[key] ?? key
  const order: string[] = []
  if (mods.has("mod") || mods.has("ctrl") || mods.has("cmd")) order.push("mod")
  if (mods.has("shift")) order.push("shift")
  if (mods.has("alt")) order.push("alt")
  return [...order, key].join("+")
}

/** The effective hotkey for a command (override, else default, else ""). */
export function effectiveHotkey(command: string, overrides: Record<string, string> | undefined): string {
  const override = overrides?.[command]
  if (override !== undefined) return override
  return HOTKEYS.find((h) => h.command === command)?.hotkey ?? ""
}

/** Build a keyboard event's combo string in the same normalized form. */
export function eventCombo(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; key: string }): string {
  const order: string[] = []
  if (e.ctrlKey || e.metaKey) order.push("mod")
  if (e.shiftKey) order.push("shift")
  if (e.altKey) order.push("alt")
  return [...order, e.key.toLowerCase()].join("+")
}

/** Pretty-print a combo for display (Ctrl+Shift+P style). */
export function prettyCombo(combo: string): string {
  return combo
    .split("+")
    .map((p) => {
      const lower = p.toLowerCase()
      if (lower === "mod") return "Ctrl"
      if (lower === "space") return "Space"
      if (p.length === 1) return p.toUpperCase()
      return p.charAt(0).toUpperCase() + p.slice(1)
    })
    .join("+")
}
