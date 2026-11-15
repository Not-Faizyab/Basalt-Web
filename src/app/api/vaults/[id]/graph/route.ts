import { NextRequest, NextResponse } from "next/server"
import { buildGraph } from "@/lib/server/vault"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return NextResponse.json(await buildGraph(id))
}
