/**
 * 合并批次动作（飞书按钮 / /merge 斜杠）用户可见反馈文案 SSOT。
 * 纯函数模块：禁止 import daemon.ts、bridge 等业务模块，供入口层复用。
 */

/** handleMergeBatchAction 现网 error 与用户中文文案映射（与变更设计 §四 一致） */
const MERGE_ACTION_ERROR_TEXT: Readonly<Record<string, string>> = {
  "no merge batch": "当前没有可操作的合并批次",
  "no active merge batch": "当前没有可操作的合并批次",
  "batch not in collecting": "当前没有可操作的合并批次",
  "batch already dispatching": "合并批次正在投递中，请稍候",
  "batch collecting": "合并仍在收集中，请稍候或继续发送消息",
  "text is required for edit": "请使用 `/merge edit <正文>` 或回复合并卡",
  "unknown action": "未知合并操作",
  "messages already claimed": "消息已进入投递流程，暂无法编辑",
  "edit failed": "合并内容更新失败，请稍后重试",
  "invalid input": "合并内容更新失败，请稍后重试",
  "session not found": "合并内容更新失败，请稍后重试",
  "read failed": "合并内容更新失败，请稍后重试",
  "write failed": "合并内容更新失败，请稍后重试",
};

/** 表外或未识别 error 的降级文案 */
const MERGE_ACTION_FALLBACK_ERROR = "操作失败，请稍后重试";

/** 各动作成功时的用户文案 */
const MERGE_ACTION_SUCCESS_TEXT: Readonly<Record<string, string>> = {
  send_now: "立即发送已提交",
  split: "已拆开逐条投递",
  edit: "合并内容已更新",
};

/** 规范化后的合并动作名 */
export type NormalizedMergeAction = "send_now" | "split" | "edit" | "unknown";

/**
 * 剥离 `merge_` 前缀，将按钮 action 或斜杠映射后的 action 规范化为内部动作名。
 * 供日志字段与成功文案分支复用。
 */
export function mergeActionToNormalized(action: string): NormalizedMergeAction {
  const stripped = action.trim().replace(/^merge_/, "");
  if (stripped === "send_now" || stripped === "send") return "send_now";
  if (stripped === "split") return "split";
  if (stripped === "edit") return "edit";
  return "unknown";
}

/**
 * 将 `handleMergeBatchAction` 返回的 `error` 映射为用户可见中文文案。
 * 动态错误（如 `text exceeds N chars`）与表外值降级为友好提示或兜底句。
 */
export function mapMergeActionErrorToUserText(error: string | undefined): string {
  if (!error) return MERGE_ACTION_FALLBACK_ERROR;

  const exact = MERGE_ACTION_ERROR_TEXT[error];
  if (exact) return exact;

  // edit 超长：handleMergeBatchAction 返回 `text exceeds ${MERGE_EDIT_MAX_CHARS} chars`
  if (error.startsWith("text exceeds ") && error.endsWith(" chars")) {
    return "正文过长，请缩短后重试";
  }

  return MERGE_ACTION_FALLBACK_ERROR;
}

/**
 * 根据动作结果与 action 生成完整用户 IM 文案（成功按动作区分，失败走 error 映射）。
 */
export function formatMergeActionUserMessage(
  result: { ok: boolean; error?: string },
  action: string,
): string {
  if (result.ok) {
    const normalized = mergeActionToNormalized(action);
    return MERGE_ACTION_SUCCESS_TEXT[normalized] ?? MERGE_ACTION_FALLBACK_ERROR;
  }
  return mapMergeActionErrorToUserText(result.error);
}
