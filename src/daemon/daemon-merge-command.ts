/**
 * /merge 斜杠命令 Daemon 内闭环：直接调 handleMergeBatchAction，禁止写入 .fcmd。
 */

import { formatMergeActionUserMessage } from "./daemon-merge-action-feedback.js";
import {
  logMergeAction,
  MERGE_ACTION_DEBOUNCED_USER_TEXT,
  shouldIgnoreMergeActionDebounce,
} from "./feishu-card-action.js";

/** 由 daemon 注入的依赖（避免循环 import） */
export interface MergeSlashCommandDeps {
  log: (level: string, ...args: unknown[]) => void;
  handleMergeBatchAction: (
    sessionKey: string,
    action: string,
    text?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  replyToMessage: (messageId: string, text: string, chatId?: string) => Promise<void>;
}

/** 未知子命令时的用法提示 */
const MERGE_SLASH_USAGE =
  "用法：/merge | /merge send | /merge split | /merge edit <正文>";

type MergeSlashParsed =
  | { action: string; editText?: string }
  | "usage";

/**
 * 解析 /merge 斜杠文本为合并 action；不匹配时返回 null。
 * 大小写不敏感前缀；edit 正文保留用户原始大小写。
 */
function parseMergeSlashCommand(text: string): MergeSlashParsed | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "/merge" || lower === "/merge send") {
    return { action: "merge_send_now" };
  }
  if (lower === "/merge split") {
    return { action: "merge_split" };
  }
  if (lower === "/merge edit" || lower.startsWith("/merge edit ")) {
    // 保留 edit 正文原始大小写
    const match = trimmed.match(/^\/merge\s+edit(?:\s+(.*))?$/i);
    const editText = match?.[1]?.trim();
    return { action: "merge_edit", editText: editText || undefined };
  }

  // 以 /merge 开头但子命令未知 → 仍消费，避免落入 .fcmd
  if (lower.startsWith("/merge ")) {
    return "usage";
  }

  return null;
}

/**
 * 尝试处理 /merge 斜杠命令。
 * @returns true 表示已消费（含用法提示），false 表示非 /merge 命令须走原 fcmd 路径
 */
export async function tryHandleMergeSlashCommand(
  text: string,
  messageId: string,
  chatId: string | undefined,
  deps: MergeSlashCommandDeps,
): Promise<boolean> {
  const parsed = parseMergeSlashCommand(text);
  if (parsed === null) return false;

  // chatId 即 sessionKey（与 handleCommand 入参 chatKey 一致）
  if (!chatId) return false;

  if (parsed === "usage") {
    await deps.replyToMessage(messageId, MERGE_SLASH_USAGE, chatId);
    return true;
  }

  const { action, editText } = parsed;

  // 与卡片按钮共用 500ms 防抖表，避免连点或双入口重复驱动
  if (shouldIgnoreMergeActionDebounce(chatId, action)) {
    logMergeAction(deps.log, {
      action,
      session_key: chatId,
      ok: false,
      source: "slash",
      error: "debounced",
    });
    await deps.replyToMessage(messageId, MERGE_ACTION_DEBOUNCED_USER_TEXT, chatId);
    return true;
  }

  try {
    const result = await deps.handleMergeBatchAction(chatId, action, editText);
    logMergeAction(deps.log, {
      action,
      session_key: chatId,
      ok: result.ok,
      source: "slash",
      error: result.error,
    });
    const userMessage = formatMergeActionUserMessage(result, action);
    await deps.replyToMessage(messageId, userMessage, chatId);
    return true;
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    logMergeAction(deps.log, {
      action,
      session_key: chatId,
      ok: false,
      source: "slash",
      error: errMsg,
    });
    const userMessage = formatMergeActionUserMessage({ ok: false }, action);
    await deps.replyToMessage(messageId, userMessage, chatId);
    return true;
  }
}
