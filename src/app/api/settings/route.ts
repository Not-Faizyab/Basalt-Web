import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { DEFAULT_SETTINGS, mergeSettings, type AppSettings } from "@/lib/obsidian/settings"

const KEY = "app"

async function readSettings(): Promise<AppSettings> {
  const row = await db.setting.findUnique({ where: { key: KEY } })
  if (!row) return DEFAULT_SETTINGS
  try {
    const parsed = JSON.parse(row.value)
    return mergeSettings(DEFAULT_SETTINGS, parsed)
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function GET() {
  return NextResponse.json(await readSettings())
}

export async function PUT(req: NextRequest) {
  const patch = await req.json().catch(() => null)
  const current = await readSettings()
  const merged = mergeSettings(current, patch)
  await db.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(merged) },
    update: { value: JSON.stringify(merged) },
  })
  return NextResponse.json(merged)
}
