/**
 * 斜杠 TTL、COMMANDS、handleCommand 壳与 .fcmd 兼容队列。
 * 顺序：merge 斜杠 → electron 仅入队 → executeSlashCommand → mark → dual 双写。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getQueueDir } from "../bridge/file-queue.js";
import { tryHandleMergeSlashCommand } from "./daemon-merge-command.js";
import { executeSlashCommand, type SlashExecutorDeps } from "./daemon-slash-executor.js";

export type SlashExecMode = "daemon" | "dual" | "electron";

export interface SlashCommandRouterDeps {
  log: (level: string, ...args: unknown[]) => void;
  handleMergeBatchAction: (
    sessionKey: string,
    action: string,
    text?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  replyToMessage: (messageId: string, text: string, chatId?: string) => Promise<void>;
  /** wire 后赋值；未就绪时 handleCommand 回退入队 */
  getSlashExecutorDeps: () => SlashExecutorDeps | null;
}

const COMMANDS: Record<string, string> = {
  "/stop": "停止当前运行中的 Agent",
  "/status": "查看 Agent / Daemon 状态",
  "/list": "查看消息队列列表（不消费）",
  "/task": "定时任务（/task 查看子命令说明；如 /task ls）",
  "/workflow": "工作流管理（/workflow ls | info | create | update | run | resume | status | delete）",
  "/wf": "同 /workflow",
  "/model": "SDK / Claude Code 模型（/model ls | info | set <序号>）",
  "/mcp": "MCP 服务器管理（/mcp ls | info | enable | disable | delete | add）",
  "/workspace": "切换工作目录（/workspace 查看当前 | /workspace set <路径>）",
  "/chat": "会话管理（/chat ls | /chat <序号> | /chat stop <序号> | /chat new <描述> [-dir <路径>]；省略 -dir 用当前主会话目录，无效目录不创建）",
  "/clean": "清空消息队列",
  "/reset": "重置会话上下文（下次拉起为新会话），不删除本地文件",
  "/restart": "重建当前会话 Agent；/restart daemon 全量重启 Daemon",
  "/help": "显示可用指令列表",
  "/merge": "合并控制（/merge send | split | edit <正文>）",
};

/** 稳态默认 daemon；显式 dual|electron 为兼容回滚；非法值回退 daemon */
export function getSlashExecMode(): SlashExecMode {
  const raw = (process.env.SLASH_EXEC_MODE ?? "daemon").trim().toLowerCase();
  if (raw === "daemon" || raw === "dual" || raw === "electron") return raw;
  return "daemon";
}

export function isCommand(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return Object.keys(COMMANDS).some((cmd) => trimmed === cmd || trimmed.startsWith(cmd + " "));
}

/** dual 期 Daemon 已执行 messageId（60s TTL） */
const slashExecutedMessageIds = new Map<string, number>();
const SLASH_EXECUTED_TTL_MS = 60_000;

export function pruneSlashExecutedMessageIds(now = Date.now()): void {
  for (const [id, ts] of slashExecutedMessageIds) {
    if (now - ts > SLASH_EXECUTED_TTL_MS) slashExecutedMessageIds.delete(id);
  }
}

export function markSlashMessageIdExecuted(messageId: string): void {
  if (!messageId) return;
  const now = Date.now();
  slashExecutedMessageIds.set(messageId, now);
  pruneSlashExecutedMessageIds(now);
}

export function isSlashMessageIdExecuted(messageId: string): boolean {
  if (!messageId) return false;
  const ts = slashExecutedMessageIds.get(messageId);
  if (!ts) return false;
  if (Date.now() - ts > SLASH_EXECUTED_TTL_MS) {
    slashExecutedMessageIds.delete(messageId);
    return false;
  }
  return true;
}

export function listSlashExecutedMessageIds(): string[] {
  pruneSlashExecutedMessageIds();
  return [...slashExecutedMessageIds.keys()];
}

export function pushCommandToQueue(
  log: (level: string, ...args: unknown[]) => void,
  command: string,
  messageId: string,
  source: string,
  chatId?: string,
  chatType?: string,
): boolean {
  const queueDir = getQueueDir();
  if (!queueDir) return false;
  const ts = Date.now();
  const safeId = messageId.replace(/[^a-zA-Z0-9_-]/g, "_");
  try {
    const existing = fs.readdirSync(queueDir);
    if (existing.some((f) => f.includes(`_${safeId}.fcmd`))) return false;
  } catch {
    /* ignore */
  }
  try {
    const data = JSON.stringify({ command, messageId, timestamp: ts, source, chatId, chatType });
    const filename = `${ts}_${safeId}.fcmd`;
    const tmpPath = path.join(queueDir, filename + ".tmp");
    const finalPath = path.join(queueDir, filename);
    fs.writeFileSync(tmpPath, data, "utf-8");
    fs.renameSync(tmpPath, finalPath);
    log("INFO", `指令已入队: ${command} (msgId=${messageId}, source=${source})`);
    return true;
  } catch {
    return false;
  }
}

export interface CmdEntry {
  id: string;
  command: string;
  messageId: string;
  chatId?: string;
  chatType?: string;
}

export function getPendingCommands(): CmdEntry[] {
  const queueDir = getQueueDir();
  if (!queueDir) return [];
  try {
    const files = fs.readdirSync(queueDir).filter((f) => f.endsWith(".fcmd")).sort();
    return files
      .map((f) => {
        try {
          const raw = fs.readFileSync(path.join(queueDir, f), "utf-8");
          const p = JSON.parse(raw);
          return {
            id: f,
            command: p.command,
            messageId: p.messageId,
            chatId: p.chatId,
            chatType: p.chatType,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as CmdEntry[];
  } catch {
    return [];
  }
}

export function claimCommand(fileId: string): Omit<CmdEntry, "id"> | null {
  const queueDir = getQueueDir();
  if (!queueDir) return null;
  const srcPath = path.join(queueDir, fileId);
  const claimedPath = srcPath + ".claimed";
  try {
    fs.renameSync(srcPath, claimedPath);
    const raw = fs.readFileSync(claimedPath, "utf-8");
    fs.unlinkSync(claimedPath);
    const p = JSON.parse(raw);
    return {
      command: p.command,
      messageId: p.messageId,
      chatId: p.chatId,
      chatType: p.chatType,
    };
  } catch {
    return null;
  }
}

export function cleanExpiredCommands(
  log: (level: string, ...args: unknown[]) => void,
  replyToMessage: (messageId: string, text: string, chatId?: string) => Promise<void>,
): void {
  const queueDir = getQueueDir();
  if (!queueDir) return;
  const now = Date.now();
  pruneSlashExecutedMessageIds(now);
  try {
    const files = fs.readdirSync(queueDir).filter((f) => f.endsWith(".fcmd"));
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(queueDir, f), "utf-8");
        const parsed = JSON.parse(raw);
        if (now - (parsed.timestamp ?? 0) > 60_000) {
          fs.unlinkSync(path.join(queueDir, f));
          log("WARN", `指令超时已清除: ${parsed.command} (msgId=${parsed.messageId})`);
          if (parsed.messageId) {
            replyToMessage(
              parsed.messageId,
              `⚠️ 指令 ${parsed.command} 执行超时`,
              parsed.chatId,
            ).catch(() => {});
          }
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/** 创建 handleCommand（含 merge / mode / dual 双写） */
export function createSlashCommandRouter(deps: SlashCommandRouterDeps) {
  async function handleCommand(
    text: string,
    messageId: string,
    chatId?: string,
    chatType?: string,
    source?: string,
  ): Promise<void> {
    const trimmed = text.trim();
    if (
      await tryHandleMergeSlashCommand(trimmed, messageId, chatId, {
        log: deps.log,
        handleMergeBatchAction: deps.handleMergeBatchAction,
        replyToMessage: deps.replyToMessage,
      })
    ) {
      return;
    }

    const mode = getSlashExecMode();
    const cmdSource = source ?? `daemon-${process.pid}`;

    if (mode === "electron") {
      pushCommandToQueue(deps.log, trimmed, messageId, cmdSource, chatId, chatType);
      return;
    }

    const slashDeps = deps.getSlashExecutorDeps();
    if (!slashDeps) {
      deps.log("ERROR", "slashExecutorDeps 未初始化，回退入队");
      pushCommandToQueue(deps.log, trimmed, messageId, cmdSource, chatId, chatType);
      return;
    }

    const channelSource = source === "menu" ? "menu" : "im";
    await executeSlashCommand(slashDeps, trimmed, messageId, chatId, chatType, channelSource);
    markSlashMessageIdExecuted(messageId);

    if (mode === "dual") {
      pushCommandToQueue(deps.log, trimmed, messageId, cmdSource, chatId, chatType);
    }
  }

  return {
    handleCommand,
    isCommand,
    getSlashExecMode,
    markSlashMessageIdExecuted,
    isSlashMessageIdExecuted,
    pruneSlashExecutedMessageIds,
    listSlashExecutedMessageIds,
    pushCommandToQueue: (
      command: string,
      messageId: string,
      source: string,
      chatId?: string,
      chatType?: string,
    ) => pushCommandToQueue(deps.log, command, messageId, source, chatId, chatType),
    getPendingCommands,
    claimCommand,
    cleanExpiredCommands: () => cleanExpiredCommands(deps.log, deps.replyToMessage),
    COMMANDS,
  };
}
