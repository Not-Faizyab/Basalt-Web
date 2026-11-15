import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { computePaths, getFoldersAndNotes } from "@/lib/server/vault"

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const vaultId = body.vaultId as string | undefined
  if (!vaultId) return NextResponse.json({ error: "vaultId required" }, { status: 400 })
  const rawName = (typeof body.name === "string" && body.name.trim() !== "" ? body.name.trim() : "Untitled")
  const isCanvas = rawName.endsWith(".canvas")
  const baseName = isCanvas ? rawName.slice(0, -7) : rawName.replace(/\.md$/, "")
  const folderId = typeof body.folderId === "string" && body.folderId !== "" ? body.folderId : null
  const content = typeof body.content === "string" ? body.content : ""

  // ensure unique name within folder
  let finalName = isCanvas ? `${baseName}.canvas` : baseName
  let n = 1
  while (await db.note.findFirst({ where: { vaultId, folderId, name: finalName } })) {
    n++
    finalName = isCanvas ? `${baseName} ${n}.canvas` : `${baseName} ${n}`
  }

  const position = await db.note.count({ where: { vaultId, folderId } })
  const note = await db.note.create({ data: { vaultId, folderId, name: finalName, content, position } })

  const { folders, notes } = await getFoldersAndNotes(vaultId)
  const paths = computePaths(folders, notes)
  return NextResponse.json({
    id: note.id,
    vaultId: note.vaultId,
    folderId: note.folderId,
    name: note.name,
    path: paths.get(note.id) ?? note.name,
    position: note.position,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    content: note.content,
  })
}
