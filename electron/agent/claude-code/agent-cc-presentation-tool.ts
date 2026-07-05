/**
 * Claude Code 工具呈现分级、去重与 presentation-event 出站（对称 sdk-run-stream tool_call）。
 */
import { pushUiLog } from "../../app/ui-logger"
import { mapToolPresentationStatus } from "../cursor-sdk/sdk-run-presentation"
import {
  clearToolCallRunningDedup,
  isDuplicateToolCallRunning,
} from "../shared/tool-presentation-dedup.js"
import { resolveSdkToolPresentationTier } from "../../../src/shared/sdk-tool-presentation-tier.js"
import {
  extractFileEditPresentationFields,
  extractShellPresentationFields,
  extractTaskPresentationFields,
  formatToolCallLogSuffix,
  normalizePresentationToolName,
  type ToolTaskPresentationFields,
} from "../../../src/shared/tool-presentation.js"
import type { CcSessionAgent } from "./agent-cc-types"
import {
  closeThinkingIfOpen,
  flushCcLog,
  markProcessEventSeen,
  postPresentationEvent,
} from "./agent-cc-stream"
import { maybeReleaseDeferredAssistant } from "./agent-cc-presentation"

/** tool_use / tool_progress 公共副作用：flush、关 thinking、更新 lastTool */
function applyCcToolSessionEffects(
  session: CcSessionAgent,
  canonicalName: string,
  filePath: string | undefined,
  resolveChannelType: (sessionKey: string) => string | undefined,
): void {
  flushCcLog(session)
  closeThinkingIfOpen(session, resolveChannelType)
  session.lastTool = { name: canonicalName, status: "running", filePath }
}

/** notify 级 tool running：分级门控 + 去重 + POST */
export function handleCcToolRunningPresentation(
  session: CcSessionAgent,
  rawName: string,
  args: unknown,
  resolveChannelType: (sessionKey: string) => string | undefined,
): void {
  const canonicalName = normalizePresentationToolName(rawName)
  const fileFields = extractFileEditPresentationFields(canonicalName, "running", args)
  applyCcToolSessionEffects(session, canonicalName, fileFields?.tool_file_path, resolveChannelType)
  const duplicateRunning = isDuplicateToolCallRunning(session, canonicalName, args)
  if (!duplicateRunning) {
    const toolDetail = formatToolCallLogSuffix("running", args)
    pushUiLog("CC", "INFO", `[${session.sessionKey}] [tool] ${canonicalName}: running${toolDetail}`)
    const tier = resolveSdkToolPresentationTier(canonicalName)
    if (tier === "notify") {
      markProcessEventSeen(session, "tool")
      session.toolPresentationOutboundIds?.delete(canonicalName)
      void postPresentationEvent(
        session,
        {
          kind: "tool",
          tool_name: canonicalName,
          tool_status: "started",
          final: false,
          ...extractShellPresentationFields(canonicalName, "running", args),
          ...buildTaskPresentationFields(session, canonicalName, "running", args),
          ...fileFields,
        },
        resolveChannelType,
      )
    }
  }
}

/** Task started 无 description 时用序号降级展示摘要 */
function buildTaskPresentationFields(
  session: CcSessionAgent,
  canonicalName: string,
  status: "running" | "completed" | "error",
  args?: unknown,
): ToolTaskPresentationFields | undefined {
  const fields = extractTaskPresentationFields(canonicalName, status, args)
  if (fields) return fields
  if (canonicalName !== "task" || status !== "running") return undefined
  session.taskSeq = (session.taskSeq ?? 0) + 1
  return { tool_task_description: `#${session.taskSeq}` }
}

/** notify 级 tool 完成/失败：清去重键 + POST + release */
export function handleCcToolFinalPresentation(
  session: CcSessionAgent,
  toolName: string,
  isError: boolean,
  result: unknown,
  resolveChannelType: (sessionKey: string) => string | undefined,
): void {
  const canonicalName = normalizePresentationToolName(toolName)
  clearToolCallRunningDedup(session)
  session.lastTool = { name: canonicalName, status: isError ? "error" : "completed", filePath: session.lastTool?.filePath }
  const status = isError ? "error" : "completed"
  const toolDetail = formatToolCallLogSuffix(status, undefined, result)
  pushUiLog("CC", "INFO", `[${session.sessionKey}] [tool] ${canonicalName}: ${status}${toolDetail}`)
  const tier = resolveSdkToolPresentationTier(canonicalName)
  if (tier !== "notify") return
  void postPresentationEvent(
    session,
    {
      kind: "tool",
      tool_name: canonicalName,
      tool_status: mapToolPresentationStatus(status),
      final: true,
      ...extractShellPresentationFields(canonicalName, status, undefined, result),
      ...extractTaskPresentationFields(canonicalName, status, undefined),
      ...extractFileEditPresentationFields(
        canonicalName,
        status,
        undefined,
        session.lastTool?.filePath,
      ),
    },
    resolveChannelType,
  )
  maybeReleaseDeferredAssistant(session)
}
