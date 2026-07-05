/**
 * edit/write/delete 工具呈现：完成态出站、文件路径解析与里程碑文案。
 */

/** 飞书里程碑文案中的文件路径字段 */
export interface ToolFileEditPresentationFields {
  tool_file_path: string;
}

/** 仅完成态出站的 notify 工具（edit/write/delete） */
export const COMPLETION_ONLY_NOTIFY_TOOL_NAMES = new Set<string>(["strreplace", "write", "delete"]);

/** 文件编辑类 canonical 名（避免与 tool-presentation 循环依赖） */
function canonicalFileEditToolName(toolName: string): string {
  const lower = toolName.trim().toLowerCase();
  if (lower === "edit" || lower === "strreplace") return "strreplace";
  if (lower === "write") return "write";
  if (lower === "delete") return "delete";
  return lower;
}

/** 文件编辑类工具是否抑制 started 出站（仍 POST 事件供 ordering，IM 由 daemon 跳过） */
export function shouldSuppressToolStartedPresentation(canonicalToolName: string): boolean {
  return COMPLETION_ONLY_NOTIFY_TOOL_NAMES.has(canonicalToolName);
}

/** 里程碑展示用工具名（strreplace → edit） */
export function getToolMilestoneDisplayName(canonicalToolName: string): string {
  if (canonicalToolName === "strreplace") return "edit";
  return canonicalToolName;
}

/** 解析 edit/write/delete 工具 args 中的目标文件路径 */
export function parseFileEditToolArgs(args: unknown): { filePath: string } | undefined {
  if (!args || typeof args !== "object") return undefined;
  const rec = args as Record<string, unknown>;
  for (const key of ["file_path", "path", "filePath", "target_file"]) {
    const value = rec[key];
    if (typeof value === "string" && value.trim()) return { filePath: value.trim() };
  }
  return undefined;
}

/** SDK/CC file edit 工具 → presentation-event 文件路径字段 */
export function extractFileEditPresentationFields(
  toolName: string,
  _status: "running" | "completed" | "error",
  args?: unknown,
  cachedFilePath?: string,
): ToolFileEditPresentationFields | undefined {
  const canonical = canonicalFileEditToolName(toolName);
  if (!COMPLETION_ONLY_NOTIFY_TOOL_NAMES.has(canonical)) return undefined;
  const filePath = parseFileEditToolArgs(args)?.filePath ?? cachedFilePath?.trim();
  if (!filePath) return undefined;
  return { tool_file_path: filePath };
}

/** 单行截断（与 tool-presentation 里程碑上限一致） */
function truncateText(text: string, max: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max)} …(+${compact.length - max} chars)`;
}

/** edit/write/delete 完成态里程碑文案 */
export function formatFileEditToolMilestoneText(
  canonicalToolName: string,
  status: "started" | "completed" | "failed",
  filePath: string | undefined,
  maxLen: number,
): string | undefined {
  if (!COMPLETION_ONLY_NOTIFY_TOOL_NAMES.has(canonicalToolName)) return undefined;
  const displayName = getToolMilestoneDisplayName(canonicalToolName);
  const path = filePath?.trim();
  if (status === "completed") {
    if (path) return `${displayName}完成：${truncateText(path, maxLen)}`;
    return `${displayName}完成`;
  }
  if (status === "failed") {
    if (path) return `${displayName}失败：${truncateText(path, maxLen)}`;
    return `${displayName}失败`;
  }
  if (status === "started") return `${displayName}：已开始`;
  return undefined;
}
