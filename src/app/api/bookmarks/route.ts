import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(req: NextRequest) {
  const vaultId = req.nextUrl.searchParams.get("vaultId")
  if (!vaultId) return NextResponse.json({ error: "vaultId required" }, { status: 400 })
  const bookmarks = await db.bookmark.findMany({ where: { vaultId }, orderBy: { position: "asc" } })
  return NextResponse.json(
    bookmarks.map((b) => ({
      id: b.id,
      itemType: b.itemType as "note" | "folder" | "graph" | "search",
      itemId: b.itemId,
      title: b.title,
      subtitle: b.subtitle,
      query: b.query,
      position: b.position,
      createdAt: b.createdAt.toISOString(),
    })),
  )
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const vaultId = body.vaultId as string | undefined
  if (!vaultId) return NextResponse.json({ error: "vaultId required" }, { status: 400 })
  const position = await db.bookmark.count({ where: { vaultId } })
  const bookmark = await db.bookmark.create({
    data: {
      vaultId,
      itemType: body.itemType ?? "note",
      itemId: body.itemId ?? null,
      title: body.title ?? "Untitled",
      subtitle: body.subtitle ?? "",
      query: body.query ?? "",
      position,
    },
  })
  return NextResponse.json({ id: bookmark.id, itemType: bookmark.itemType, itemId: bookmark.itemId, title: bookmark.title, subtitle: bookmark.subtitle, query: bookmark.query, position: bookmark.position, createdAt: bookmark.createdAt.toISOString() })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
  await db.bookmark.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
