"use client"

// ─── Attachment viewer tab: image / audio / video / pdf / generic file ────────
import { useMemo, useState } from "react"
import { Download, FolderOpen, ExternalLink } from "lucide-react"
import { api } from "../api"
import { useWorkspace } from "../stores/workspace"

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico"])
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "flac", "opus", "aac", "oga"])
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv", "m4v", "ogv"])

export function AttachmentViewer({ fileId }: { fileId: string }) {
  const vaultId = useWorkspace((s) => s.vaultId)
  const vaultName = useWorkspace((s) => s.vaultName)
  const [zoom, setZoom] = useState(1)
  const meta = useMemo(() => {
    const base = fileId.split("/").pop() ?? fileId
    const dot = base.lastIndexOf(".")
    return {
      name: dot > 0 ? base.slice(0, dot) : base,
      ext: dot > 0 ? base.slice(dot + 1).toLowerCase() : "",
    }
  }, [fileId])

  if (!vaultId) return null
  const url = api.attachmentUrl(vaultId, fileId)
  const label = `${meta.name}.${meta.ext}`

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--background-primary)" }}>
      {/* header */}
      <div className="flex items-center gap-1 px-3 pt-1.5 pb-1 shrink-0" style={{ minHeight: 34 }}>
        <span className="truncate text-[0.8125rem] font-medium" title={fileId}>
          {label}
        </span>
        <span className="ml-2 text-[0.72rem]" style={{ color: "var(--text-faint)" }}>
          {vaultName} / {fileId}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {IMAGE_EXTS.has(meta.ext) && (
            <>
              <button className="obs-icon-btn !h-7 !w-7" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.1, z / 1.25))}>
                −
              </button>
              <span className="w-10 text-center text-[0.72rem]" style={{ color: "var(--text-muted)" }}>{Math.round(zoom * 100)}%</span>
              <button className="obs-icon-btn !h-7 !w-7" title="Zoom in" onClick={() => setZoom((z) => Math.min(8, z * 1.25))}>
                +
              </button>
            </>
          )}
          <button className="obs-icon-btn !h-7 !w-7" title="Reveal in File Explorer" onClick={() => void api.revealItem(vaultId, fileId)}>
            <FolderOpen size={14} />
          </button>
          <button className="obs-icon-btn !h-7 !w-7" title="Open with default app" onClick={() => void api.openWithDefaultApp(vaultId, fileId)}>
            <ExternalLink size={14} />
          </button>
        </div>
      </div>

      {/* body */}
      <div className="obs-attachment-viewer flex-1 overflow-auto">
        {!url ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <div className="text-[0.9rem] font-medium">{label}</div>
            <div className="text-[0.8rem]" style={{ color: "var(--text-muted)" }}>
              Binary attachment preview requires the desktop app.
            </div>
          </div>
        ) : (
          <>
            {IMAGE_EXTS.has(meta.ext) && (
              <div className="flex min-h-full items-center justify-center p-6">
                <img src={url} alt={label} style={{ transform: `scale(${zoom})`, transformOrigin: "center", maxWidth: zoom === 1 ? "100%" : undefined }} draggable={false} />
              </div>
            )}
            {AUDIO_EXTS.has(meta.ext) && (
              <div className="flex h-full items-center justify-center p-6">
                <audio controls src={url} style={{ width: "80%" }} />
              </div>
            )}
            {VIDEO_EXTS.has(meta.ext) && (
              <div className="flex h-full items-center justify-center p-6">
                <video controls src={url} style={{ maxWidth: "100%", maxHeight: "100%" }} />
              </div>
            )}
            {meta.ext === "pdf" && <embed type="application/pdf" src={url} style={{ width: "100%", height: "100%" }} />}
            {!IMAGE_EXTS.has(meta.ext) && !AUDIO_EXTS.has(meta.ext) && !VIDEO_EXTS.has(meta.ext) && meta.ext !== "pdf" && (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
                <Download size={40} style={{ color: "var(--text-faint)" }} />
                <div className="text-[0.95rem] font-medium">{label}</div>
                <div className="text-[0.8rem]" style={{ color: "var(--text-muted)" }}>
                  No inline preview for .{meta.ext} files
                </div>
                <div className="mt-2 flex gap-2">
                  <button className="obs-btn-accent" onClick={() => void api.openWithDefaultApp(vaultId, fileId)}>
                    Open with default app
                  </button>
                  <button className="obs-text-btn" onClick={() => void api.revealItem(vaultId, fileId)}>
                    Reveal in File Explorer
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
