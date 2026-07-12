/**
 * Codex Run 失败文案：脱敏 + 归因提取，用户可见句委托 shared formatRunFailureMessage。
 */
import type { RunFailureReason } from "../shared/run-lifecycle-types"
import { formatRunFailureMessage } from "../shared/run-failure-formatter"

/** 从 unknown error 解析后的归因输入 */
interface CodexFailureContext {
  status?: string
  message?: string
  errorCode?: string
  isTimeoutFailure?: boolean
  contextUsed?: number
  contextLimit?: number | null
}

/** 上下文耗尽判定：peak/limit ≥ 95% */
const CONTEXT_EXHAUSTED_RATIO = 0.95

/** message 含 context/token/limit 等模式 */
const CONTEXT_MESSAGE_PATTERNS = [
  /context/i,
  /token/i,
  /limit/i,
  /maximum/i,
  /too long/i,
  /exceed/i,
  /length/i,
  /窗口/i,
  /上下文/i,
  /超出/i,
] as const

/** errorCode 含上下文相关关键字 */
const CONTEXT_ERROR_CODE_PATTERNS = [/CONTEXT/i, /TOKEN/i, /LIMIT/i, /LENGTH/i] as const

/** 会话异常 message/errorCode 模式 */
const SESSION_ABNORMAL_PATTERNS = [
  /session/i,
  /thread/i,
  /invalid/i,
  /not found/i,
  /expired/i,
] as const

/** 超时类 message/errorCode 模式 */
const TIMEOUT_PATTERNS = [/timeout/i, /timed out/i, /deadline/i, /超时/i] as const

/** OpenAI / Codex apiKey 字面量（日志/文案脱敏） */
const API_KEY_INLINE_PATTERNS = [
  /\bsk-proj-[A-Za-z0-9_-]{8,}\b/g,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /OPENAI_API_KEY\s*=\s*[^\s'"]+/gi,
  /"apiKey"\s*:\s*"[^"]+"/gi,
  /'apiKey'\s*:\s*'[^']+'/gi,
  /apiKey\s*[:=]\s*[^\s,}]+/gi,
] as const

/** 脱敏单条 apiKey：保留首尾少量字符，中间替换为 *** */
export function maskCodexApiKey(key: string): string {
  const trimmed = key.trim()
  if (!trimmed) return ""
  if (trimmed.length <= 8) return "***"
  return `${trimmed.slice(0, 7)}***${trimmed.slice(-4)}`
}

/** 从任意文本中剔除 apiKey / OPENAI_API_KEY 明文（供用户文案与日志复用） */
export function sanitizeCodexSensitiveText(text: string): string {
  let out = text
  for (const pattern of API_KEY_INLINE_PATTERNS) {
    out = out.replace(pattern, (match) => {
      const eq = match.match(/[:=]\s*(.+)$/i)
      if (eq) {
        const prefix = match.slice(0, match.length - eq[1].length)
        return `${prefix}${maskCodexApiKey(eq[1].replace(/^['"]|['"]$/g, ""))}`
      }
      return maskCodexApiKey(match)
    })
  }
  return out
}

/** 从 Error / 结构化对象 / 字符串提取归因字段 */
function extractFailureContext(error: unknown): CodexFailureContext {
  if (error == null) return {}

  if (typeof error === "string") {
    return { message: sanitizeCodexSensitiveText(error) }
  }

  if (error instanceof Error) {
    return {
      message: sanitizeCodexSensitiveText(error.message),
      errorCode: error.name,
      isTimeoutFailure: error.name === "TimeoutError" || TIMEOUT_PATTERNS.some((p) => p.test(error.message)),
    }
  }

  if (typeof error !== "object") return {}

  const rec = error as Record<string, unknown>
  const rawMessage =
    typeof rec.message === "string"
      ? rec.message
      : typeof rec.error === "string"
        ? rec.error
        : typeof rec.reason === "string"
          ? rec.reason
          : undefined

  const rawCode =
    typeof rec.errorCode === "string"
      ? rec.errorCode
      : typeof rec.code === "string"
        ? rec.code
        : typeof rec.type === "string"
          ? rec.type
          : undefined

  const ctx: CodexFailureContext = {
    status: typeof rec.status === "string" ? rec.status : undefined,
    message: rawMessage ? sanitizeCodexSensitiveText(rawMessage) : undefined,
    errorCode: rawCode ? sanitizeCodexSensitiveText(rawCode) : undefined,
    isTimeoutFailure: rec.isTimeoutFailure === true,
    contextUsed: typeof rec.contextUsed === "number" ? rec.contextUsed : undefined,
    contextLimit:
      typeof rec.contextLimit === "number"
        ? rec.contextLimit
        : rec.contextLimit === null
          ? null
          : undefined,
  }

  if (!ctx.isTimeoutFailure) {
    const probe = `${ctx.message ?? ""} ${ctx.errorCode ?? ""}`
    ctx.isTimeoutFailure = TIMEOUT_PATTERNS.some((p) => p.test(probe))
  }

  return ctx
}

/** message 或 errorCode 是否指向上下文/token 类失败 */
function matchesContextExhaustion(message?: string, errorCode?: string): boolean {
  const msg = message?.trim() ?? ""
  const code = errorCode?.trim() ?? ""
  if (msg && CONTEXT_MESSAGE_PATTERNS.some((p) => p.test(msg))) return true
  if (code && CONTEXT_ERROR_CODE_PATTERNS.some((p) => p.test(code))) return true
  return false
}

/** peak≥95% limit 且处于 error 态 */
function isContextExhaustedByUsage(
  contextUsed?: number,
  contextLimit?: number | null,
  isError?: boolean,
): boolean {
  if (!isError) return false
  if (contextUsed == null || contextLimit == null || contextLimit <= 0) return false
  return contextUsed / contextLimit >= CONTEXT_EXHAUSTED_RATIO
}

/** 将提取后的上下文映射为 RunFailureReason */
function mapCtxToReason(ctx: CodexFailureContext): RunFailureReason {
  if (ctx.isTimeoutFailure) return "timeout"
  const st = ctx.status?.toUpperCase()
  if (st === "CANCELLED") return "user_cancelled"
  if (st === "EXPIRED") return "session_abnormal"
  const isError =
    st === "ERROR" ||
    st === "FAILED" ||
    (ctx.errorCode != null && ctx.errorCode.trim() !== "") ||
    (ctx.message != null && ctx.message.trim() !== "")
  if (
    matchesContextExhaustion(ctx.message, ctx.errorCode) ||
    isContextExhaustedByUsage(ctx.contextUsed, ctx.contextLimit, isError)
  ) {
    return "context_exhausted"
  }
  if (SESSION_ABNORMAL_PATTERNS.some((p) => p.test(ctx.message ?? "") || p.test(ctx.errorCode ?? ""))) {
    return "session_abnormal"
  }
  return "run_error"
}

/**
 * 映射 Codex 失败为简体中文文案；禁止 stack/路径/apiKey 明文（委托 shared formatter）。
 */
export function formatCodexFailureMessage(error: unknown): string {
  const ctx = extractFailureContext(error)
  return formatRunFailureMessage({
    reason: mapCtxToReason(ctx),
    detail: ctx.message,
    engineLabel: "Agent",
    sdk: {
      status: ctx.status,
      message: ctx.message,
      errorCode: ctx.errorCode,
      isTimeoutFailure: ctx.isTimeoutFailure,
      contextUsed: ctx.contextUsed,
      contextLimit: ctx.contextLimit,
    },
  })
}
