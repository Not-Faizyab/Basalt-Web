"use client"

// ─── Properties: obsidian's frontmatter property editor ─────────────────────
import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronRight, Plus, Text, ListOrdered, Hash, CalendarDays, ToggleLeft, Tags, X, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import {
  coerceValue,
  getProperties,
  parseFrontmatter,
  propertiesToData,
  serializeFrontmatter,
  type PropertyInfo,
} from "@/lib/obsidian/frontmatter"
import type { PropertyType } from "@/lib/obsidian/types"
import { useUi } from "../stores/ui"
import { useWorkspace } from "../stores/workspace"

const TYPE_ICONS: Record<PropertyType, React.ReactNode> = {
  text: <Text size={13} />,
  list: <ListOrdered size={13} />,
  number: <Hash size={13} />,
  checkbox: <ToggleLeft size={13} />,
  date: <CalendarDays size={13} />,
}

function ListPillInput({
  items,
  isTag,
  onUpdate,
  onTagClick,
}: {
  items: string[]
  isTag: boolean
  onUpdate: (next: string[]) => void
  onTagClick?: (val: string) => void
}) {
  const [draft, setDraft] = useState("")
  const commit = (raw: string) => {
    const tokens = raw
      .split(",")
      .map((s) => s.trim().replace(/^#/, ""))
      .filter(Boolean)
    if (tokens.length === 0) return
    const next = [...items]
    for (const t of tokens) {
      if (!next.includes(t)) next.push(t)
    }
    onUpdate(next)
    setDraft("")
  }
  return (
    <div className="flex flex-wrap items-center gap-1 py-0.5 w-full">
      {items.map((item, idx) => (
        <span key={`${item}-${idx}`} className={isTag ? "obs-prop-pill is-tag" : "obs-prop-pill"}>
          <span
            className={isTag ? "cursor-pointer hover:underline" : undefined}
            onClick={() => {
              if (isTag && onTagClick) onTagClick(item)
            }}
          >
            {item}
          </span>
          <button
            type="button"
            className="opacity-60 hover:opacity-100 cursor-pointer"
            title={`Remove ${item}`}
            onClick={(e) => {
              e.stopPropagation()
              onUpdate(items.filter((_, i) => i !== idx))
            }}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        className="flex-1 min-w-[60px] bg-transparent py-0.5 text-[0.83rem] outline-none"
        style={{ color: "var(--text-normal)" }}
        value={draft}
        placeholder={items.length === 0 ? (isTag ? "Add tag…" : "Add item…") : ""}
        onChange={(e) => {
          const v = e.target.value
          if (v.includes(",")) commit(v)
          else setDraft(v)
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === "Tab") && draft.trim()) {
            e.preventDefault()
            commit(draft)
          } else if (e.key === "Backspace" && !draft && items.length > 0) {
            onUpdate(items.slice(0, -1))
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit(draft)
        }}
      />
    </div>
  )
}

function NumberPropertyInput({
  value,
  onCommit,
}: {
  value: unknown
  onCommit: (next: unknown) => void
}) {
  const display = value === null || value === undefined ? "" : String(value)
  const [draft, setDraft] = useState(display)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(display)
  }, [display, focused])

  return (
    <input
      className="obs-input !border-transparent !bg-transparent !py-0.5 text-[0.85rem]"
      value={focused ? draft : display}
      inputMode="decimal"
      onFocus={() => {
        setDraft(display)
        setFocused(true)
      }}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        if (raw.trim() === "") {
          onCommit(null)
          return
        }
        // Wait for decimal digits / trailing dot so typing "3." or "-" doesn't clobber the caret
        if (/^-?\d*\.?$/.test(raw.trim())) return
        const n = Number(raw)
        if (!Number.isNaN(n) && Number.isFinite(n)) onCommit(n)
      }}
      onBlur={() => {
        setFocused(false)
        const trimmed = draft.trim()
        if (trimmed === "") {
          onCommit(null)
          return
        }
        const n = Number(trimmed)
        if (!Number.isNaN(n) && Number.isFinite(n)) onCommit(n)
        else setDraft(display)
      }}
    />
  )
}

export function PropertiesPanel({
  content,
  onChange,
}: {
  content: string
  onChange: (next: string) => void
}) {
  const fm = useMemo(() => parseFrontmatter(content), [content])
  const props = useMemo(() => getProperties(fm.data), [fm.data])
  const [collapsed, setCollapsed] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState("")
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const addRef = useRef<HTMLInputElement>(null)
  const setSearchQuery = useUi((s) => s.setSearchQuery)
  const setLeftTab = useWorkspace((s) => s.setLeftTab)

  useEffect(() => {
    if (adding) addRef.current?.focus()
  }, [adding])

  useEffect(() => {
    if (!menuFor) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuFor(null)
    }
    const onDown = () => setMenuFor(null)
    window.addEventListener("keydown", onKey)
    window.addEventListener("mousedown", onDown)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("mousedown", onDown)
    }
  }, [menuFor])

  const apply = (next: PropertyInfo[]) => {
    if (fm.invalidYaml) {
      toast.error("Cannot edit properties while YAML frontmatter has syntax errors")
      return
    }
    const eol = fm.eol ?? (content.includes("\r\n") ? "\r\n" : "\n")
    const data = propertiesToData(next)
    const nextFm = serializeFrontmatter(data, eol)
    const raw = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)|^---\r?\n---(?:\r?\n|$)/)
    const rest = raw ? content.slice(raw[0].length) : content
    const gapMatch = /^(?:[ \t]*\r?\n)*/.exec(rest)
    const existingGap = fm.rawGap ?? (gapMatch ? gapMatch[0] : "")
    const body = rest.slice(gapMatch ? gapMatch[0].length : 0)
    if (!nextFm) {
      onChange(body)
      return
    }
    const joinGap = raw ? existingGap : body.trimStart().length > 0 ? eol : ""
    onChange(nextFm + joinGap + body)
  }

  const setProp = (key: string, patch: Partial<PropertyInfo>) => {
    apply(props.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  }

  const removeProp = (key: string) => {
    apply(props.filter((p) => p.key !== key))
  }

  const addProp = (type: PropertyType) => {
    const key = newKey.trim() || "newKey"
    let finalKey = key
    let n = 1
    while (props.some((p) => p.key.toLowerCase() === finalKey.toLowerCase())) finalKey = `${key} ${++n}`
    const value = type === "checkbox" ? false : type === "number" ? 0 : type === "list" ? [] : ""
    apply([...props, { key: finalKey, type, value, inferred: false }])
    setAdding(false)
    setNewKey("")
  }

  const changeType = (key: string, type: PropertyType) => {
    const p = props.find((x) => x.key === key)
    if (!p) return
    let value = p.value
    if (typeof value === "string") value = coerceValue(type, value)
    if (type === "checkbox") value = Boolean(value)
    if (type === "list" && !Array.isArray(value)) {
      value = value === null || value === undefined || value === "" ? [] : [String(value)]
    }
    setProp(key, { type, value })
    setMenuFor(null)
  }

  if (fm.invalidYaml) {
    return (
      <div className="obs-props select-none" style={{ marginBottom: "1em" }}>
        <div
          className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-[0.8rem]"
          style={{ borderColor: "var(--background-modifier-border)", color: "var(--text-muted)", background: "var(--background-primary-alt)" }}
        >
          <AlertTriangle size={14} style={{ color: "var(--text-error)" }} />
          <span>Invalid YAML frontmatter — fix syntax in Source mode</span>
        </div>
      </div>
    )
  }

  return (
    <div className="obs-props select-none" style={{ marginBottom: "1em" }}>
      <button
        type="button"
        className="flex items-center gap-1 mb-1 px-0.5 py-0.5 text-[0.875rem] font-medium cursor-pointer"
        style={{ color: "var(--text-muted)" }}
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span>Properties</span>
      </button>
      {!collapsed && (
        <>
          {props.map((p) => {
            const lowerKey = p.key.toLowerCase()
            const isTagsKey = lowerKey === "tags" || lowerKey === "tag"
            return (
              <div key={p.key} className="obs-props-row group">
                <div className="relative flex items-center gap-2 px-1.5 shrink-0" style={{ width: 165, color: "var(--text-muted)" }}>
                  <button
                    className="obs-interactive flex items-center p-0.5"
                    title="Change property type"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuFor(menuFor === p.key ? null : p.key)
                    }}
                  >
                    {isTagsKey ? <Tags size={13} /> : TYPE_ICONS[p.type]}
                  </button>
                  {menuFor === p.key && (
                    <div
                      className="absolute left-4 top-7 z-50 w-40 rounded-md border p-1 text-sm obs-modal"
                      style={{ background: "var(--popover)" }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      {(["text", "list", "number", "checkbox", "date"] as PropertyType[]).map((t) => (
                        <div
                          key={t}
                          className="obs-tree-row !min-h-[28px] !text-[13px]"
                          onClick={() => changeType(p.key, t)}
                        >
                          <span className="opacity-70">{TYPE_ICONS[t]}</span>
                          <span className="capitalize">{t}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <span
                    className="truncate text-[0.85rem] cursor-text"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => {
                      const nextKey = e.currentTarget.textContent?.trim() ?? ""
                      if (!nextKey || nextKey === p.key) {
                        e.currentTarget.textContent = p.key
                        return
                      }
                      if (props.some((x) => x.key !== p.key && x.key.toLowerCase() === nextKey.toLowerCase())) {
                        toast.error(`Property "${nextKey}" already exists`)
                        e.currentTarget.textContent = p.key
                        return
                      }
                      const renamed = props.map((x) => (x.key === p.key ? { ...x, key: nextKey } : x))
                      apply(renamed)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        e.currentTarget.blur()
                      } else if (e.key === "Escape") {
                        e.currentTarget.textContent = p.key
                        e.currentTarget.blur()
                      }
                    }}
                  >
                    {p.key}
                  </span>
                </div>
                <div className="flex-1 min-w-0 flex items-center pr-2">
                  {p.type === "checkbox" ? (
                    <input
                      type="checkbox"
                      checked={Boolean(p.value)}
                      onChange={(e) => setProp(p.key, { value: e.target.checked })}
                      className="accent-current"
                      style={{ accentColor: "var(--interactive-accent)", width: 15, height: 15 }}
                    />
                  ) : p.type === "list" ? (
                    <ListPillInput
                      items={Array.isArray(p.value) ? p.value.map(String).filter(Boolean) : String(p.value ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)}
                      isTag={isTagsKey}
                      onUpdate={(next) => setProp(p.key, { value: next })}
                      onTagClick={(tag) => {
                        setSearchQuery("tag:#" + tag.replace(/^#/, ""))
                        setLeftTab("search")
                      }}
                    />
                  ) : p.type === "date" ? (
                    <input
                      type="date"
                      className="obs-input !border-transparent !bg-transparent !py-0.5 text-[0.85rem]"
                      value={String(p.value ?? "")}
                      onChange={(e) => setProp(p.key, { value: e.target.value })}
                      style={{ colorScheme: "inherit" }}
                    />
                  ) : p.type === "number" ? (
                    <NumberPropertyInput value={p.value} onCommit={(val) => setProp(p.key, { value: val })} />
                  ) : (
                    <input
                      className="obs-input !border-transparent !bg-transparent !py-0.5 text-[0.85rem]"
                      value={String(p.value ?? "")}
                      onChange={(e) => setProp(p.key, { value: e.target.value })}
                    />
                  )}
                </div>
                <button
                  className="obs-icon-btn obs-props-delete !h-6 !w-6 mr-1"
                  title="Delete property"
                  onClick={() => removeProp(p.key)}
                >
                  <X size={13} />
                </button>
              </div>
            )
          })}

          {adding ? (
            <div className="flex items-center gap-1 mt-1">
              <input
                ref={addRef}
                className="obs-input text-[0.85rem]"
                placeholder="Property name"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addProp("text")
                  if (e.key === "Escape") {
                    setAdding(false)
                    setNewKey("")
                  }
                }}
                onBlur={() => {
                  setTimeout(() => setAdding(false), 150)
                }}
              />
              {(["text", "list", "number", "checkbox", "date"] as PropertyType[]).map((t) => (
                <button key={t} className="obs-icon-btn !h-6 !w-6" title={`Add ${t} property`} onMouseDown={(e) => e.preventDefault()} onClick={() => addProp(t)}>
                  {TYPE_ICONS[t]}
                </button>
              ))}
            </div>
          ) : (
            <button
              className="obs-interactive flex items-center gap-1.5 mt-1 px-1 py-1 text-[0.83rem]"
              style={{ color: "var(--text-muted)" }}
              onClick={() => setAdding(true)}
            >
              <Plus size={14} />
              Add property
            </button>
          )}
        </>
      )}
    </div>
  )
}
