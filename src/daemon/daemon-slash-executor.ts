/**
 * Daemon 斜杠指令 SSOT：本地可完成指令进程内执行，其余同步转发 Electron command API。
 */
import { buildHelpText } from "../shared/feishu-help-text.js";
import { executeSlashMcp } from "./daemon-slash-mcp.js";

/** 队列消息预览（/list 用） */
export interface SlashQueueMessageView {
  index: number;
  preview: string;
}

/** 斜杠执行器依赖（由 daemon.ts wireDaemonSubmodules 注入，T5 接线） */
export interface SlashExecutorDeps {
  log: (level: string, ...args: unknown[]) => void;
  replyToMessage: (messageId: string, text: string, chatId?: string) => Promise<void>;
  forwardElectronCommandApi: (
    subpath: string,
    body: object,
  ) => Promise<{ ok: boolean; error?: string; message?: string }>;
  getSlashExecMode?: () => string;
  workspaceDir: string;
  pkgVersion: string;
  getUptime: () => number;
  getFileQueueLength: () => number;
  getFileQueueMessages: () => SlashQueueMessageView[];
  clearFileQueue: () => number;
  readTasks: () => Array<{ enabled: boolean }>;
  /** agent-api-port.json 可读且 port>0 */
  isElectronApiReachable: () => boolean;
}

type SlashSource = "skip" | "local" | "mcp" | "electron";

/** T8 划界：/merge 与 merge_* 前缀不进入通用执行器 */
function shouldSkipSlashCommand(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return lower === "/merge" || lower.startsWith("/merge ") || lower.startsWith("merge_");
}

/** 结构化 slash_exec 日志 */
function logSlashExec(
  deps: SlashExecutorDeps,
  fields: { command: string; message_id: string; mode: string; ok: boolean; source: SlashSource },
): void {
  deps.log("INFO", `slash_exec ${JSON.stringify(fields)}`);
}

/** 主进程未就绪时的统一中文提示 */
function formatElectronUnavailableMessage(fallback?: string): string {
  if (fallback?.trim()) return fallback;
  return "❌ 应用未运行，请先启动 Cursor Claw";
}

/** 构建 Daemon 本地 /status 文案 */
function buildLocalStatusText(deps: SlashExecutorDeps): string {
  const tasks = deps.readTasks();
  const schedTotal = tasks.length;
  const schedEnabled = tasks.filter((t) => t.enabled).length;
  const agentLine = deps.isElectronApiReachable() ? "✅ 主进程已连接" : "❌ 未运行";
  return [
    "🛡️ Daemon: ✅ 运行中",
    `🔄 版本: ${deps.pkgVersion}`,
    `⌛️ 运行时间: ${Math.floor(deps.getUptime() / 60)}分钟`,
    `🤖 Agent: ${agentLine}`,
    `📭 队列消息: ${deps.getFileQueueLength()} 条`,
    `⏰ 定时任务: 开启 ${schedEnabled} / 共 ${schedTotal} 条`,
  ].join("\n");
}

/** Daemon 可本地完成的斜杠指令集合 */
function isDaemonLocalCommand(head: string): boolean {
  return head === "/help" || head === "/status" || head === "/list" || head === "/clean";
}

/**
 * 执行单条斜杠指令并 replyToMessage（IM 斜杠 SSOT；T5 由 handleCommand 调用）。
 */
export async function executeSlashCommand(
  deps: SlashExecutorDeps,
  text: string,
  messageId: string,
  chatId?: string,
  chatType?: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || shouldSkipSlashCommand(trimmed)) {
    logSlashExec(deps, {
      command: trimmed.split(/\s+/)[0] ?? trimmed,
      message_id: messageId,
      mode: deps.getSlashExecMode?.() ?? "daemon",
      ok: true,
      source: "skip",
    });
    return;
  }

  const head = (trimmed.split(/\s+/)[0] ?? "").toLowerCase();
  const mode = deps.getSlashExecMode?.() ?? "daemon";
  let ok = false;
  let message = "";
  let source: SlashSource = "electron";

  try {
    if (head === "/mcp") {
      source = "mcp";
      const mcpResult = await executeSlashMcp(deps, trimmed);
      ok = mcpResult.ok;
      message = mcpResult.message;
    } else if (isDaemonLocalCommand(head)) {
      source = "local";
      if (head === "/help") {
        ok = true;
        message = buildHelpText();
      } else if (head === "/status") {
        ok = true;
        message = buildLocalStatusText(deps);
      } else if (head === "/list") {
        const msgs = deps.getFileQueueMessages();
        if (msgs.length === 0) {
          ok = true;
          message = "📭 消息队列为空";
        } else {
          const lines = msgs.map((m) => `  [${m.index}] ${m.preview}`);
          ok = true;
          message = `📬 队列中有 ${msgs.length} 条消息：\n${lines.join("\n")}`;
        }
      } else if (head === "/clean") {
        const cleared = deps.clearFileQueue();
        ok = true;
        message = `✅ 已清空消息队列，共移除 ${cleared} 条`;
      }
    } else {
      source = "electron";
      const fwd = await deps.forwardElectronCommandApi("/api/command/execute", {
        command: trimmed,
        messageId,
        chatId,
        chatType,
      });
      ok = fwd.ok;
      message = fwd.message ?? fwd.error ?? formatElectronUnavailableMessage();
      if (!fwd.ok && !message.includes("应用未运行") && !fwd.message) {
        message = formatElectronUnavailableMessage(fwd.error);
      }
    }
  } catch (e: unknown) {
    ok = false;
    message = `❌ 执行异常: ${e instanceof Error ? e.message : String(e)}`;
    deps.log("ERROR", `slash_exec_error command=${head} msgId=${messageId} err=${message}`);
  }

  await deps.replyToMessage(messageId, message, chatId);
  logSlashExec(deps, { command: head, message_id: messageId, mode, ok, source });
}
