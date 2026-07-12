import { stubUrls } from "./electron-import-hook.mjs"

/** @param {string} specifier */
/** @param {import('node:module').ResolveHookContext} context */
/** @param {import('node:module').ResolveHook} nextResolve */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "electron") {
    return { url: stubUrls.electron, shortCircuit: true }
  }
  if (specifier === "electron-store") {
    return { url: stubUrls.electronStore, shortCircuit: true }
  }
  if (specifier.includes("daemon-client")) {
    return { url: stubUrls.daemonClient, shortCircuit: true }
  }
  const resolved = await nextResolve(specifier, context)
  if (resolved.url.includes("/daemon/daemon-client.")) {
    return { url: stubUrls.daemonClient, shortCircuit: true }
  }
  return resolved
}
