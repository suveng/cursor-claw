/**
 * SDK API Key / 模型列表探测（拆分自 agent-sdk.ts）
 */
import type { SdkModelOption } from "./sdk-session-types"

export async function checkSdkApiKey(apiKey: string): Promise<{ ok: boolean; email?: string; error?: string }> {
  const key = apiKey?.trim()
  if (!key) return { ok: false, error: "API Key 未配置" }
  try {
    const { Cursor } = await import("@cursor/sdk")
    const me = await Cursor.me({ apiKey: key })
    return { ok: true, email: me.userEmail }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function listSdkModels(
  apiKey: string,
  currentModelId?: string,
  currentModelParams?: string,
): Promise<{ ok: boolean; models: SdkModelOption[]; error?: string }> {
  const key = apiKey?.trim()
  if (!key) return { ok: false, models: [], error: "API Key 未配置" }
  try {
    const { Cursor } = await import("@cursor/sdk")
    const sdkModels = await Cursor.models.list({ apiKey: key })
    const currentModel = currentModelId?.trim() || ""
    const currentParams = currentModelParams?.trim() || ""
    const models: SdkModelOption[] = []
    for (const m of sdkModels) {
      if (m.variants && m.variants.length > 0) {
        const nameCount = new Map<string, number>()
        for (const v of m.variants) nameCount.set(v.displayName, (nameCount.get(v.displayName) || 0) + 1)
        for (const v of m.variants) {
          const ps = JSON.stringify(v.params)
          const hasDup = (nameCount.get(v.displayName) || 0) > 1
          const suffix = hasDup ? ` (${v.params.map((p) => `${p.id}=${p.value}`).join(", ")})` : ""
          models.push({
            id: m.id,
            label: (v.displayName || m.displayName) + suffix,
            params: ps,
            current: m.id === currentModel && ps === currentParams,
          })
        }
      } else {
        models.push({
          id: m.id,
          label: m.displayName || m.id,
          params: "",
          current: m.id === currentModel && !currentParams,
        })
      }
    }
    return { ok: true, models }
  } catch (e: unknown) {
    return { ok: false, models: [], error: e instanceof Error ? e.message : String(e) }
  }
}
