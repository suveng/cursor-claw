/** 会话路由映射磁盘持久化：{APP_DATA_DIR}/session-routing.json；原子写；debounce 500ms */
import * as fs from "node:fs";
import * as path from "node:path";

/** 加载结果：成功含 prune 计数，失败含错误文案（不抛未捕获异常） */
export type LoadResult = { ok: true; pruned: number } | { ok: false; error: string };

/** 默认 TTL：30 天（毫秒） */
export const SESSION_ROUTING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ROUTING_FILE = "session-routing.json";
const PERSIST_DEBOUNCE_MS = 500;
const SCHEMA_VERSION = 1;

interface ActiveDiskEntry { sessionKey: string; lastTouchedAt: number }
interface FallbackDiskEntry { fallbackSessionKey: string; lastTouchedAt: number }
interface SessionRoutingSnapshot {
  version: number;
  activeSessions: Record<string, ActiveDiskEntry>;
  fallbackSessions: Record<string, FallbackDiskEntry>;
}

/**
 * 与内存 Map 对齐的 lastTouchedAt 旁路表（Map 本身不存时间戳）。
 * 约定：仅映射触达/变更时 mark；写盘禁止全量刷新 touch（否则 TTL 退化为「任意会话最后写盘时间」）。
 * 历史磁盘同戳脏数据不在 load 纠偏（无法无害回溯真实空闲起点；误压旧可能冷启动误删活跃映射）；
 * 修复后 forward 行为正确，既有膨胀戳最长多虚增一段空闲窗口属一次性残差。
 */
const activeTouchAt = new Map<string, number>();
const fallbackTouchAt = new Map<string, number>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingActive: Map<string, string> | null = null;
let pendingFallback: Map<string, string> | null = null;

/** 映射触达/变更时刷新该键最后触达时间（写盘前由 mutation 调用） */
export function markActiveTouched(chatId: string): void {
  activeTouchAt.set(chatId, Date.now());
}

/** 清除 active 旁路 touch，避免 clear 后孤儿键 */
export function clearActiveTouched(chatId: string): void {
  activeTouchAt.delete(chatId);
}

/** fallback 映射触达/变更时刷新该键最后触达时间 */
export function markFallbackTouched(sessionKey: string): void {
  fallbackTouchAt.set(sessionKey, Date.now());
}

/** 清除 fallback 旁路 touch，避免 clear 后孤儿键 */
export function clearFallbackTouched(sessionKey: string): void {
  fallbackTouchAt.delete(sessionKey);
}

function resolveRoutingPath(): string | null {
  const appDataDir = process.env.APP_DATA_DIR;
  if (!appDataDir) return null;
  return path.join(appDataDir, ROUTING_FILE);
}

function warnPersist(message: string): void {
  process.stderr.write(`[session-routing] WARN ${message}\n`);
}

function formatErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isDiskEntry(value: unknown, field: "sessionKey" | "fallbackSessionKey"): boolean {
  if (!isRecord(value)) return false;
  return typeof value[field] === "string" && typeof value.lastTouchedAt === "number";
}

/** 解析并校验 v1 快照；非法时返回 null */
function parseSnapshot(raw: unknown): SessionRoutingSnapshot | null {
  if (!isRecord(raw) || raw.version !== SCHEMA_VERSION) return null;
  if (!isRecord(raw.activeSessions) || !isRecord(raw.fallbackSessions)) return null;

  const activeSessions: Record<string, ActiveDiskEntry> = {};
  for (const [chatId, entry] of Object.entries(raw.activeSessions)) {
    if (!isDiskEntry(entry, "sessionKey")) return null;
    activeSessions[chatId] = entry as ActiveDiskEntry;
  }

  const fallbackSessions: Record<string, FallbackDiskEntry> = {};
  for (const [sessionKey, entry] of Object.entries(raw.fallbackSessions)) {
    if (!isDiskEntry(entry, "fallbackSessionKey")) return null;
    fallbackSessions[sessionKey] = entry as FallbackDiskEntry;
  }

  return { version: SCHEMA_VERSION, activeSessions, fallbackSessions };
}

function readSnapshotFromDisk(): { snapshot: SessionRoutingSnapshot | null; error?: string } {
  const filePath = resolveRoutingPath();
  if (!filePath) return { snapshot: null, error: "APP_DATA_DIR 未设置" };
  try {
    if (!fs.existsSync(filePath)) {
      return { snapshot: null, error: "session-routing.json 不存在" };
    }
    const snapshot = parseSnapshot(JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown);
    if (!snapshot) return { snapshot: null, error: "session-routing.json schema 无效" };
    return { snapshot };
  } catch (e: unknown) {
    return { snapshot: null, error: `session-routing.json 读取失败: ${formatErr(e)}` };
  }
}

function resetMaps(active: Map<string, string>, fallback: Map<string, string>): void {
  active.clear();
  fallback.clear();
  activeTouchAt.clear();
  fallbackTouchAt.clear();
}

function applySnapshotToMaps(
  snapshot: SessionRoutingSnapshot,
  active: Map<string, string>,
  fallback: Map<string, string>,
): void {
  resetMaps(active, fallback);
  for (const [chatId, entry] of Object.entries(snapshot.activeSessions)) {
    active.set(chatId, entry.sessionKey);
    activeTouchAt.set(chatId, entry.lastTouchedAt);
  }
  for (const [sessionKey, entry] of Object.entries(snapshot.fallbackSessions)) {
    fallback.set(sessionKey, entry.fallbackSessionKey);
    fallbackTouchAt.set(sessionKey, entry.lastTouchedAt);
  }
}

/** 剔除 TTL 过期条目；无 touch 记录视为未过期 */
export function pruneExpiredEntries(
  active: Map<string, string>,
  fallback: Map<string, string>,
): number {
  const now = Date.now();
  let pruned = 0;
  for (const chatId of [...active.keys()]) {
    const touched = activeTouchAt.get(chatId);
    if (touched !== undefined && touched + SESSION_ROUTING_TTL_MS < now) {
      active.delete(chatId);
      activeTouchAt.delete(chatId);
      pruned++;
    }
  }
  for (const sessionKey of [...fallback.keys()]) {
    const touched = fallbackTouchAt.get(sessionKey);
    if (touched !== undefined && touched + SESSION_ROUTING_TTL_MS < now) {
      fallback.delete(sessionKey);
      fallbackTouchAt.delete(sessionKey);
      pruned++;
    }
  }
  return pruned;
}

/**
 * 组装写盘快照：保真各键旁路 lastTouchedAt；缺失时才补 now（防御未 mark 的新键）。
 * 禁止遍历在册键无条件 set(touch, now)。
 */
function buildSnapshot(
  active: Map<string, string>,
  fallback: Map<string, string>,
): SessionRoutingSnapshot {
  const now = Date.now();
  const activeSessions: Record<string, ActiveDiskEntry> = {};
  const fallbackSessions: Record<string, FallbackDiskEntry> = {};
  for (const [chatId, sessionKey] of active) {
    let touched = activeTouchAt.get(chatId);
    if (touched === undefined) {
      touched = now;
      activeTouchAt.set(chatId, touched);
    }
    activeSessions[chatId] = { sessionKey, lastTouchedAt: touched };
  }
  for (const [sessionKey, fallbackSessionKey] of fallback) {
    let touched = fallbackTouchAt.get(sessionKey);
    if (touched === undefined) {
      touched = now;
      fallbackTouchAt.set(sessionKey, touched);
    }
    fallbackSessions[sessionKey] = { fallbackSessionKey, lastTouchedAt: touched };
  }
  return { version: SCHEMA_VERSION, activeSessions, fallbackSessions };
}

/** 原子写快照；失败仅 WARN */
function writeSnapshotToDisk(active: Map<string, string>, fallback: Map<string, string>): void {
  const filePath = resolveRoutingPath();
  if (!filePath) {
    warnPersist("APP_DATA_DIR 未设置，跳过写盘");
    return;
  }
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(buildSnapshot(active, fallback), null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (e: unknown) {
    warnPersist(`session-routing.json 写入失败: ${formatErr(e)}`);
  }
}

/** 从磁盘加载；load 时 prune；损坏/缺失时 Maps 为空且 ok: false */
export function loadSessionRoutingInto(
  active: Map<string, string>,
  fallback: Map<string, string>,
  onActiveSet?: (chatId: string, sessionKey: string) => void,
): LoadResult {
  try {
    const { snapshot, error } = readSnapshotFromDisk();
    if (!snapshot) {
      resetMaps(active, fallback);
      return { ok: false, error: error ?? "session-routing.json 无效" };
    }
    applySnapshotToMaps(snapshot, active, fallback);
    const pruned = pruneExpiredEntries(active, fallback);
    if (onActiveSet) {
      for (const [chatId, sessionKey] of active) onActiveSet(chatId, sessionKey);
    }
    return { ok: true, pruned };
  } catch (e: unknown) {
    resetMaps(active, fallback);
    return { ok: false, error: formatErr(e) };
  }
}

function clearPersistTimer(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}

/** debounce 500ms 调度写盘 */
export function scheduleSessionRoutingPersist(
  active: Map<string, string>,
  fallback: Map<string, string>,
): void {
  pendingActive = active;
  pendingFallback = fallback;
  clearPersistTimer();
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (pendingActive && pendingFallback) writeSnapshotToDisk(pendingActive, pendingFallback);
    pendingActive = null;
    pendingFallback = null;
  }, PERSIST_DEBOUNCE_MS);
  persistTimer.unref?.();
}

/** 立即落盘（供测试/debounce 验收） */
export function flushSessionRoutingPersist(
  active: Map<string, string>,
  fallback: Map<string, string>,
): void {
  clearPersistTimer();
  pendingActive = null;
  pendingFallback = null;
  writeSnapshotToDisk(active, fallback);
}

/** 运行期 TTL 清扫间隔：6 小时（与 startMediaCacheCleanup 对齐） */
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * 注册 6h 定时 prune；有剔除时 debounce 写盘。
 * interval 使用 .unref()，不阻止进程退出。
 */
export function startSessionRoutingPruneTimer(
  active: Map<string, string>,
  fallback: Map<string, string>,
): void {
  const sweep = () => {
    const pruned = pruneExpiredEntries(active, fallback);
    if (pruned > 0) {
      scheduleSessionRoutingPersist(active, fallback);
      process.stderr.write(`[session-routing] INFO session_routing_pruned: ${pruned}\n`);
    }
  };
  setInterval(sweep, PRUNE_INTERVAL_MS).unref();
}
