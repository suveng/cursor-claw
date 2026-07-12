/**
 * Node import hook：将 electron / electron-store 重定向至 stubs
 */
import { register } from "node:module"
import { pathToFileURL } from "node:url"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const stubDir = join(dirname(fileURLToPath(import.meta.url)), "stubs")

register("./electron-resolve-hook.mjs", import.meta.url)

export const stubUrls = {
  electron: pathToFileURL(join(stubDir, "electron.mjs")).href,
  electronStore: pathToFileURL(join(stubDir, "electron-store.mjs")).href,
  daemonClient: pathToFileURL(join(stubDir, "daemon-client-stub.mjs")).href,
}
