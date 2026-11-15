import { NextRequest, NextResponse } from "next/server"
import { buildVaultIndex } from "@/lib/server/vault"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { index } = await buildVaultIndex(id)
  return NextResponse.json(index)
}
