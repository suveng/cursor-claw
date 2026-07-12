/**
 * Electron 工作流存储薄封装：统一委托 src/workflow/workflow-store（SSOT）
 * 保留本文件 export 名稳定，供 daemon-manager / command-handler 等 import
 */
import { app } from "electron";
import {
  deleteDefinition,
  deleteInstance,
  getDefinition,
  getInstance,
  listDefinitions,
  listInstances,
  saveDefinition,
  saveInstance,
  seedBuiltins as storeSeedBuiltins,
} from "../../src/workflow/workflow-store";
import { migrateLegacyWorkflowDirIfNeeded } from "../../src/workflow/workflow-path";
import { recoverStaleInstances } from "../../src/workflow/workflow-engine";
import { getConfig } from "../config/config-store";

// Electron 主进程确保 APP_DATA_DIR 与 Daemon 子进程一致
if (!process.env.APP_DATA_DIR) {
  process.env.APP_DATA_DIR = app.getPath("userData");
}

/** 启动时种子内置定义，并按开关恢复陈旧 running→paused */
export function seedBuiltins(): void {
  migrateLegacyWorkflowDirIfNeeded({ legacyUserDataDir: app.getPath("userData") });
  storeSeedBuiltins();
  // 生产接线：读 AppConfig，默认 true；同步 env 供 Daemon 子进程尊重同一开关
  const autoPause = getConfig().workflowAutoPauseStale !== false;
  process.env.WORKFLOW_AUTO_PAUSE_STALE = autoPause ? "1" : "0";
  const recovered = recoverStaleInstances(autoPause);
  if (recovered.length > 0) {
    console.log(`[workflow] 已将 ${recovered.length} 个陈旧 running 实例标记为 paused`);
  }
}

export {
  listDefinitions,
  getDefinition,
  saveDefinition,
  deleteDefinition,
  listInstances,
  getInstance,
  saveInstance,
  deleteInstance,
};
