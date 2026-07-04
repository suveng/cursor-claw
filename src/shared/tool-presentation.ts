/** 工具 Presentation：shell 命令解析与 CardKit markdown 渲染 */

export const TOOL_LOG_DETAIL_MAX = 400;
export const TOOL_CARD_SHELL_OUTPUT_MAX = 800;
/** 飞书里程碑单行文案上限（区别于 CardKit 输出块截断） */
export const TOOL_MILESTONE_TEXT_MAX = 120;

export interface ShellToolDetail {
  command: string;
  cwd?: string;
  output?: string;
}

export interface ToolShellPresentationFields {
  tool_shell_command: string;
  tool_shell_cwd?: string;
  tool_shell_output?: string;
}

/** Task 工具 presentation-event 描述字段 */
export interface ToolTaskPresentationFields {
  tool_task_description: string;
}

/** 飞书里程碑文案可选详情（shell 命令 / task 描述） */
export interface ToolMilestoneDetail {
  tool_shell_command?: string;
  tool_shell_cwd?: string;
  tool_task_description?: string;
}

function truncateText(text: string, max: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max)} …(+${compact.length - max} chars)`;
}

/** 解析 shell 工具 args 中的 command / working_directory */
export function parseShellToolArgs(args: unknown): Pick<ShellToolDetail, "command" | "cwd"> | undefined {
  if (!args || typeof args !== "object") return undefined;
  const rec = args as Record<string, unknown>;
  const command = typeof rec.command === "string" ? rec.command.trim() : "";
  if (!command) return undefined;
  const cwd = typeof rec.working_directory === "string" ? rec.working_directory.trim() : "";
  return { command, cwd: cwd || undefined };
}

/** 解析 shell 工具 result 中的 stdout/stderr/output */
export function parseShellToolResult(result: unknown): string | undefined {
  if (result == null) return undefined;
  if (typeof result === "string") {
    const text = result.trim();
    return text || undefined;
  }
  if (typeof result === "object") {
    const rec = result as Record<string, unknown>;
    const stdout = typeof rec.stdout === "string" ? rec.stdout : "";
    const stderr = typeof rec.stderr === "string" ? rec.stderr : "";
    const output = typeof rec.output === "string" ? rec.output : "";
    const combined = [stdout, stderr, output].filter((part) => part.trim()).join("\n").trim();
    if (combined) return combined;
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }
  return String(result);
}

function escapeCodeFenceContent(text: string): string {
  return text.replace(/```/g, "\\`\\`\\`");
}

function escapeFeishuMarkdown(text: string): string {
  return text.replace(/\\/g, "\\\\");
}

/** shell 工具 CardKit 正文：命令用 ```shell，输出用普通代码块 */
export function buildShellToolCardMarkdown(
  status: "started" | "completed" | "failed",
  detail: ShellToolDetail,
): string {
  const statusLabel = status === "completed" ? "已完成" : status === "failed" ? "失败" : "执行中…";
  const parts = ["🔧 **shell**", `状态：${statusLabel}`];
  if (detail.cwd?.trim()) {
    parts.push(`目录：\`${detail.cwd.trim().replace(/`/g, "\\`")}\``);
  }
  parts.push(`\`\`\`shell\n${escapeCodeFenceContent(detail.command.trim())}\n\`\`\``);
  if (detail.output?.trim() && status !== "started") {
    const raw = detail.output.trim();
    const output = raw.length > TOOL_CARD_SHELL_OUTPUT_MAX
      ? `${raw.slice(0, TOOL_CARD_SHELL_OUTPUT_MAX)} …(+${raw.length - TOOL_CARD_SHELL_OUTPUT_MAX} chars)`
      : raw;
    parts.push(`\`\`\`\n${escapeCodeFenceContent(output)}\n\`\`\``);
  }
  return escapeFeishuMarkdown(parts.join("\n"));
}

/** SDK tool_call → presentation-event 的 shell 字段 */
export function extractShellPresentationFields(
  toolName: string,
  status: "running" | "completed" | "error",
  args?: unknown,
  result?: unknown,
): ToolShellPresentationFields | undefined {
  if (toolName !== "shell") return undefined;
  const parsed = parseShellToolArgs(args);
  if (!parsed?.command) return undefined;
  const fields: ToolShellPresentationFields = { tool_shell_command: parsed.command };
  if (parsed.cwd) fields.tool_shell_cwd = parsed.cwd;
  if (status !== "running") {
    const output = parseShellToolResult(result);
    if (output) fields.tool_shell_output = truncateText(output, TOOL_CARD_SHELL_OUTPUT_MAX);
  }
  return fields;
}

/** 解析 Task 工具 args 中的 description */
export function parseTaskToolArgs(args: unknown): Pick<ToolTaskPresentationFields, "tool_task_description"> | undefined {
  if (!args || typeof args !== "object") return undefined;
  const rec = args as Record<string, unknown>;
  const description = typeof rec.description === "string" ? rec.description.trim() : "";
  if (!description) return undefined;
  return { tool_task_description: description };
}

/** SDK task 工具 tool_call → presentation-event 的描述字段 */
export function extractTaskPresentationFields(
  toolName: string,
  _status: "running" | "completed" | "error",
  args?: unknown,
): ToolTaskPresentationFields | undefined {
  if (toolName !== "task") return undefined;
  const parsed = parseTaskToolArgs(args);
  if (!parsed?.tool_task_description) return undefined;
  return { tool_task_description: parsed.tool_task_description };
}

/** 日志单行：tool args/result 摘要 */
export function stringifyToolPayload(value: unknown, max = TOOL_LOG_DETAIL_MAX): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return truncateText(value, max);
  if (typeof value === "object") {
    const parsed = parseShellToolArgs(value);
    if (parsed) {
      const parts = [`command=${parsed.command}`];
      if (parsed.cwd) parts.push(`cwd=${parsed.cwd}`);
      return truncateText(parts.join(" "), max);
    }
    // task 工具：日志优先展示 description，与飞书里程碑字段对齐
    const taskParsed = parseTaskToolArgs(value);
    if (taskParsed?.tool_task_description) {
      return truncateText(`description=${taskParsed.tool_task_description}`, max);
    }
    try {
      return truncateText(JSON.stringify(value), max);
    } catch {
      return truncateText(String(value), max);
    }
  }
  return truncateText(String(value), max);
}

export function formatToolCallLogSuffix(
  status: "running" | "completed" | "error",
  args?: unknown,
  result?: unknown,
  truncated?: { args?: boolean; result?: boolean },
): string {
  const parts: string[] = [];
  const argsText = stringifyToolPayload(args);
  if (argsText) parts.push(`args=${argsText}${truncated?.args ? " (truncated)" : ""}`);
  if (status !== "running") {
    const resultText = stringifyToolPayload(result);
    if (resultText) parts.push(`result=${resultText}${truncated?.result ? " (truncated)" : ""}`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

/** presentation-event tool_status → 里程碑中文状态标签 */
function toolMilestoneStatusLabel(status: "started" | "completed" | "failed"): string {
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  return "已开始";
}

/**
 * notify 级工具飞书里程碑单行文案 SSOT（含 shell 命令 / task 描述摘要）
 * shell started 优先展示具体命令；task started 优先展示 description；禁止裸 `` tool：已开始 ``
 */
export function formatToolMilestoneText(
  toolName: string,
  status: "started" | "completed" | "failed",
  detail?: ToolMilestoneDetail,
): string {
  const command = detail?.tool_shell_command?.trim();
  const taskDesc = detail?.tool_task_description?.trim();
  const statusLabel = toolMilestoneStatusLabel(status);

  if (toolName === "shell") {
    if (status === "started") {
      if (command) {
        return `执行命令：${truncateText(command, TOOL_MILESTONE_TEXT_MAX)}`;
      }
      return "命令执行已开始（具体命令暂不可展示）";
    }
    // completed/failed：仍保留命令摘要，便于与 started 里程碑对照
    if (command) {
      return `执行命令：${truncateText(command, TOOL_MILESTONE_TEXT_MAX)}（${statusLabel}）`;
    }
    return `shell：${statusLabel}`;
  }

  if (toolName === "task") {
    if (status === "started") {
      if (taskDesc) {
        return `正在执行：${truncateText(taskDesc, TOOL_MILESTONE_TEXT_MAX)}`;
      }
      return "子任务已开始（描述暂不可展示）";
    }
    if (taskDesc) {
      return `正在执行：${truncateText(taskDesc, TOOL_MILESTONE_TEXT_MAX)}（${statusLabel}）`;
    }
    return `task：${statusLabel}`;
  }

  return `${toolName}：${statusLabel}`;
}

/** 合并 event 与已缓存卡片的 shell 详情，供 PATCH 时使用 */
export function mergeShellToolDetail(
  event: ToolShellPresentationFields | undefined,
  cached?: Partial<Pick<ShellToolDetail, "command" | "cwd" | "output">>,
): ShellToolDetail | undefined {
  const command = event?.tool_shell_command?.trim() || cached?.command?.trim();
  if (!command) return undefined;
  return {
    command,
    cwd: event?.tool_shell_cwd?.trim() || cached?.cwd,
    output: event?.tool_shell_output?.trim() || cached?.output,
  };
}
