/** 薄 re-export：去重逻辑已迁至 electron/agent/shared/tool-presentation-dedup.ts */
export {
  buildToolCallRunningDedupKey,
  clearToolCallRunningDedup,
  isDuplicateToolCallRunning,
  isRedundantTaskEventAfterToolCall,
  mapTaskMilestoneText,
  type ToolPresentationDedupSession,
} from "../shared/tool-presentation-dedup.js"
