/**
 * 未知 rejection/exception 的共享诊断格式化（electron 主进程与 daemon 全局 handler 复用）。
 */

/** JSON 序列化上限（字符） */
const MAX_JSON_CHARS = 2048;

/** 敏感键名匹配（大小写不敏感） */
const SENSITIVE_KEY_RE = /token|password|authorization|secret|apikey|api_key|cookie/i;

/** gRPC / Node / SDK 常见诊断字段提取顺序 */
const DIAGNOSTIC_KEYS = [
  "code",
  "details",
  "message",
  "errno",
  "syscall",
  "name",
  "status",
  "errorCode",
  "metadata",
  "cause",
] as const;

export interface FormatUnknownErrorOptions {
  /** 附加 handler 注册点 stack 帧，便于区分全局捕获与业务抛出 */
  includeRegistrationHint?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key);
}

/** 脱敏对象键后返回浅拷贝 */
function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = isSensitiveKey(k) ? "[redacted]" : v;
  }
  return out;
}

/** 安全 JSON 序列化：脱敏、循环引用标记、超长截断 */
function safeJsonStringify(obj: unknown, maxLen = MAX_JSON_CHARS): string {
  const seen = new WeakSet<object>();
  let json: string;
  try {
    json = JSON.stringify(obj, (key, val) => {
      if (key && isSensitiveKey(key)) return "[redacted]";
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      return val;
    });
  } catch {
    return String(obj);
  }
  if (!json) return String(obj);
  if (json.length <= maxLen) return json;
  return `${json.slice(0, maxLen)}…[truncated ${json.length - maxLen} chars]`;
}

/** 取 stack 首条 at 行（跳过 Error: message 标题行） */
function firstStackLine(stack?: string): string | undefined {
  if (!stack) return undefined;
  const lines = stack
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const atLine = lines.find((l) => l.startsWith("at "));
  return atLine ?? lines[1];
}

/** 捕获当前调用栈若干帧，标注为 handler 注册点 */
function formatRegistrationHint(): string {
  const stack = new Error().stack;
  if (!stack) return "";
  const frames = stack
    .split(/\r?\n/)
    .slice(1, 5)
    .map((l) => l.trim())
    .filter(Boolean);
  if (frames.length === 0) return "";
  return ` | 注册点: ${frames.join(" ⏎ ")}`;
}

/** 递归格式化 cause 字段（避免无限嵌套） */
function formatCause(cause: unknown, depth = 0): string {
  if (cause == null || depth > 2) return "";
  const sub = formatUnknownErrorInner(cause);
  return sub ? `cause=${sub}` : "";
}

/** 格式化 gRPC metadata 等附属结构 */
function formatMetadata(metadata: unknown): string {
  if (metadata == null) return "";
  if (isPlainObject(metadata) || Array.isArray(metadata)) {
    return `metadata=${safeJsonStringify(metadata, 512)}`;
  }
  return `metadata=${String(metadata)}`;
}

/** 从 plain object 提取已知诊断字段；无匹配时退化为脱敏 JSON */
function formatRecordFields(rec: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of DIAGNOSTIC_KEYS) {
    if (!(key in rec)) continue;
    const val = rec[key];
    if (val == null) continue;
    if (key === "cause") {
      const c = formatCause(val);
      if (c) parts.push(c);
      continue;
    }
    if (key === "metadata") {
      const m = formatMetadata(val);
      if (m) parts.push(m);
      continue;
    }
    if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      parts.push(`${key}=${val}`);
    } else if (val instanceof Error) {
      parts.push(`${key}=${formatUnknownErrorInner(val)}`);
    } else {
      parts.push(`${key}=${safeJsonStringify(val, 256)}`);
    }
  }
  if (parts.length > 0) return parts.join(" | ");
  return safeJsonStringify(redactObject(rec));
}

/** gRPC StatusCode 常用映射（connect/grpc-js） */
const GRPC_STATUS_NAMES: Record<number, string> = {
  0: "OK",
  1: "CANCELLED",
  2: "UNKNOWN",
  3: "INVALID_ARGUMENT",
  4: "DEADLINE_EXCEEDED",
  5: "NOT_FOUND",
  6: "ALREADY_EXISTS",
  7: "PERMISSION_DENIED",
  8: "RESOURCE_EXHAUSTED",
  9: "FAILED_PRECONDITION",
  10: "ABORTED",
  11: "OUT_OF_RANGE",
  12: "UNIMPLEMENTED",
  13: "INTERNAL",
  14: "UNAVAILABLE",
  15: "DATA_LOSS",
  16: "UNAUTHENTICATED",
}

/** Connect 网络读超时等场景：将部分码归一为 UNAVAILABLE 展示 */
const GRPC_STATUS_DISPLAY_ALIASES: Record<number, string> = {
  2: "UNAVAILABLE",
  14: "UNAVAILABLE",
}

/** ConnectError / connect-js 抛出的 Error 形态 */
type ConnectErrorLike = Error & {
  code?: string | number
  rawMessage?: string
}

function isConnectErrorLike(err: Error): boolean {
  const rec = err as ConnectErrorLike
  if (err.name === "ConnectError") return true
  if (/^\[unknown\]/i.test(err.message)) return true
  if (typeof rec.rawMessage === "string" && rec.rawMessage.length > 0) return true
  if (typeof rec.code === "number" && Number.isFinite(rec.code)) return true
  return false
}

/** 去掉 ConnectError message 开头的 [unknown]/[unavailable] 前缀 */
function stripConnectErrorMessagePrefix(message: string): string {
  return message.replace(/^(?:\[(?:unknown|unavailable)\]\s*)+/i, "").trim()
}

/** 数字 gRPC code → 展示名（含业务别名） */
function resolveGrpcStatusDisplayName(code: number): string {
  return GRPC_STATUS_DISPLAY_ALIASES[code] ?? GRPC_STATUS_NAMES[code] ?? `CODE_${code}`
}

/** 格式化 ConnectError：UNAVAILABLE read ETIMEDOUT | code=14 | … */
function formatConnectError(err: ConnectErrorLike): string {
  const raw = err.rawMessage ?? err.message
  const body = stripConnectErrorMessagePrefix(raw)
  const codeNum = typeof err.code === "number" && Number.isFinite(err.code) ? err.code : undefined
  const parts: string[] = []
  if (codeNum != null) parts.push(resolveGrpcStatusDisplayName(codeNum))
  parts.push(body || err.name || "ConnectError")
  if (codeNum != null) parts.push(`code=${codeNum}`)
  const errno = (err as Error & { errno?: number }).errno
  if (errno != null) parts.push(`errno=${errno}`)
  const syscall = (err as Error & { syscall?: string }).syscall
  if (syscall) parts.push(`syscall=${syscall}`)
  const stackLine = firstStackLine(err.stack)
  if (stackLine) parts.push(stackLine)
  if ("cause" in err && err.cause != null) {
    const c = formatCause(err.cause)
    if (c) parts.push(c)
  }
  return parts.join(" | ")
}

/** 内部格式化（不含注册点 hint，供 cause 递归） */
function formatUnknownErrorInner(reason: unknown): string {
  if (reason == null) return String(reason);

  if (
    typeof reason === "string" ||
    typeof reason === "number" ||
    typeof reason === "boolean" ||
    typeof reason === "bigint"
  ) {
    return String(reason);
  }

  if (reason instanceof Error) {
    if (isConnectErrorLike(reason)) {
      return formatConnectError(reason as ConnectErrorLike);
    }
    const err = reason as Error & { code?: string | number; errno?: number; syscall?: string };
    const parts: string[] = [err.message || err.name || "Error"];
    if (err.code != null) parts.push(`code=${err.code}`);
    if (err.errno != null) parts.push(`errno=${err.errno}`);
    if (err.syscall) parts.push(`syscall=${err.syscall}`);
    const stackLine = firstStackLine(err.stack);
    if (stackLine) parts.push(stackLine);
    if ("cause" in err && err.cause != null) {
      const c = formatCause(err.cause);
      if (c) parts.push(c);
    }
    return parts.join(" | ");
  }

  if (typeof reason === "object") {
    if (Array.isArray(reason)) return safeJsonStringify(reason);
    return formatRecordFields(reason as Record<string, unknown>);
  }

  return String(reason);
}

/**
 * 将 unknown rejection/exception 格式化为单行可诊断字符串。
 * Error、gRPC-like 对象、plain object、原始值均覆盖。
 */
export function formatUnknownError(
  reason: unknown,
  options?: FormatUnknownErrorOptions,
): string {
  const base = formatUnknownErrorInner(reason);
  return options?.includeRegistrationHint ? base + formatRegistrationHint() : base;
}
