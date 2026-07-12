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

// Electron 主进程确保 APP_DATA_DIR 与 Daemon 子进程一致
if (!process.env.APP_DATA_DIR) {
  process.env.APP_DATA_DIR = app.getPath("userData");
}

/** 启动时种子内置定义，并探测遗留双目录迁移 */
export function seedBuiltins(): void {
  migrateLegacyWorkflowDirIfNeeded({ legacyUserDataDir: app.getPath("userData") });
  storeSeedBuiltins();
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
