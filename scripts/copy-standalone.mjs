// Cross-platform replacement for `cp -r` in the build script: copies static
// assets + public/ into the Next.js standalone output so it can be served with
// `node .next/standalone/server.js`. Run automatically by `npm run build`.
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const standalone = path.join(ROOT, ".next", "standalone")

function copy(from, to) {
  fs.cpSync(from, to, { recursive: true })
  console.log(`copied ${path.relative(ROOT, from)} -> ${path.relative(ROOT, to)}`)
}

copy(path.join(ROOT, ".next", "static"), path.join(standalone, ".next", "static"))
copy(path.join(ROOT, "public"), path.join(standalone, "public"))
