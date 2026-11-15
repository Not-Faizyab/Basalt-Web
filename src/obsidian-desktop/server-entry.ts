// Server bundle entry — exposes the fs-backed API for the Electron main
// process (and the demo/test server) via require("./src/main-api.cjs").
export { createServerApi, DesktopApiError } from "./server-api"
export type { DesktopApiDeps, Ctx, ServerApi } from "./server-api"
