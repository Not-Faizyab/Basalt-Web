import { NextRequest, NextResponse } from "next/server"
import { getFoldersAndNotes, computePaths, toFolderNodes, toNoteMetas } from "@/lib/server/vault"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { folders, notes } = await getFoldersAndNotes(id)
  const paths = computePaths(folders, notes)
  return NextResponse.json({ folders: toFolderNodes(folders), notes: toNoteMetas(notes, paths) })
}
