import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const vaultId = body.vaultId as string | undefined
  if (!vaultId) return NextResponse.json({ error: "vaultId required" }, { status: 400 })
  const name = (typeof body.name === "string" && body.name.trim() !== "" ? body.name.trim() : "New folder").replace(/\//g, "-")
  const parentId = typeof body.parentId === "string" && body.parentId !== "" ? body.parentId : null

  let finalName = name
  let n = 1
  while (await db.folder.findFirst({ where: { vaultId, parentId, name: finalName } })) {
    finalName = `${name} ${++n}`
  }
  const position = await db.folder.count({ where: { vaultId, parentId } })
  const folder = await db.folder.create({ data: { vaultId, parentId, name: finalName, position } })
  return NextResponse.json({ id: folder.id, vaultId: folder.vaultId, name: folder.name, parentId: folder.parentId, position: folder.position })
}
