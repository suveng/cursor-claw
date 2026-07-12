/**
 * 文件队列公共入口：从子模块 re-export，调用方仍 import `../bridge/file-queue.js`。
 * 禁止 barrel index.ts；业务实现见 file-queue-*.ts 子模块。
 */

export { initFileQueue, getQueueDir } from "./file-queue-path.js";

export type {
  QueueMessageMeta,
  QueueMessage,
  QueueMessageView,
  QueueSessionInfo,
} from "./file-queue-types.js";

export { pushToFileQueue } from "./file-queue-enqueue.js";

export {
  claimNextMessage,
  claimSessionMessages,
  waitForSessionMessages,
} from "./file-queue-claim.js";

export {
  ackMessages,
  releaseClaimedMessages,
  cleanupStaleMessages,
  cleanupOrphanClaimedOnColdStart,
} from "./file-queue-lifecycle.js";

export {
  getSessionPendingCount,
  getSessionUnclaimedCount,
  listUnclaimedMessages,
  replaceSessionUnclaimedMessages,
  getEarliestMessageTime,
  getQueueLength,
  getQueueMessages,
  deleteQueueMessage,
  getDistinctSessions,
} from "./file-queue-query.js";
