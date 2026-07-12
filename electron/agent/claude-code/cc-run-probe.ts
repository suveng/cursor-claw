/**
 * Claude Code recover 续接前终态探活（对称 Cursor getRun 语义，读盘轻量）
 */
import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk"
import type { CcActiveRunRecord } from "./cc-run-persistence"

/**
 * 续接前探测 ccSessionId 是否仍存在于 SDK 会话存储。
 * 无 ccSessionId 或探活通过：no-op；不可续则 throw（recover 侧 classify + notify）。
 */
export async function probeCcRecoverTarget(record: CcActiveRunRecord): Promise<void> {
  if (!record.ccSessionId) return

  const workspaceDir = record.workspaceDir || process.cwd()
  // ponytail: getSessionInfo 仅校验会话文件存在性，非 Run 运行时态；
  // 升级路径：若 Claude SDK 暴露等价 getRun 只读 API 可替换。
  const info = await getSessionInfo(record.ccSessionId, { dir: workspaceDir })
  if (!info) {
    throw new Error("CC session 不存在或已结束")
  }
}
