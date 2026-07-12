import * as fs from "node:fs";
import * as path from "node:path";
import type { WorkflowDefinition, WorkflowInstance } from "./workflow-types.js";
import { loadBuiltinWorkflows } from "./builtin-workflows.js";
import {
  deleteDefinition as deleteDefinitionFile,
  getDefinition as getDefinitionFile,
  listDefinitions as listDefinitionsFiles,
  saveDefinition as saveDefinitionFile,
  seedBuiltinDefinitions,
} from "./workflow-definition-store.js";
import {
  logWorkflowStorageRootOnce,
  migrateLegacyWorkflowDirIfNeeded,
  resolveInstancesDir,
  resolveWorkflowRoot,
} from "./workflow-path.js";

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    }
  } catch { /* ignore */ }
  return fallback;
}

function writeJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/** APP_DATA_DIR 未设置时不写盘（与现网 seed 行为对齐） */
function canUseStorage(): boolean {
  return Boolean(process.env.APP_DATA_DIR);
}

function beforeStorageIo(): void {
  if (!canUseStorage()) return;
  logWorkflowStorageRootOnce();
  migrateLegacyWorkflowDirIfNeeded();
}

/** 种子内置工作流定义（Daemon/Electron 启动时显式调用） */
export function seedBuiltins(): void {
  if (!canUseStorage()) return;
  beforeStorageIo();
  seedBuiltinDefinitions(resolveWorkflowRoot(), loadBuiltinWorkflows());
}

// Daemon 子进程 env 已注入 APP_DATA_DIR 时，import 即种子
if (process.env.APP_DATA_DIR) {
  seedBuiltins();
}

export function listDefinitions(): WorkflowDefinition[] {
  if (!canUseStorage()) return [];
  beforeStorageIo();
  return listDefinitionsFiles(resolveWorkflowRoot());
}

export function getDefinition(id: string): WorkflowDefinition | undefined {
  if (!canUseStorage()) return undefined;
  beforeStorageIo();
  return getDefinitionFile(resolveWorkflowRoot(), id);
}

export function saveDefinition(def: WorkflowDefinition): void {
  if (!canUseStorage()) return;
  beforeStorageIo();
  saveDefinitionFile(resolveWorkflowRoot(), def);
}

export function deleteDefinition(id: string): boolean {
  if (!canUseStorage()) return false;
  beforeStorageIo();
  return deleteDefinitionFile(resolveWorkflowRoot(), id);
}

function instancePath(id: string): string {
  return path.join(resolveInstancesDir(), `${id}.json`);
}

export function getInstance(id: string): WorkflowInstance | undefined {
  if (!canUseStorage()) return undefined;
  beforeStorageIo();
  return readJsonSafe<WorkflowInstance | undefined>(instancePath(id), undefined);
}

export function saveInstance(inst: WorkflowInstance): void {
  if (!canUseStorage()) return;
  beforeStorageIo();
  ensureDir(resolveInstancesDir());
  writeJson(instancePath(inst.id), inst);
}

export function deleteInstance(id: string): boolean {
  if (!canUseStorage()) return false;
  beforeStorageIo();
  const fp = instancePath(id);
  if (!fs.existsSync(fp)) {
    return false;
  }
  fs.unlinkSync(fp);
  return true;
}

export function listInstances(): WorkflowInstance[] {
  if (!canUseStorage()) return [];
  beforeStorageIo();
  const instancesDir = resolveInstancesDir();
  ensureDir(instancesDir);
  try {
    return fs.readdirSync(instancesDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJsonSafe<WorkflowInstance | null>(path.join(instancesDir, f), null))
      .filter(Boolean) as WorkflowInstance[];
  } catch {
    return [];
  }
}

export function findActiveInstance(): WorkflowInstance | undefined {
  return listInstances().find((i) => i.status === "running" || i.status === "paused");
}
