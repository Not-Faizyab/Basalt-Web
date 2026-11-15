import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const vault = await db.vault.findUnique({ where: { id } })
  if (!vault) return NextResponse.json({ error: "Vault not found" }, { status: 404 })
  return NextResponse.json({
    id: vault.id,
    name: vault.name,
    createdAt: vault.createdAt.toISOString(),
    updatedAt: vault.updatedAt.toISOString(),
    noteCount: await db.note.count({ where: { vaultId: id } }),
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const data: { name?: string } = {}
  if (typeof body.name === "string" && body.name.trim() !== "") data.name = body.name.trim()
  const vault = await db.vault.update({ where: { id }, data })
  return NextResponse.json({ id: vault.id, name: vault.name })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await db.vault.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
