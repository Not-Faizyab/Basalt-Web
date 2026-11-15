import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const folder = await db.folder.findUnique({ where: { id } })
  if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 })

  const data: { name?: string; parentId?: string | null } = {}
  if (typeof body.name === "string" && body.name.trim() !== "") data.name = body.name.trim().replace(/\//g, "-")
  if (body.parentId !== undefined) data.parentId = typeof body.parentId === "string" && body.parentId !== "" ? body.parentId : null

  // cycle guard: cannot move a folder into itself or its descendants
  if (data.parentId) {
    let cur: { id: string; parentId: string | null } | null = await db.folder.findUnique({ where: { id: data.parentId } })
    while (cur) {
      if (cur.id === id) return NextResponse.json({ error: "Cannot move a folder into itself" }, { status: 400 })
      cur = cur.parentId ? await db.folder.findUnique({ where: { id: cur.parentId } }) : null
    }
  }
  // unique name in target parent
  const targetParent = data.parentId !== undefined ? data.parentId : folder.parentId
  const targetName = data.name ?? folder.name
  const clash = await db.folder.findFirst({ where: { vaultId: folder.vaultId, parentId: targetParent, name: targetName, NOT: { id } } })
  if (clash) return NextResponse.json({ error: "A folder with that name already exists" }, { status: 409 })

  const updated = await db.folder.update({ where: { id }, data })
  return NextResponse.json({ id: updated.id, vaultId: updated.vaultId, name: updated.name, parentId: updated.parentId, position: updated.position })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await db.folder.delete({ where: { id } }) // cascades to subfolders + notes
  return NextResponse.json({ ok: true })
}
