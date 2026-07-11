/**
 * 模型上下文上限：启发式推断、cache 与后台 models.list refresh。
 * A1：composer 等命中启发式时同步返回，list 仅 fire-and-forget 校正 cache。
 */
import { pushUiLog } from "../../app/ui-logger"

/** models.list 查表结果缓存（apiKey:modelId → limit） */
const modelLimitCache = new Map<string, number>()

/** 后台 list 进行中 key，防止同一 apiKey:modelId 并发重复请求 */
const refreshInflight = new Set<string>()

const LIMIT_FIELD_CANDIDATES = [
  "contextWindow",
  "contextLimit",
  "maxContextTokens",
  "maxContextLength",
] as const

/** models.list 无上限字段时按 modelId 启发式推断 */
const MODEL_LIMIT_HEURISTICS: ReadonlyArray<{ pattern: RegExp; limit: number }> = [
  { pattern: /^composer/i, limit: 200_000 },
  { pattern: /claude/i, limit: 200_000 },
  { pattern: /gpt-4/i, limit: 128_000 },
  { pattern: /gpt-5/i, limit: 272_000 },
  { pattern: /^o[13]/i, limit: 200_000 },
  { pattern: /gemini/i, limit: 1_000_000 },
]

function extractContextLimitFromModel(model: unknown): number | null {
  if (!model || typeof model !== "object") return null
  const rec = model as Record<string, unknown>
  for (const field of LIMIT_FIELD_CANDIDATES) {
    const v = rec[field]
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v)
  }
  return null
}

function inferContextLimitFromModelId(modelId: string): number | null {
  const id = modelId.trim()
  if (!id) return null
  for (const { pattern, limit } of MODEL_LIMIT_HEURISTICS) {
    if (pattern.test(id)) return limit
  }
  return null
}

/** 后台 models.list 校正 cache；失败仅 WARN、不抛错 */
function refreshModelLimitFromList(modelId: string, apiKey: string): void {
  const id = modelId.trim()
  const key = apiKey.trim()
  if (!id || !key) return
  const cacheKey = `${key}:${id}`
  if (refreshInflight.has(cacheKey)) return
  refreshInflight.add(cacheKey)
  void (async () => {
    try {
      const { Cursor } = await import("@cursor/sdk")
      for (const m of await Cursor.models.list({ apiKey: key })) {
        if (m.id !== id) continue
        const limit = extractContextLimitFromModel(m)
        if (limit != null) {
          modelLimitCache.set(cacheKey, limit)
          break
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      pushUiLog("SDK", "WARN", `[model_limit_refresh] ${cacheKey} 失败: ${msg}`)
    } finally {
      refreshInflight.delete(cacheKey)
    }
  })()
}

/** 查模型上下文上限；启发式命中同步返回，list 仅后台 refresh */
export async function resolveModelContextLimit(modelId: string, apiKey: string): Promise<number | null> {
  const id = modelId?.trim()
  const key = apiKey?.trim()
  if (!id || !key) return null

  const cacheKey = `${key}:${id}`
  const cached = modelLimitCache.get(cacheKey)
  if (cached != null) return cached

  // Claude 短路：Anthropic Key 不兼容 Cursor.models.list
  if (id.startsWith("claude-")) {
    const heuristic = inferContextLimitFromModelId(id)
    if (heuristic != null) {
      modelLimitCache.set(cacheKey, heuristic)
      return heuristic
    }
    return null
  }

  const heuristic = inferContextLimitFromModelId(id)
  if (heuristic != null) {
    modelLimitCache.set(cacheKey, heuristic)
    refreshModelLimitFromList(id, key)
    return heuristic
  }

  refreshModelLimitFromList(id, key)
  return null
}

/** send 前解析并缓存 contextLimitTokens */
export async function resolveContextLimitForSession(session: {
  modelId?: string
  apiKey?: string
  contextLimitTokens?: number
}): Promise<void> {
  if (session.contextLimitTokens != null && session.contextLimitTokens > 0) return
  const modelId = session.modelId?.trim()
  const apiKey = session.apiKey?.trim()
  if (!modelId || !apiKey) return
  const limit = await resolveModelContextLimit(modelId, apiKey)
  if (limit != null) session.contextLimitTokens = limit
}
