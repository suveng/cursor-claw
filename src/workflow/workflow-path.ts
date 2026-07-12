import * as fs from "node:fs";
import * as path from "node:path";

/** 是否已打印 SSOT 存储根日志（验收 ST-WF6） */
let storageRootLogged = false;

/** 是否已执行遗留目录迁移探测 */
let migrationChecked = false;

/**
 * 解析工作流存储根目录 SSOT：`{APP_DATA_DIR}/workflows`
 * APP_DATA_DIR 未设置时返回相对路径 `workflows`，调用方应 no-op 读写
 */
export function resolveWorkflowRoot(): string {
  return path.join(process.env.APP_DATA_DIR || "", "workflows");
}

/** 实例 JSON 目录 */
export function resolveInstancesDir(): string {
  return path.join(resolveWorkflowRoot(), "instances");
}

/** 定义 YAML 目录 */
export function resolveDefinitionsDir(): string {
  return path.join(resolveWorkflowRoot(), "definitions");
}

/** 首次 IO 前打 INFO 标明 SSOT 存储根（幂等） */
export function logWorkflowStorageRootOnce(): void {
  if (storageRootLogged) return;
  const root = resolveWorkflowRoot();
  if (!process.env.APP_DATA_DIR) return;
  storageRootLogged = true;
  console.info(`workflow_storage_root=${root}`);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isDirEmpty(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) return true;
    return fs.readdirSync(dir).length === 0;
  } catch {
    return true;
  }
}

function dirHasJsonFiles(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) return false;
    return fs.readdirSync(dir).some((f) => f.endsWith(".json"));
  } catch {
    return false;
  }
}

/** 复制子目录内文件至 SSOT（仅当目标为空） */
function copyLegacySubdir(legacyRoot: string, ssotRoot: string, subdir: string): void {
  const srcDir = path.join(legacyRoot, subdir);
  const destDir = path.join(ssotRoot, subdir);
  if (!fs.existsSync(srcDir) || !isDirEmpty(destDir)) return;
  ensureDir(destDir);
  for (const f of fs.readdirSync(srcDir)) {
    const srcFile = path.join(srcDir, f);
    if (!fs.statSync(srcFile).isFile()) continue;
    fs.copyFileSync(srcFile, path.join(destDir, f));
  }
}

export interface LegacyMigrationOptions {
  /** Electron 侧 userData 根，用于探测历史 workflow-file 目录 */
  legacyUserDataDir?: string;
}

export interface LegacyMigrationResult {
  migrated: boolean;
  from?: string;
  to?: string;
}

/**
 * 遗留双目录一次性迁移（幂等）
 * - SSOT instances/ 为空且 legacy 有 *.json 时复制 instances/、definitions/
 * - 不删除 legacy；打 WARN 供运维确认
 */
export function migrateLegacyWorkflowDirIfNeeded(
  options?: LegacyMigrationOptions,
): LegacyMigrationResult {
  if (migrationChecked) {
    return { migrated: false };
  }
  migrationChecked = true;

  const ssotRoot = resolveWorkflowRoot();
  if (!process.env.APP_DATA_DIR) {
    console.warn(
      "[workflow] APP_DATA_DIR 未设置，跳过遗留工作流目录迁移；请确认 Daemon/Electron 已注入 userData",
    );
    return { migrated: false };
  }

  const ssotInstances = path.join(ssotRoot, "instances");
  if (!isDirEmpty(ssotInstances)) {
    return { migrated: false };
  }

  // 候选 legacy 根：Electron userData/workflows；历史 cwd 相对 workflows/
  const legacyRoots: string[] = [];
  if (options?.legacyUserDataDir) {
    legacyRoots.push(path.join(options.legacyUserDataDir, "workflows"));
  }
  // ponytail: APP_DATA_DIR 未注入时实例曾落到进程 cwd/workflows
  legacyRoots.push(path.resolve("workflows"));

  const ssotNorm = path.normalize(ssotRoot);
  for (const legacyRoot of legacyRoots) {
    const legacyNorm = path.normalize(legacyRoot);
    if (legacyNorm === ssotNorm) continue;
    const legacyInstances = path.join(legacyRoot, "instances");
    if (!dirHasJsonFiles(legacyInstances)) continue;

    copyLegacySubdir(legacyRoot, ssotRoot, "instances");
    copyLegacySubdir(legacyRoot, ssotRoot, "definitions");

    console.warn(
      `[workflow] 已从遗留目录迁移工作流数据：${legacyRoot} → ${ssotRoot}（未删除遗留目录，请运维确认）`,
    );
    return { migrated: true, from: legacyRoot, to: ssotRoot };
  }

  return { migrated: false };
}
