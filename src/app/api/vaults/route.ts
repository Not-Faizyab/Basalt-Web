import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { seedDemoVault } from "@/lib/seed"

export async function GET() {
  let vaults = await db.vault.findMany({ orderBy: { createdAt: "asc" } })
  if (vaults.length === 0) {
    await seedDemoVault()
    vaults = await db.vault.findMany({ orderBy: { createdAt: "asc" } })
  }
  const counts = await Promise.all(
    vaults.map(async (v) => ({
      id: v.id,
      name: v.name,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
      noteCount: await db.note.count({ where: { vaultId: v.id } }),
    })),
  )
  return NextResponse.json(counts)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === "string" && body.name.trim() !== "" ? body.name.trim() : "Untitled vault"
  const vault = await db.vault.create({ data: { name } })
  return NextResponse.json({
    id: vault.id,
    name: vault.name,
    createdAt: vault.createdAt.toISOString(),
    updatedAt: vault.updatedAt.toISOString(),
    noteCount: 0,
  })
}
