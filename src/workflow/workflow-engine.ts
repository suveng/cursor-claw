/**
 * 工作流引擎对外 facade：稳定导出路径，实现落在子模块。
 * 调用方继续从 `./workflow-engine.js` 导入即可。
 */
export type { EngineResult } from "./workflow-engine-advance.js";
export { handleNext } from "./workflow-engine-advance.js";
export { handleReject } from "./workflow-engine-reject.js";
export {
  buildStartPrompt,
  buildRetryPrompt,
} from "./workflow-engine-prompt.js";
export {
  createInstance,
  startWorkflow,
  resumeWorkflow,
  recoverStaleInstances,
} from "./workflow-engine-lifecycle.js";
