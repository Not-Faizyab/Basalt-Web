import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { computePaths, getFoldersAndNotes } from "@/lib/server/vault"

async function noteWithPath(note: { id: string; vaultId: string; folderId: string | null; name: string; position: number; createdAt: Date; updatedAt: Date; content: string }) {
  const { folders, notes } = await getFoldersAndNotes(note.vaultId)
  const paths = computePaths(folders, notes)
  return {
    id: note.id,
    vaultId: note.vaultId,
    folderId: note.folderId,
    name: note.name,
    path: paths.get(note.id) ?? note.name,
    position: note.position,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    content: note.content,
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cleanId = id.replace(/\.md$/, "")
  let note = await db.note.findUnique({ where: { id: cleanId } })
  if (!note && cleanId !== id) {
    note = await db.note.findUnique({ where: { id } })
  }
  if (!note) {
    note = await db.note.findFirst({ where: { name: cleanId } })
  }
  if (!note && cleanId !== id) {
    note = await db.note.findFirst({ where: { name: id } })
  }
  if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 })
  return NextResponse.json(await noteWithPath(note))
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  let note = await db.note.findUnique({ where: { id } })
  if (!note) {
    const cleanId = id.replace(/\.md$/, "")
    note = await db.note.findUnique({ where: { id: cleanId } })
  }
  if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 })

  const data: { content?: string; name?: string; folderId?: string | null } = {}
  if (typeof body.content === "string") data.content = body.content
  if (typeof body.name === "string" && body.name.trim() !== "") {
    const n = body.name.trim()
    data.name = n.endsWith(".canvas") ? n : n.replace(/\.md$/, "")
  }
  if (body.folderId !== undefined) data.folderId = typeof body.folderId === "string" && body.folderId !== "" ? body.folderId : null

  // unique-name guard on rename/move
  if ((data.name && data.name !== note.name) || (body.folderId !== undefined && data.folderId !== note.folderId)) {
    const targetName = data.name ?? note.name
    const targetFolder = data.folderId !== undefined ? data.folderId : note.folderId
    const clash = await db.note.findFirst({ where: { vaultId: note.vaultId, folderId: targetFolder, name: targetName, NOT: { id: note.id } } })
    if (clash) return NextResponse.json({ error: "A note with that name already exists in that folder" }, { status: 409 })
  }

  const updated = await db.note.update({ where: { id: note.id }, data })
  return NextResponse.json(await noteWithPath(updated))
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let note = await db.note.findUnique({ where: { id } })
  if (!note) {
    const cleanId = id.replace(/\.md$/, "")
    note = await db.note.findUnique({ where: { id: cleanId } })
  }
  if (note) {
    await db.note.delete({ where: { id: note.id } })
  }
  return NextResponse.json({ ok: true })
}
