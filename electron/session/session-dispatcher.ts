/**
 * 会话调度 — 薄 re-export 入口
 * 调用方仍 import 本文件，子模块按职责拆分（每文件 ≤300 行）
 */
export {
  chatNameCache,
  isMainUser,
  extractChatId,
  formatDuration,
} from "./session-dispatcher-shared"

export {
  isSessionAgentRunning,
  stopSessionAgent,
  stopAllSessionAgents,
  getSessionAgentList,
  restartCurrentSessionAgent,
  type RestartCurrentSessionResult,
} from "./session-dispatcher-runtime"

export {
  cachedLock,
  notifyChat,
  handleSessionClosed,
  fetchChatNames,
  fetchUserNames,
  pullMergedMessagesFromQueue,
  clearMessageQueue,
  getQueueMessages,
  deleteQueueMessage,
  initSessionDispatcher,
  type MergedMessages,
  type QueueMessageItem,
} from "./session-dispatcher-lifecycle"

export {
  launchSessionAgent,
  launchIndependentAgent,
  launchWorkflowAgent,
  notifyWorkflowChat,
} from "./session-dispatcher-launch"

export {
  parseChatNewArgs,
  validateWorkspacePath,
  resolveOthersWorkspaceDir,
  handleChatCommand,
} from "./session-dispatcher-chat"
