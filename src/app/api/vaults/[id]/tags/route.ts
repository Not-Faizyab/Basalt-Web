import { NextRequest, NextResponse } from "next/server"
import { buildTagCounts } from "@/lib/server/vault"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return NextResponse.json(await buildTagCounts(id))
}
