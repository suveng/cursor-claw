/**
 * OpenCode Run 失败用户可见文案与 apiKey 脱敏（仿 codex-failure-messages）。
 * 归因链：embedded_start_failed → external_health_failed → timeout → context_exhausted → session_abnormal → safe_message → fallback
 */

const CONTEXT_EXHAUSTED_RATIO = 0.95
const CONTEXT_MESSAGE_PATTERNS = [/context/i, /token/i, /limit/i, /maximum/i, /too long/i, /exceed/i, /上下文/i, /超出/i] as const
const TIMEOUT_PATTERNS = [/timeout/i, /timed out/i, /deadline/i, /超时/i] as const
const SESSION_ABNORMAL_PATTERNS = [/session/i, /invalid/i, /not found/i, /expired/i] as const
const API_KEY_INLINE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /"apiKey"\s*:\s*"[^"]+"/gi,
  /apiKey\s*[:=]\s*[^\s,}]+/gi,
] as const

interface OpencodeFailureContext {
  code?: string
  status?: string
  message?: string
  errorCode?: string
  isTimeoutFailure?: boolean
  contextUsed?: number
  contextLimit?: number | null
}

/** 脱敏 apiKey：保留首尾少量字符 */
export function maskOpencodeApiKey(key: string): string {
  const trimmed = key.trim()
  if (!trimmed) return ""
  if (trimmed.length <= 8) return "***"
  return `${trimmed.slice(0, 7)}***${trimmed.slice(-4)}`
}

/** 从文本剔除 apiKey 明文 */
export function sanitizeOpencodeSensitiveText(text: string): string {
  let out = text
  for (const pattern of API_KEY_INLINE_PATTERNS) {
    out = out.replace(pattern, (match) => {
      const eq = match.match(/[:=]\s*(.+)$/i)
      if (eq) {
        const prefix = match.slice(0, match.length - eq[1].length)
        return `${prefix}${maskOpencodeApiKey(eq[1].replace(/^['"]|['"]$/g, ""))}`
      }
      return maskOpencodeApiKey(match)
    })
  }
  return out
}

function isUnsafeMessage(msg?: string): boolean {
  const t = msg?.trim()
  return !t || /[/\\]|\.ts:|at |stack|Error:|ENOENT|spawn|EACCES|EPERM/i.test(t)
}

function extractFailureContext(error: unknown): OpencodeFailureContext {
  if (error == null) return {}
  if (typeof error === "string") return { message: sanitizeOpencodeSensitiveText(error) }
  if (error instanceof Error) {
    return {
      message: sanitizeOpencodeSensitiveText(error.message),
      errorCode: error.name,
      isTimeoutFailure: TIMEOUT_PATTERNS.some((p) => p.test(error.message)),
    }
  }
  if (typeof error !== "object") return {}
  const rec = error as Record<string, unknown>
  const rawMessage =
    typeof rec.message === "string" ? rec.message
      : typeof rec.error === "string" ? rec.error
        : undefined
  const code = typeof rec.code === "string" ? rec.code : undefined
  const ctx: OpencodeFailureContext = {
    code,
    status: typeof rec.status === "string" ? rec.status : undefined,
    message: rawMessage ? sanitizeOpencodeSensitiveText(rawMessage) : undefined,
    errorCode: typeof rec.errorCode === "string" ? rec.errorCode : undefined,
    isTimeoutFailure: rec.isTimeoutFailure === true,
    contextUsed: typeof rec.contextUsed === "number" ? rec.contextUsed : undefined,
    contextLimit: typeof rec.contextLimit === "number" ? rec.contextLimit : rec.contextLimit === null ? null : undefined,
  }
  if (!ctx.isTimeoutFailure) {
    const probe = `${ctx.message ?? ""} ${ctx.errorCode ?? ""}`
    ctx.isTimeoutFailure = TIMEOUT_PATTERNS.some((p) => p.test(probe))
  }
  return ctx
}

/** 映射 OpenCode 失败为简体中文 IM 文案 */
export function formatOpencodeFailureMessage(error: unknown): string {
  const ctx = extractFailureContext(error)

  if (ctx.code === "embedded_start_failed") {
    return "OpenCode 服务启动失败，请检查端口是否被占用或稍后重试。"
  }
  if (ctx.code === "external_health_failed") {
    return "无法连接 OpenCode 服务，请检查地址"
  }

  if (ctx.isTimeoutFailure) {
    const msg = ctx.message?.trim()
    if (msg && !isUnsafeMessage(msg)) return `⚠️ Agent 处理失败：${msg}`
    return "会话因等待超时已退出，请重新发送消息，我会继续为你处理。"
  }

  if (ctx.status?.toUpperCase() === "CANCELLED") return "Agent 任务已取消。"
  if (ctx.status?.toUpperCase() === "EXPIRED") return "Agent 会话已过期，请重新发送消息。"

  const msg = ctx.message?.trim() ?? ""
  const isError = ctx.status === "ERROR" || !!msg || !!ctx.errorCode

  if (isError && CONTEXT_MESSAGE_PATTERNS.some((p) => p.test(msg))) {
    return "⚠️ 上下文窗口已接近或达到上限，请精简需求或开启新话题后重新发送。"
  }
  if (isError && ctx.contextUsed != null && ctx.contextLimit != null && ctx.contextLimit > 0
    && ctx.contextUsed / ctx.contextLimit >= CONTEXT_EXHAUSTED_RATIO) {
    return "⚠️ 上下文窗口已接近或达到上限，请精简需求或开启新话题后重新发送。"
  }

  if (SESSION_ABNORMAL_PATTERNS.some((p) => p.test(msg))) {
    return "Agent 会话异常，请重新发送消息继续对话。"
  }

  if (msg && !isUnsafeMessage(msg)) return `⚠️ Agent 处理失败：${msg}`

  return "⚠️ Agent 处理失败，建议精简输入后重新发送；若仍失败请稍后重试。"
}
