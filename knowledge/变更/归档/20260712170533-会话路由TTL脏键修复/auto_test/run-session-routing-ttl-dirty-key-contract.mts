/**
 * 会话路由 TTL 脏键修复契约：脏键保真 / prune 不续命 / C2 / mark / onActiveSet 不误 mark / 静态
 * 运行：./run-session-routing-ttl-dirty-key-contract.sh
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearActiveTouched,
  flushSessionRoutingPersist,
  loadSessionRoutingInto,
  markActiveTouched,
  markFallbackTouched,
  pruneExpiredEntries,
  SESSION_ROUTING_TTL_MS,
} from "../../../../../src/daemon/daemon-session-routing-persist.ts";
import { createSessionMaps } from "../../../../../src/daemon/daemon-session-maps.ts";
import { fallbackSessionMap } from "../../../../../src/daemon/daemon-session-routing.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "../../../../..");

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

function sh(cmd: string): string {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

type DiskSnap = {
  version: number;
  activeSessions: Record<string, { sessionKey: string; lastTouchedAt: number }>;
  fallbackSessions: Record<string, { fallbackSessionKey: string; lastTouchedAt: number }>;
};

/** 隔离 APP_DATA_DIR 跑用例 */
function withAppData(fn: (appData: string) => void): void {
  const appData = join("/tmp", `kb-ttl-dirty-${process.pid}-${Date.now()}`);
  mkdirSync(appData, { recursive: true });
  const prev = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appData;
  try {
    fn(appData);
  } finally {
    process.env.APP_DATA_DIR = prev;
    rmSync(appData, { recursive: true, force: true });
  }
}

function writeSnap(appData: string, snap: object): void {
  writeFileSync(join(appData, "session-routing.json"), JSON.stringify(snap), "utf8");
}

function readDisk(appData: string): DiskSnap {
  return JSON.parse(readFileSync(join(appData, "session-routing.json"), "utf8")) as DiskSnap;
}

/** 静态：TTL/schema/行数/无全量刷新/关键字/接线/R1 冷启动 */
function testStaticRegression(): void {
  const p = "src/daemon/daemon-session-routing-persist.ts";
  assert(existsSync(join(REPO_ROOT, p)), "persist 存在");
  assert(sh(`grep -c 'SESSION_ROUTING_TTL_MS = 30 \\* 24 \\* 60 \\* 60 \\* 1000' ${p}`) >= "1", "TTL=30d");
  assert(sh(`grep -c 'SCHEMA_VERSION = 1' ${p}`) >= "1", "schema=1");
  assert((sh(`grep -n 'activeTouchAt\\.set(chatId, now)' ${p} || true`) === ""), "无全量 active set");
  assert((sh(`grep -n 'fallbackTouchAt\\.set(sessionKey, now)' ${p} || true`) === ""), "无全量 fb set");
  assert(Number(sh(`wc -l < ${p}`)) <= 300, "persist ≤300");
  assert(sh("grep -c 'session_routing_load_failed' src/daemon/daemon.ts") >= "1", "load_failed");
  assert(sh(`grep -c 'session_routing_pruned' ${p}`) >= "1", "pruned");
  assert(sh(`grep -c '\\[session-routing\\]' ${p}`) >= "1", "[session-routing]");
  assert(sh("grep -c 'markActiveTouched' src/daemon/daemon-session-maps.ts") >= "1", "maps mark");
  assert(sh("grep -c 'clearActiveTouched' src/daemon/daemon-session-maps.ts") >= "1", "maps clear");
  assert(sh("grep -c 'markFallbackTouched' src/daemon/daemon-session-routing.ts") >= "1", "routing mark");
  assert(sh("grep -c 'clearFallbackTouched' src/daemon/daemon-session-routing.ts") >= "1", "routing clear");
  assert(
    (sh("grep -E 'fallbackSessionMap\\.(set|delete)' src/daemon/daemon-http-routes-session.ts 2>/dev/null || true") === ""),
    "HTTP 无 fallback 直写",
  );
  // R1：load 须 touch:false，禁止裸传 setActiveSession
  assert(sh("grep -c 'touch: false' src/daemon/daemon.ts") >= "1", "load touch:false");
  assert(
    (sh("grep -n 'loadSessionRoutingInto([^)]*setActiveSession)' src/daemon/daemon.ts 2>/dev/null || true") === ""),
    "load 禁止裸传 setActiveSession",
  );
  console.log("OK 静态回归");
}

/** 脏键保真：仅 mark A，B/fallback 戳不变 */
function testDirtyKeyFidelity(): void {
  withAppData((appData) => {
    const tA = Date.now() - 3_600_000;
    const tB = Date.now() - 1_800_000;
    writeSnap(appData, {
      version: 1,
      activeSessions: {
        chat_a: { sessionKey: "sk_a", lastTouchedAt: tA },
        chat_b: { sessionKey: "sk_b", lastTouchedAt: tB },
      },
      fallbackSessions: { fb_x: { fallbackSessionKey: "fb_base", lastTouchedAt: tB } },
    });
    const active = new Map<string, string>();
    const fallback = new Map<string, string>();
    assert(loadSessionRoutingInto(active, fallback).ok === true, "脏键: load");
    markActiveTouched("chat_a");
    flushSessionRoutingPersist(active, fallback);
    const disk = readDisk(appData);
    assert(disk.version === 1 && disk.activeSessions.chat_b?.lastTouchedAt === tB, "脏键: B 保真");
    assert(disk.fallbackSessions.fb_x?.lastTouchedAt === tB, "脏键: fb 保真");
    assert((disk.activeSessions.chat_a?.lastTouchedAt ?? 0) > tA, "脏键: A 续期");
    console.log("OK 脏键保真");
  });
}

/** 运行期 prune：过期 B 不因 A 写盘续命 */
function testRuntimePruneNoRenewal(): void {
  withAppData((appData) => {
    const realNow = Date.now;
    try {
      const wall = realNow();
      const expiredB = wall - SESSION_ROUTING_TTL_MS - 1;
      writeSnap(appData, {
        version: 1,
        activeSessions: {
          chat_a: { sessionKey: "sk_a", lastTouchedAt: wall - 60_000 },
          chat_b: { sessionKey: "sk_b", lastTouchedAt: wall - 60_000 },
        },
        fallbackSessions: {},
      });
      const active = new Map<string, string>();
      const fallback = new Map<string, string>();
      assert(loadSessionRoutingInto(active, fallback).ok === true, "prune-NR: load");
      Date.now = () => expiredB;
      markActiveTouched("chat_b");
      Date.now = () => wall;
      markActiveTouched("chat_a");
      Date.now = realNow;
      flushSessionRoutingPersist(active, fallback);
      assert(readDisk(appData).activeSessions.chat_b?.lastTouchedAt === expiredB, "prune-NR: B 过期戳");
      assert((readDisk(appData).activeSessions.chat_a?.lastTouchedAt ?? 0) >= wall, "prune-NR: A 近");
      assert(pruneExpiredEntries(active, fallback) === 1, "prune-NR: 剔 1");
      assert(!active.has("chat_b") && active.get("chat_a") === "sk_a", "prune-NR: A 留 B 删");
      console.log("OK 运行期 prune 不续命");
    } finally {
      Date.now = realNow;
    }
  });
}

/** 冷启动混合 TTL（上游 C2） */
function testColdStartC2Align(): void {
  withAppData((appData) => {
    const expired = Date.now() - SESSION_ROUTING_TTL_MS - 60_000;
    const fresh = Date.now();
    writeSnap(appData, {
      version: 1,
      activeSessions: {
        chat_old: { sessionKey: "sk_old", lastTouchedAt: expired },
        chat_new: { sessionKey: "sk_new", lastTouchedAt: fresh },
      },
      fallbackSessions: { sk_old_fb: { fallbackSessionKey: "fb_old", lastTouchedAt: expired } },
    });
    const active = new Map<string, string>();
    const fallback = new Map<string, string>();
    const result = loadSessionRoutingInto(active, fallback);
    assert(result.ok === true && result.pruned === 2, "C2: pruned=2");
    assert(!active.has("chat_old") && active.get("chat_new") === "sk_new", "C2: active");
    assert(!fallback.has("sk_old_fb"), "C2: fb 剔除");
    console.log("OK 冷启动 C2 对齐");
  });
}

/** mark 续期 + clear 无孤儿 */
function testMarkRenewalAndClear(): void {
  withAppData((appData) => {
    const old = Date.now() - 3_600_000;
    writeSnap(appData, {
      version: 1,
      activeSessions: { chat_a: { sessionKey: "sk_a", lastTouchedAt: old } },
      fallbackSessions: { sk_fb: { fallbackSessionKey: "sk_base", lastTouchedAt: old } },
    });
    const active = new Map<string, string>();
    const fallback = new Map<string, string>();
    loadSessionRoutingInto(active, fallback);
    const before = Date.now();
    markActiveTouched("chat_a");
    markFallbackTouched("sk_fb");
    flushSessionRoutingPersist(active, fallback);
    const disk = readDisk(appData);
    assert((disk.activeSessions.chat_a?.lastTouchedAt ?? 0) >= before, "续期: active");
    assert((disk.fallbackSessions.sk_fb?.lastTouchedAt ?? 0) >= before, "续期: fb");
    clearActiveTouched("chat_a");
    active.delete("chat_a");
    flushSessionRoutingPersist(active, fallback);
    assert(!readDisk(appData).activeSessions.chat_a, "clear: 无 chat_a");
    console.log("OK mark 续期与 clear");
  });
}

/**
 * R1：生产路径 onActiveSet=setActiveSession(..., {touch:false}) 不抬升戳；
 * 误用默认 touch 会抬升（敏感度）
 */
function testColdStartOnActiveSetNoMark(): void {
  withAppData((appData) => {
    const tA = Date.now() - 3_600_000;
    const tB = Date.now() - 1_800_000;
    writeSnap(appData, {
      version: 1,
      activeSessions: {
        chat_a: { sessionKey: "sk_a", lastTouchedAt: tA },
        chat_b: { sessionKey: "sk_b", lastTouchedAt: tB },
      },
      fallbackSessions: {},
    });
    const maps = createSessionMaps({
      log: () => {},
      resolveChannel: () => ({ type: "other" }),
      resolveSessionChatType: () => undefined,
      recordGetReactions: () => {},
    });
    // 清空模块级 fallback，避免跨用例污染
    fallbackSessionMap.clear();
    assert(
      loadSessionRoutingInto(
        maps.activeSessionMap,
        fallbackSessionMap,
        (c, sk) => maps.setActiveSession(c, sk, { touch: false }),
      ).ok === true,
      "onActiveSet: load",
    );
    assert(maps.sessionToChatMap.get("sk_a") === "chat_a", "反向索引 A");
    flushSessionRoutingPersist(maps.activeSessionMap, fallbackSessionMap);
    const disk = readDisk(appData);
    assert(disk.activeSessions.chat_a?.lastTouchedAt === tA, "onActiveSet: A 不抬升");
    assert(disk.activeSessions.chat_b?.lastTouchedAt === tB, "onActiveSet: B 不抬升");
    // 对照：默认 touch 会 mark 抬升
    maps.setActiveSession("chat_a", "sk_a");
    flushSessionRoutingPersist(maps.activeSessionMap, fallbackSessionMap);
    assert((readDisk(appData).activeSessions.chat_a?.lastTouchedAt ?? 0) > tA, "对照: 默认 touch 抬升");
    console.log("OK 冷启动 onActiveSet 不误 mark");
  });
}

function main(): void {
  console.log("session-routing-ttl-dirty-key-contract");
  testStaticRegression();
  testDirtyKeyFidelity();
  testRuntimePruneNoRenewal();
  testColdStartC2Align();
  testMarkRenewalAndClear();
  testColdStartOnActiveSetNoMark();
  console.log("ALL PASS");
}

main();
