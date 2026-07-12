/**
 * 飞书合并卡按钮回调路由（card.action.trigger → handleMergeBatchAction）。
 * 禁止在本模块操作队列 ack/claim 或改写 MergeBatch phase 规则（R5 边界）。
 */

import type {
  FeishuCardActionEvent,
  FeishuCardActionToastResponse,
  LarkSender,
} from "../bridge/lark-core.js";
import type { FeishuHandlerRuntime } from "./feishu-event-handlers.js";
import { formatMergeActionUserMessage } from "./daemon-merge-action-feedback.js";

/** 合并卡三枚按钮 action 白名单 */
const MERGE_CARD_ACTIONS = new Set(["merge_send_now", "merge_split", "merge_edit"]);

/** 编辑按钮无内联正文时的 F3 引导文案（与 02-design §二第 4 点一致） */
const MERGE_EDIT_GUIDE_TEXT = "请直接回复本合并卡发送修改后的全文";

/** 同 session 同 action 连点防抖窗口（毫秒）；仅入口层友好提示，不改 MergeBatch phase */
const MERGE_ACTION_DEBOUNCE_MS = 500;

/** 防抖命中时的用户可见文案（按钮与 /merge 双入口共用） */
export const MERGE_ACTION_DEBOUNCED_USER_TEXT = "操作过于频繁，请稍后再试";

/** 进程内防抖表：sessionKey + action → 上次执行时间戳 */
const mergeActionDebounceBySession = new Map<string, number>();

/** merge_action 结构化日志字段（双入口统一形态） */
export interface MergeActionLogEntry {
  action: string;
  session_key: string;
  ok: boolean;
  source: "button" | "slash";
  error?: string;
}

/**
 * 500ms 内同 session 同 action 的重复请求应忽略（不调用 handleMergeBatchAction）。
 * 首次请求写入时间戳；命中防抖返回 true。
 */
export function shouldIgnoreMergeActionDebounce(sessionKey: string, action: string): boolean {
  const debounceKey = `${sessionKey}\0${action}`;
  const now = Date.now();
  const lastAt = mergeActionDebounceBySession.get(debounceKey);
  if (lastAt !== undefined && now - lastAt < MERGE_ACTION_DEBOUNCE_MS) {
    return true;
  }
  mergeActionDebounceBySession.set(debounceKey, now);
  return false;
}

/** 输出可 grep 的 merge_action 结构化日志 */
export function logMergeAction(
  log: (level: string, ...args: unknown[]) => void,
  entry: MergeActionLogEntry,
): void {
  log("INFO", "merge_action", entry);
}

/** 由 daemon 注入的依赖（避免循环 import） */
export interface FeishuCardActionDeps {
  log: (level: string, ...args: unknown[]) => void;
  makeChatKey: (channelId: string, rawChatId: string) => string;
  handleMergeBatchAction: (
    sessionKey: string,
    action: string,
    text?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  replyToMessage: (messageId: string, text: string, chatId?: string) => Promise<void>;
}

/** 判断是否为合并卡按钮 action */
function isMergeCardAction(action: string): boolean {
  return MERGE_CARD_ACTIONS.has(action.trim());
}

/** 从按钮 value 提取可选内联编辑正文（当前卡面未带表单，预留扩展） */
function extractInlineEditText(rawValue?: Record<string, unknown>): string | undefined {
  if (!rawValue) return undefined;
  const candidate = rawValue.text ?? rawValue.content ?? rawValue.body;
  if (typeof candidate !== "string") return undefined;
  const trimmed = candidate.trim();
  return trimmed || undefined;
}

/** 构造飞书卡片回调 toast */
function buildToast(content: string, type: string): FeishuCardActionToastResponse {
  return { toast: { type, content } };
}

/** 经 IM 补充用户可感知反馈；失败仅打 WARN，不阻断 callback 返回 */
async function tryReplyUserMessage(
  deps: FeishuCardActionDeps,
  channelName: string,
  sessionKey: string,
  text: string,
): Promise<void> {
  try {
    // 卡片点击无 inbound messageId；第三参 sessionKey 走 sendMessage 路径
    await deps.replyToMessage("", text, sessionKey);
  } catch (e: unknown) {
    deps.log(
      "WARN",
      `[${channelName}] 合并卡动作 IM 反馈发送失败: ${e instanceof Error ? e.message : e}`,
    );
  }
}

/**
 * 处理飞书 card.action.trigger：解析 sessionKey，调用合并控制 SSOT，返回 toast。
 */
export async function onFeishuCardAction(
  rt: FeishuHandlerRuntime,
  _sender: LarkSender,
  ev: FeishuCardActionEvent,
  deps: FeishuCardActionDeps,
): Promise<FeishuCardActionToastResponse | void> {
  const action = ev.action.trim();
  if (!isMergeCardAction(action)) {
    deps.log("WARN", `[${rt.cfg.name}] 忽略未知卡片动作 action=${action} openId=${ev.openId}`);
    return;
  }

  const openChatId = ev.openChatId.trim();
  if (!openChatId) {
    deps.log("WARN", `[${rt.cfg.name}] 合并卡动作缺少 openChatId action=${action}`);
    return buildToast("无法识别会话，请稍后重试", "error");
  }

  const sessionKey = deps.makeChatKey(rt.cfg.id, openChatId);

  // 编辑无内联正文：仅引导回复合并卡，不调用 handleMergeBatchAction（F3 路径）
  if (action === "merge_edit") {
    const inlineText = extractInlineEditText(ev.rawValue);
    if (!inlineText) {
      await tryReplyUserMessage(deps, rt.cfg.name, sessionKey, MERGE_EDIT_GUIDE_TEXT);
      return buildToast(MERGE_EDIT_GUIDE_TEXT, "info");
    }
  }

  const editText = action === "merge_edit" ? extractInlineEditText(ev.rawValue) : undefined;

  // 双入口共用防抖：连点或按钮后立即 /merge 时仅友好提示，不重复驱动状态机
  if (shouldIgnoreMergeActionDebounce(sessionKey, action)) {
    logMergeAction(deps.log, {
      action,
      session_key: sessionKey,
      ok: false,
      source: "button",
      error: "debounced",
    });
    await tryReplyUserMessage(deps, rt.cfg.name, sessionKey, MERGE_ACTION_DEBOUNCED_USER_TEXT);
    return buildToast(MERGE_ACTION_DEBOUNCED_USER_TEXT, "info");
  }

  try {
    const result = await deps.handleMergeBatchAction(sessionKey, action, editText);
    logMergeAction(deps.log, {
      action,
      session_key: sessionKey,
      ok: result.ok,
      source: "button",
      error: result.error,
    });
    const userMessage = formatMergeActionUserMessage(result, action);
    await tryReplyUserMessage(deps, rt.cfg.name, sessionKey, userMessage);
    return buildToast(userMessage, result.ok ? "success" : "error");
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    logMergeAction(deps.log, {
      action,
      session_key: sessionKey,
      ok: false,
      source: "button",
      error: errMsg,
    });
    const userMessage = formatMergeActionUserMessage({ ok: false }, action);
    deps.log(
      "ERROR",
      `[${rt.cfg.name}] 合并卡动作执行异常 action=${action} session=${sessionKey}: ${errMsg}`,
    );
    await tryReplyUserMessage(deps, rt.cfg.name, sessionKey, userMessage);
    return buildToast(userMessage, "error");
  }
}
