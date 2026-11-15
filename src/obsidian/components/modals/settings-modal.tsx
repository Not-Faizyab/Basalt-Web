"use client"

// ─── Settings modal (Ctrl+,) — obsidian's settings with 9 sections ───────────
import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, X, Palette, FileText, FolderTree, CalendarDays, FileInput, Keyboard, Puzzle, Info, Blocks, RotateCcw } from "lucide-react"
import { useUi } from "../../stores/ui"
import { useWorkspace } from "../../stores/workspace"
import { HOTKEYS, effectiveHotkey, eventCombo, normalizeCombo, prettyCombo } from "@/lib/obsidian/settings"
import { fuzzyRank } from "@/lib/obsidian/fuzzy"
import { api } from "../../api"
import { toast } from "sonner"

type SectionItem = { id: string; label: string; icon: React.ReactNode; group: "options" | "plugins" }

const SECTIONS: SectionItem[] = [
  { id: "editor", label: "Editor", icon: <FileText size={15} />, group: "options" },
  { id: "files", label: "Files & links", icon: <FolderTree size={15} />, group: "options" },
  { id: "appearance", label: "Appearance", icon: <Palette size={15} />, group: "options" },
  { id: "hotkeys", label: "Hotkeys", icon: <Keyboard size={15} />, group: "options" },
  { id: "core", label: "Core plugins", icon: <Blocks size={15} />, group: "options" },
  { id: "community", label: "Community plugins", icon: <Puzzle size={15} />, group: "options" },
  { id: "about", label: "About", icon: <Info size={15} />, group: "options" },
  { id: "daily", label: "Daily notes", icon: <CalendarDays size={15} />, group: "plugins" },
  { id: "templates", label: "Templates", icon: <FileInput size={15} />, group: "plugins" },
]

const ACCENT_SWATCHES = ["#8b6cef", "#e9967a", "#e93147", "#4dd0e1", "#4dd964", "#f2c94c", "#f2994a", "#eb5757", "#9b51e0", "#56c8f8", "#d4896a", "#e0a94a"]

function Row({ name, desc, control }: { name: string; desc?: string; control: React.ReactNode }) {
  return (
    <div className="obs-setting-item">
      <div className="min-w-0">
        <div className="text-[0.9rem] font-medium">{name}</div>
        {desc && (
          <div className="mt-0.5 text-[0.78rem] leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {desc}
          </div>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative h-5 w-9 rounded-full transition-colors"
      style={{ background: checked ? "var(--interactive-accent)" : "var(--background-modifier-border)" }}
      role="switch"
      aria-checked={checked}
    >
      <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: checked ? 18 : 2 }} />
    </button>
  )
}

function TextIn({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className="obs-input !w-52 !text-[0.85rem]" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
}

export function SettingsModal() {
  const open = useUi((s) => s.settingsOpen)
  const section = useUi((s) => s.settingsSection)
  const setSection = (id: string) => useUi.setState({ settingsSection: id })
  const closeAll = useUi((s) => s.closeAllModals)
  const settings = useWorkspace((s) => s.settings)
  const updateSettings = useWorkspace((s) => s.updateSettings)
  const vaultId = useWorkspace((s) => s.vaultId)
  const vaultName = useWorkspace((s) => s.vaultName)
  const openVaultPicker = useUi((s) => s.openVaultPicker)
  const [hotkeyFilter, setHotkeyFilter] = useState("")
  const [capturingCmd, setCapturingCmd] = useState<string | null>(null)
  const [communityOn, setCommunityOn] = useState(() => {
    try {
      return localStorage.getItem("obs-community-on") === "1"
    } catch {
      return false
    }
  })
  const [installed, setInstalled] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("obs-community-installed") ?? "[]") as string[]
    } catch {
      return []
    }
  })
  const qc = useQueryClient()

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open && !capturingCmd && !useUi.getState().confirmState) closeAll()
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [open, capturingCmd, closeAll])

  const hotkeys = useMemo(() => {
    if (!hotkeyFilter.trim()) return HOTKEYS
    return fuzzyRank(hotkeyFilter, HOTKEYS, (h) => h.label).map((r) => r.item)
  }, [hotkeyFilter])

  if (!open) return null

  return (
    <div className="obs-modal-bg fixed inset-0 z-[85] flex items-center justify-center p-6" onMouseDown={closeAll}>
      <div
        className="obs-modal flex h-[640px] max-h-[92vh] w-[900px] max-w-[94vw] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* left nav */}
        <div className="flex w-52 shrink-0 flex-col overflow-y-auto border-r py-3" style={{ borderColor: "var(--background-modifier-border)", background: "var(--background-secondary)" }}>
          <div className="mb-1.5 px-4 text-[0.72rem] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
            Options
          </div>
          {SECTIONS.filter((s) => s.group === "options").map((s) => (
            <button
              key={s.id}
              className="obs-tree-row mx-2 !text-[0.85rem]"
              style={section === s.id ? { background: "var(--background-modifier-active-hover)" } : undefined}
              onClick={() => setSection(s.id)}
            >
              <span className="opacity-70">{s.icon}</span>
              {s.label}
            </button>
          ))}
          {SECTIONS.some((s) => s.group === "plugins" && (s.id !== "daily" || settings.corePlugins.dailyNotes) && (s.id !== "templates" || settings.corePlugins.templates)) && (
            <>
              <div className="mt-4 mb-1.5 px-4 text-[0.72rem] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
                Core plugins
              </div>
              {SECTIONS.filter(
                (s) =>
                  s.group === "plugins" &&
                  (s.id !== "daily" || settings.corePlugins.dailyNotes) &&
                  (s.id !== "templates" || settings.corePlugins.templates),
              ).map((s) => (
                <button
                  key={s.id}
                  className="obs-tree-row mx-2 !text-[0.85rem]"
                  style={section === s.id ? { background: "var(--background-modifier-active-hover)" } : undefined}
                  onClick={() => setSection(s.id)}
                >
                  <span className="opacity-70">{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </>
          )}
        </div>

        {/* content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-6 py-3" style={{ borderColor: "var(--background-modifier-border)" }}>
            <div className="flex items-center gap-2 text-[1.05rem] font-semibold">
              <button className="obs-icon-btn md:hidden" onClick={closeAll}>
                <ChevronLeft size={16} />
              </button>
              {SECTIONS.find((s) => s.id === section)?.label}
            </div>
            <button className="obs-icon-btn" onClick={closeAll} title="Close">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-2">
            {section === "appearance" && (
              <>
                <Row
                  name="Base color scheme"
                  desc="Basalt's dark theme or Moonstone (light)."
                  control={
                    <div className="flex gap-1">
                      {(["dark", "light"] as const).map((t) => (
                        <button
                          key={t}
                          className="rounded-md border px-3 py-1.5 text-[0.8rem]"
                          style={{
                            borderColor: settings.appearance.theme === t ? "var(--interactive-accent)" : "var(--background-modifier-border)",
                            background: settings.appearance.theme === t ? "var(--background-modifier-hover)" : "transparent",
                          }}
                          onClick={() => updateSettings({ appearance: { ...settings.appearance, theme: t } })}
                        >
                          {t === "dark" ? "Dark" : "Moonstone"}
                        </button>
                      ))}
                    </div>
                  }
                />
                <Row
                  name="Accent color"
                  desc="Used for links, buttons and the active elements."
                  control={
                    <div className="flex max-w-56 flex-wrap items-center gap-1.5">
                      {ACCENT_SWATCHES.map((c) => (
                        <button
                          key={c}
                          className="h-5 w-5 rounded-full"
                          style={{
                            background: c,
                            outline: settings.appearance.accentColor === c ? "2px solid var(--text-normal)" : "none",
                            outlineOffset: 2,
                          }}
                          onClick={() => updateSettings({ appearance: { ...settings.appearance, accentColor: c } })}
                          aria-label={c}
                        />
                      ))}
                      <input
                        type="color"
                        value={settings.appearance.accentColor}
                        onChange={(e) => updateSettings({ appearance: { ...settings.appearance, accentColor: e.target.value } })}
                        className="h-5 w-5 cursor-pointer rounded-full border-none bg-transparent"
                        title="Custom color"
                      />
                    </div>
                  }
                />
                <Row
                  name="Font size"
                  desc="Base font size — scales the entire interface."
                  control={
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={12}
                        max={22}
                        value={settings.appearance.baseFontSize}
                        onChange={(e) => updateSettings({ appearance: { ...settings.appearance, baseFontSize: parseInt(e.target.value, 10) } })}
                        className="w-40"
                        style={{ accentColor: "var(--interactive-accent)" }}
                      />
                      <span className="w-8 text-[0.8rem]" style={{ color: "var(--text-muted)" }}>
                        {settings.appearance.baseFontSize}px
                      </span>
                    </div>
                  }
                />
                <Row
                  name="Readable line length"
                  desc="Limit the editor's line width for easier reading."
                  control={<Toggle checked={settings.appearance.readableLineLength} onChange={(v) => updateSettings({ appearance: { ...settings.appearance, readableLineLength: v } })} />}
                />
                <Row name="Inline title" desc="Show the note's title inside the editor." control={<Toggle checked={settings.appearance.showInlineTitle} onChange={(v) => updateSettings({ appearance: { ...settings.appearance, showInlineTitle: v } })} />} />
              </>
            )}

            {section === "editor" && (
              <>
                <Row
                  name="Default editing mode"
                  desc="Live Preview renders markdown as you type; Source shows raw syntax."
                  control={
                    <div className="flex gap-1">
                      {(["live", "source"] as const).map((m) => (
                        <button
                          key={m}
                          className="rounded-md border px-3 py-1.5 text-[0.8rem]"
                          style={{
                            borderColor: settings.editor.defaultEditMode === m ? "var(--interactive-accent)" : "var(--background-modifier-border)",
                            background: settings.editor.defaultEditMode === m ? "var(--background-modifier-hover)" : "transparent",
                          }}
                          onClick={() => updateSettings({ editor: { ...settings.editor, defaultEditMode: m } })}
                        >
                          {m === "live" ? "Live Preview" : "Source mode"}
                        </button>
                      ))}
                    </div>
                  }
                />
                <Row
                  name="Properties in document"
                  desc="Display note properties at the top of the editor."
                  control={
                    <select
                      className="obs-input !w-40 !text-[0.85rem]"
                      value={settings.editor.showProperties}
                      onChange={(e) => updateSettings({ editor: { ...settings.editor, showProperties: e.target.value as "visible" | "hidden" } })}
                    >
                      <option value="visible">Visible</option>
                      <option value="hidden">Hidden</option>
                    </select>
                  }
                />
                <Row name="Strict line breaks" desc="Ignore single line breaks (standard Markdown behaviour)." control={<Toggle checked={settings.editor.strictLineBreaks} onChange={(v) => updateSettings({ editor: { ...settings.editor, strictLineBreaks: v } })} />} />
                <Row name="Spellcheck" desc="Enable browser spellcheck in editors." control={<Toggle checked={settings.editor.spellcheck} onChange={(v) => updateSettings({ editor: { ...settings.editor, spellcheck: v } })} />} />
                <Row name="Indent using tabs" desc="Insert a tab character when pressing Tab in lists and code." control={<Toggle checked={settings.editor.indentWithTabs} onChange={(v) => updateSettings({ editor: { ...settings.editor, indentWithTabs: v } })} />} />
                <Row
                  name="Tab indent size"
                  desc="Number of spaces inserted when Indent using tabs is off."
                  control={
                    <select
                      className="obs-input !w-24 !text-[0.85rem]"
                      value={settings.editor.tabSize}
                      onChange={(e) => updateSettings({ editor: { ...settings.editor, tabSize: parseInt(e.target.value, 10) } })}
                    >
                      <option value={2}>2</option>
                      <option value={4}>4</option>
                      <option value={8}>8</option>
                    </select>
                  }
                />
              </>
            )}

            {section === "files" && (
              <>
                <Row
                  name="Default location for new notes"
                  desc="Where newly created notes are placed."
                  control={
                    <select
                      className="obs-input !w-44 !text-[0.85rem]"
                      value={settings.files.newNoteLocation}
                      onChange={(e) => updateSettings({ files: { ...settings.files, newNoteLocation: e.target.value as "root" | "currentFolder" } })}
                    >
                      <option value="root">Vault folder</option>
                      <option value="currentFolder">Same folder as current file</option>
                    </select>
                  }
                />
                <Row name="Use [[Wikilinks]]" desc="Generate wikilinks instead of Markdown links." control={<Toggle checked={settings.files.useWikilinks} onChange={(v) => updateSettings({ files: { ...settings.files, useWikilinks: v } })} />} />
              </>
            )}

            {section === "daily" && (
              <>
                <Row name="Date format" desc="Moment-style format, e.g. YYYY-MM-DD." control={<TextIn value={settings.dailyNotes.format} onChange={(v) => updateSettings({ dailyNotes: { ...settings.dailyNotes, format: v } })} placeholder="YYYY-MM-DD" />} />
                <Row name="New file location" desc="Folder for daily notes. Empty = vault root." control={<TextIn value={settings.dailyNotes.folder} onChange={(v) => updateSettings({ dailyNotes: { ...settings.dailyNotes, folder: v } })} placeholder="Daily notes" />} />
                <Row name="Template file location" desc="Note name used as template for new dailies." control={<TextIn value={settings.dailyNotes.template} onChange={(v) => updateSettings({ dailyNotes: { ...settings.dailyNotes, template: v } })} placeholder="Daily template" />} />
              </>
            )}

            {section === "templates" && (
              <Row name="Template folder location" desc="Notes in this folder appear in the Insert template dialog." control={<TextIn value={settings.templates.folder} onChange={(v) => updateSettings({ templates: { ...settings.templates, folder: v } })} placeholder="Templates" />} />
            )}

            {section === "hotkeys" && (
              <div className="py-3">
                <input className="obs-input mb-3 !text-[0.85rem]" placeholder="Filter hotkeys…" value={hotkeyFilter} onChange={(e) => setHotkeyFilter(e.target.value)} />
                {hotkeys.map((h) => {
                  const activeCombo = effectiveHotkey(h.command, settings.hotkeys)
                  const isCapturing = capturingCmd === h.command
                  const normActive = activeCombo ? normalizeCombo(activeCombo) : ""
                  const isCustom = normActive !== (h.hotkey ? normalizeCombo(h.hotkey) : "")
                  const conflict =
                    normActive !== "" &&
                    HOTKEYS.find((other) => other.command !== h.command && normalizeCombo(effectiveHotkey(other.command, settings.hotkeys) || "") === normActive)
                  return (
                    <div key={h.command} className="obs-setting-item !py-2.5">
                      <div className="min-w-0">
                        <div className="text-[0.875rem]">{h.label}</div>
                        {conflict && (
                          <div className="text-[0.7rem]" style={{ color: "var(--text-warning, #e0a94a)" }}>
                            Conflicts with: {conflict.label}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isCustom && (
                          <button
                            className="obs-icon-btn !h-6 !w-6"
                            title="Restore default"
                            onClick={() => updateSettings({ hotkeys: { [h.command]: h.hotkey } })}
                          >
                            <RotateCcw size={12} />
                          </button>
                        )}
                        {activeCombo && (
                          <button
                            className="obs-icon-btn !h-6 !w-6"
                            title="Clear shortcut"
                            onClick={() => updateSettings({ hotkeys: { [h.command]: "" } })}
                          >
                            <X size={12} />
                          </button>
                        )}
                        <button
                          data-hotkey-capture={isCapturing ? "true" : undefined}
                          className="obs-kbd cursor-pointer transition-colors"
                          style={
                            isCapturing
                              ? { borderColor: "var(--interactive-accent)", color: "var(--text-accent)" }
                              : conflict
                                ? { borderColor: "var(--text-warning, #e0a94a)", color: "var(--text-warning, #e0a94a)" }
                                : undefined
                          }
                          title="Click and press new shortcut (Backspace to clear)"
                          onClick={() => setCapturingCmd(isCapturing ? null : h.command)}
                          onBlur={() => { if (isCapturing) setCapturingCmd(null) }}
                          onKeyDown={(e) => {
                            if (!isCapturing) return
                            e.preventDefault()
                            e.stopPropagation()
                            if (e.key === "Escape") {
                              setCapturingCmd(null)
                              return
                            }
                            if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                              updateSettings({ hotkeys: { [h.command]: "" } })
                              setCapturingCmd(null)
                              return
                            }
                            if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return
                            const combo = eventCombo(e)
                            updateSettings({ hotkeys: { [h.command]: combo } })
                            setCapturingCmd(null)
                          }}
                        >
                          {isCapturing ? "Press hotkey…" : activeCombo ? prettyCombo(activeCombo) : "Blank"}
                        </button>
                      </div>
                    </div>
                  )
                })}
                <div className="pt-3 text-[0.75rem]" style={{ color: "var(--text-faint)" }}>
                  Click any shortcut badge and press a new key combination to rebind it (or Backspace to unbind).
                </div>
              </div>
            )}

            {section === "core" && (
              <div className="py-2">
                {(
                  [
                    ["fileExplorer", "File explorer", "Browse and organize files in the left sidebar"],
                    ["search", "Search", "Search across all files with operators"],
                    ["quickSwitcher", "Quick switcher", "Fuzzy-find notes by name (Ctrl+O)"],
                    ["commandPalette", "Command palette", "Run any command (Ctrl+P)"],
                    ["graph", "Graph view", "Visualize the link network (Ctrl+G)"],
                    ["backlinks", "Backlinks", "See which notes link here"],
                    ["outgoingLinks", "Outgoing links", "See what this note links to"],
                    ["outline", "Outline", "Navigate by headings"],
                    ["tags", "Tags", "Tag pane with counts"],
                    ["pagePreview", "Page preview", "Hover a link for a preview"],
                    ["bookmarks", "Bookmarks", "Pin favourite notes, searches and graphs"],
                    ["properties", "Properties", "Typed frontmatter editing"],
                    ["canvas", "Canvas", "Visual spatial board for notes and cards"],
                    ["dailyNotes", "Daily notes", "Dated journal entries"],
                    ["templates", "Templates", "Insert reusable note content"],
                    ["noteComposer", "Note composer", "Extract / merge note content"],
                    ["wordCount", "Word count", "Status bar statistics"],
                    ["slides", "Slides", "Present Markdown notes separated by ---"],
                    ["randomNote", "Random note", "Open a random note from your vault"],
                    ["zettelkasten", "Zettelkasten prefixer", "Create timestamped Zettelkasten notes"],
                    ["uniqueNote", "Unique note creator", "Create timestamped unique notes"],
                    ["workspaces", "Workspaces", "Save and restore workspace layouts"],
                    ["fileRecovery", "File recovery", "Automatic local snapshots of note edits"],
                  ] as const
                ).map(([key, label, desc]) => (
                  <Row key={key} name={label} desc={desc} control={<Toggle checked={settings.corePlugins[key]} onChange={(v) => updateSettings({ corePlugins: { ...settings.corePlugins, [key]: v } })} />} />
                ))}
              </div>
            )}

            {section === "community" && (
              <div className="py-3">
                {!communityOn ? (
                  <div className="rounded-lg border p-4" style={{ borderColor: "var(--background-modifier-border)" }}>
                    <div className="text-[0.95rem] font-medium">Restricted mode</div>
                    <p className="mt-2 text-[0.82rem] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                      Community plugins are disabled while restricted mode is on. Basalt Web ships without a plugin runtime —
                      the switch below unlocks a small demo catalogue instead.
                    </p>
                    <button
                      className="obs-btn-accent mt-4"
                      onClick={() => {
                        setCommunityOn(true)
                        try { localStorage.setItem("obs-community-on", "1") } catch { /* ignore */ }
                        toast("Community plugins enabled (demo catalogue)")
                      }}
                    >
                      Turn on community plugins
                    </button>
                  </div>
                ) : (
                  <div className="py-2">
                    {[
                      ["Calendar", "Review your daily notes on a calendar"],
                      ["Kanban", "Markdown-backed kanban boards"],
                      ["Dataview", "Query your vault like a database"],
                      ["Advanced Tables", "Improved table navigation"],
                    ].map(([name, desc]) => {
                      const isInstalled = installed.includes(name)
                      return (
                        <div key={name} className="obs-setting-item">
                          <div>
                            <div className="text-[0.9rem] font-medium">{name}</div>
                            <div className="text-[0.78rem]" style={{ color: "var(--text-muted)" }}>
                              {desc}
                            </div>
                          </div>
                          <button
                            className={isInstalled ? "obs-text-btn" : "obs-btn-accent"}
                            onClick={() => {
                              setInstalled((prev) => {
                                const next = isInstalled ? prev.filter((p) => p !== name) : [...prev, name]
                                try { localStorage.setItem("obs-community-installed", JSON.stringify(next)) } catch { /* ignore */ }
                                return next
                              })
                              toast(isInstalled ? `Uninstalled ${name} (demo)` : `Installed ${name} (demo)`)
                            }}
                          >
                            {isInstalled ? "Uninstall" : "Install"}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {section === "about" && (
              <div className="py-4">
                <div className="rounded-xl p-5" style={{ background: "var(--background-secondary)" }}>
                  <div className="text-[1.1rem] font-semibold">
                    {typeof window !== "undefined" &&
                    (window as unknown as { desktop?: { platform?: string } }).desktop &&
                    (window as unknown as { desktop?: { platform?: string } }).desktop?.platform !== "web-demo"
                      ? "Basalt Desktop"
                      : "Basalt (Web Edition)"}
                  </div>
                  <div className="mt-1 text-[0.8rem]" style={{ color: "var(--text-muted)" }}>
                    Version 0.2.2
                  </div>
                  <p className="mt-3 text-[0.82rem] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    Local-first Markdown knowledge base with Live Preview, [[wikilinks]], Properties, Backlinks, Graph view,
                    JSON Canvas, Daily notes, Templates, Workspaces and File recovery.
                  </p>
                </div>
                <Row name="Current vault" desc={vaultId ?? "—"} control={<button className="obs-text-btn" onClick={() => { closeAll(); openVaultPicker() }}>Switch vault</button>} />
                <Row
                  name="Delete current vault"
                  desc={`Permanently delete "${vaultName}" and all its notes.`}
                  control={
                    <button
                      className="rounded-md px-3 py-1.5 text-[0.8rem]"
                      style={{ background: "var(--text-error)", color: "#fff" }}
                      onClick={() => {
                        if (!vaultId) return
                        useUi.getState().openConfirm({
                          title: `Delete vault "${vaultName}"?`,
                          message: "Delete this vault and ALL its notes? This cannot be undone.",
                          confirmLabel: "Delete vault",
                          danger: true,
                          onConfirm: async () => {
                            await api.deleteVault(vaultId)
                            localStorage.removeItem(`obs-web-workspace-${vaultId}`)
                            localStorage.removeItem("obs-web-vault")
                            qc.clear()
                            window.location.reload()
                          },
                        })
                      }}
                    >
                      Delete vault
                    </button>
                  }
                />
                <Row
                  name="Reset demo vault"
                  desc="Wipe your changes and re-seed the Demo Vault."
                  control={
                    <button
                      className="obs-text-btn"
                      onClick={() => {
                        if (!vaultId) return
                        useUi.getState().openConfirm({
                          title: "Reset Demo Vault?",
                          message: "Reset the Demo Vault to its seeded content? Your changes will be lost.",
                          confirmLabel: "Reset",
                          danger: true,
                          onConfirm: async () => {
                            await api.deleteVault(vaultId)
                            localStorage.removeItem(`obs-web-workspace-${vaultId}`)
                            qc.clear()
                            window.location.reload()
                          },
                        })
                      }}
                    >
                      Reset
                    </button>
                  }
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
