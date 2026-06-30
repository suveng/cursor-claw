/**
 * Codex Run 失败用户可见文案分类器（纯函数，供 agent-codex-sdk notify 路径调用）。
 * 优先级：超时 → 上下文已满 → 会话异常 → 可安全展示 message → 带建议兜底。
 */

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

/** 与 sdk-failure-messages isUnsafeSdkMessage 同等安全规则 */
function isUnsafeCodexMessage(msg?: string): boolean {
  const t = msg?.trim()
  return !t || /[/\\]|\.ts:|at |stack|Error:|ENOENT|spawn|EACCES|EPERM/i.test(t)
}

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

/** 超时类文案（与 sdk-failure-messages 语义对齐） */
function formatTimeoutFailureMessage(ctx: CodexFailureContext): string {
  const msg = ctx.message?.trim()
  if (msg && !isUnsafeCodexMessage(msg)) {
    return `⚠️ Agent 处理失败：${msg}`
  }
  return "会话因等待超时已退出，请重新发送消息，我会继续为你处理。"
}

/**
 * 映射 Codex 失败为简体中文 IM 文案；禁止 stack/路径/apiKey/内部 error 对象。
 * 归因链：timeout → context_exhausted → session_abnormal → safe_message → fallback_actionable
 */
export function formatCodexFailureMessage(error: unknown): string {
  const ctx = extractFailureContext(error)
  const st = ctx.status?.toUpperCase()

  // 1. timeout
  if (ctx.isTimeoutFailure) {
    return formatTimeoutFailureMessage(ctx)
  }

  if (st === "CANCELLED") return "Agent 任务已取消。"

  // EXPIRED 归入 session_abnormal 固定句
  if (st === "EXPIRED") return "Agent 会话已过期，请重新发送消息。"

  const isError =
    st === "ERROR" ||
    st === "FAILED" ||
    (ctx.errorCode != null && ctx.errorCode.trim() !== "") ||
    (ctx.message != null && ctx.message.trim() !== "")

  // 2. context_exhausted
  if (
    matchesContextExhaustion(ctx.message, ctx.errorCode) ||
    isContextExhaustedByUsage(ctx.contextUsed, ctx.contextLimit, isError)
  ) {
    return "⚠️ 上下文窗口已接近或达到上限，请精简需求或开启新话题后重新发送。"
  }

  const msg = ctx.message?.trim() ?? ""
  const code = ctx.errorCode?.trim() ?? ""

  // 3. session_abnormal
  if (SESSION_ABNORMAL_PATTERNS.some((p) => p.test(msg) || p.test(code))) {
    return "Agent 会话异常，请重新发送消息继续对话。"
  }

  // 4. safe_message
  if (msg && !isUnsafeCodexMessage(msg)) {
    return `⚠️ Agent 处理失败：${msg}`
  }

  // 5. fallback_actionable
  return "⚠️ Agent 处理失败，建议精简输入后重新发送；若仍失败请稍后重试。"
}
