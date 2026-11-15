import { NextRequest, NextResponse } from "next/server"
import { searchVault } from "@/lib/server/vault"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const q = req.nextUrl.searchParams.get("q") ?? ""
  const caseSensitive = req.nextUrl.searchParams.get("case") === "true"
  return NextResponse.json(await searchVault(id, q, caseSensitive))
}
