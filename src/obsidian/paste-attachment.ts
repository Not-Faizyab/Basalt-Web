"use client"

// ─── Paste / drop → vault attachment (fully local; respects settings) ────────
import { format } from "date-fns"
import { api } from "./api"
import { useWorkspace } from "./stores/workspace"

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "")
      const comma = dataUrl.indexOf(",")
      resolve(comma === -1 ? "" : dataUrl.slice(comma + 1))
    }
    reader.onerror = () => reject(new Error("Could not read file"))
    reader.readAsDataURL(blob)
  })
}

/** Where the "Default location for new attachments" setting points. */
export function attachmentTargetFolder(currentFolderId: string | null): string | null {
  const settings = useWorkspace.getState().settings
  if (settings.files.attachmentLocation === "currentFolder") return currentFolderId
  if (settings.files.attachmentLocation === "folder") {
    const f = settings.files.attachmentFolder.trim()
    return f ? f : null
  }
  return null // vault root
}

/**
 * Save clipboard/dragged files into the vault and return the names suitable
 * for ![[name]] embeds. Images get obsidian's "Pasted image …" naming.
 */
export async function savePastedFiles(files: File[], currentFolderId: string | null): Promise<string[]> {
  const ws = useWorkspace.getState()
  if (!ws.vaultId) throw new Error("No vault open")
  if (typeof window !== "undefined" && !window.desktop) {
    throw new Error("Attachments require the desktop edition (local vault folders)")
  }
  const folderId = attachmentTargetFolder(currentFolderId)
  const out: string[] = []
  for (const file of files) {
    const ext = (file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1) : "").toLowerCase()
    const isImage = file.type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"].includes(ext)
    const name = isImage ? `Pasted image ${format(new Date(), "yyyyMMddHHmmss")}` : file.name.replace(/\.[^.]+$/, "")
    const base64 = await blobToBase64(file)
    const saved = await api.saveAttachment(ws.vaultId, folderId, `${name}.${ext || "bin"}`, base64)
    window.dispatchEvent(
      new CustomEvent("obs-invalidate", { detail: { vaultId: ws.vaultId, kinds: ["tree"] } }),
    )
    out.push(`${saved.name}.${saved.ext}`)
  }
  return out
}
