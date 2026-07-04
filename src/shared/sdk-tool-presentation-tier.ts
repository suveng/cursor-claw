/**
 * SDK 工具呈现分级 SSOT：决定 tool_call 是否向 IM 出站展示。
 * notify = 需 markProcessEventSeen + postPresentationEvent；silent = 跳过出站。
 */

/** SDK 工具呈现分级：notify 出站通知，silent 静默 */
export type SdkToolPresentationTier = "notify" | "silent";

/** 需向 IM 出站展示的工具名白名单（归一化后小写） */
const NOTIFY_TOOL_NAMES = new Set<string>([
  "shell",
  "write",
  "strreplace",
  "delete",
  "task",
]);

/**
 * 根据工具名解析呈现分级。
 * 归一化：toLowerCase().trim() 后查白名单；命中 notify，否则 silent。
 */
export function resolveSdkToolPresentationTier(toolName: string): SdkToolPresentationTier {
  const normalized = toolName.toLowerCase().trim();
  return NOTIFY_TOOL_NAMES.has(normalized) ? "notify" : "silent";
}
