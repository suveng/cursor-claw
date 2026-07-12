/**
 * Agent 标识跨重启持久化 — 契约冒烟：静态接线 + persist 模块 load/TTL/损坏/flush
 * 运行：./run-session-routing-persist-contract.sh
 */
import { spawn, type ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  flushSessionRoutingPersist,
  loadSessionRoutingInto,
  pruneExpiredEntries,
  SESSION_ROUTING_TTL_MS,
  scheduleSessionRoutingPersist,
} from "../../../../../src/daemon/daemon-session-routing-persist.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "../../../../..");
const TEST_PORT = Number(process.env.KB_SESSION_ROUTING_TEST_PORT ?? "0");

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

/** 在仓库根执行 shell 并返回 stdout */
function sh(cmd: string): string {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

/** 创建隔离 APP_DATA_DIR */
function makeAppData(): string {
  const dir = join("/tmp", `kb-session-routing-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 写入 session-routing.json */
function writeRoutingFile(appData: string, content: string): void {
  writeFileSync(join(appData, "session-routing.json"), content, "utf8");
}

/** 静态：关键符号与 T3 零直写 */
function testStaticWiring(): void {
  assert(
    existsSync(join(REPO_ROOT, "src/daemon/daemon-session-routing-persist.ts")),
    "persist 模块存在",
  );
  assert(
    sh("grep -c 'loadSessionRoutingInto' src/daemon/daemon.ts") >= "1",
    "T2 daemonMain load",
  );
  assert(
    sh("grep -c 'session_routing_load_failed' src/daemon/daemon.ts") >= "1",
    "T2 load 失败 WARN",
  );
  assert(
    sh("grep -c 'startSessionRoutingPruneTimer' src/daemon/daemon.ts") >= "1",
    "T4 prune 定时器",
  );
  assert(
    sh("grep -c 'clearActiveSession' src/daemon/daemon.ts") >= "1",
    "T3 clearActiveSession",
  );
  assert(
    sh("grep -c 'scheduleSessionRoutingPersist' src/daemon/daemon-session-routing.ts") >= "1",
    "T3 fallback helper persist",
  );
  const directMap = sh(
    "grep -E 'fallbackSessionMap\\.(set|delete)' src/daemon/daemon-http-routes-session.ts 2>/dev/null || true",
  );
  assert(directMap === "", "T3 HTTP 无 fallbackSessionMap 直写");

  const lines = Number(
    sh("wc -l < src/daemon/daemon-session-routing-persist.ts"),
  );
  assert(lines <= 300, `T1 persist 文件 ${lines} 行 > 300`);

  console.log("OK 静态接线 T1–T4");
}

/** C1：合法 JSON load 后 Maps 与磁盘一致；onActiveSet 回调 */
function testLoadValid(): void {
  const appData = makeAppData();
  const prev = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appData;
  try {
    const snapshot = {
      version: 1,
      activeSessions: {
        chat_a: { sessionKey: "sk_a::/tmp/ws", lastTouchedAt: Date.now() },
      },
      fallbackSessions: {
        sk_temp: { fallbackSessionKey: "sk_base", lastTouchedAt: Date.now() },
      },
    };
    writeRoutingFile(appData, JSON.stringify(snapshot));

    const active = new Map<string, string>();
    const fallback = new Map<string, string>();
    const callbacks: Array<[string, string]> = [];
    const result = loadSessionRoutingInto(active, fallback, (c, s) => {
      callbacks.push([c, s]);
    });

    assert(result.ok === true, "C1: load ok");
    assert(active.get("chat_a") === "sk_a::/tmp/ws", "C1: active 命中");
    assert(fallback.get("sk_temp") === "sk_base", "C1: fallback 命中");
    assert(callbacks.length === 1 && callbacks[0]![0] === "chat_a", "C1: onActiveSet");
    console.log("OK C1 合法 load + onActiveSet");
  } finally {
    process.env.APP_DATA_DIR = prev;
    rmSync(appData, { recursive: true, force: true });
  }
}

/** C2：load 时 TTL 过期条目剔除 */
function testLoadTtlPrune(): void {
  const appData = makeAppData();
  const prev = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appData;
  try {
    const expired = Date.now() - SESSION_ROUTING_TTL_MS - 60_000;
    const fresh = Date.now();
    const snapshot = {
      version: 1,
      activeSessions: {
        chat_old: { sessionKey: "sk_old", lastTouchedAt: expired },
        chat_new: { sessionKey: "sk_new", lastTouchedAt: fresh },
      },
      fallbackSessions: {
        sk_old_fb: { fallbackSessionKey: "fb_old", lastTouchedAt: expired },
      },
    };
    writeRoutingFile(appData, JSON.stringify(snapshot));

    const active = new Map<string, string>();
    const fallback = new Map<string, string>();
    const result = loadSessionRoutingInto(active, fallback);

    assert(result.ok === true, "C2: load ok");
    assert(
      result.ok && result.pruned === 2,
      `C2: pruned=2（got ${result.ok ? result.pruned : "fail"}）`,
    );
    assert(!active.has("chat_old"), "C2: 过期 active 已剔除");
    assert(active.get("chat_new") === "sk_new", "C2: 未过期 active 保留");
    assert(!fallback.has("sk_old_fb"), "C2: 过期 fallback 已剔除");
    console.log("OK C2 load TTL prune");
  } finally {
    process.env.APP_DATA_DIR = prev;
    rmSync(appData, { recursive: true, force: true });
  }
}

/** C3：损坏 JSON / schema 无效 → ok:false、Maps 空 */
function testCorruptDegrade(): void {
  const appData = makeAppData();
  const prev = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appData;
  try {
    // 非法 JSON
    writeRoutingFile(appData, "{not-json");
    let active = new Map([["x", "y"]]);
    let fallback = new Map([["a", "b"]]);
    let r = loadSessionRoutingInto(active, fallback);
    assert(r.ok === false, "C3a: 损坏 JSON ok:false");
    assert(active.size === 0 && fallback.size === 0, "C3a: Maps 已清空");

    // schema 版本不符
    writeRoutingFile(appData, JSON.stringify({ version: 99, activeSessions: {}, fallbackSessions: {} }));
    active = new Map([["x", "y"]]);
    fallback = new Map();
    r = loadSessionRoutingInto(active, fallback);
    assert(r.ok === false, "C3b: schema 无效 ok:false");
    assert(active.size === 0, "C3b: Maps 已清空");

    // 文件缺失
    rmSync(join(appData, "session-routing.json"));
    r = loadSessionRoutingInto(new Map(), new Map());
    assert(r.ok === false, "C3c: 缺失文件 ok:false");

    console.log("OK C3 损坏/缺失降级");
  } finally {
    process.env.APP_DATA_DIR = prev;
    rmSync(appData, { recursive: true, force: true });
  }
}

/** C4：flush 落盘与内存一致；无残留 .tmp */
function testFlushPersist(): void {
  const appData = makeAppData();
  const prev = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appData;
  try {
    const active = new Map<string, string>([["chat_f", "sk_f::/ws"]]);
    const fallback = new Map<string, string>([["sk_t", "sk_base"]]);
    flushSessionRoutingPersist(active, fallback);

    const filePath = join(appData, "session-routing.json");
    assert(existsSync(filePath), "C4: 磁盘文件存在");
    assert(!existsSync(`${filePath}.tmp`), "C4: 无残留 .tmp");

    const disk = JSON.parse(readFileSync(filePath, "utf8")) as {
      version: number;
      activeSessions: Record<string, { sessionKey: string }>;
      fallbackSessions: Record<string, { fallbackSessionKey: string }>;
    };
    assert(disk.version === 1, "C4: version=1");
    assert(disk.activeSessions.chat_f?.sessionKey === "sk_f::/ws", "C4: active 落盘");
    assert(
      disk.fallbackSessions.sk_t?.fallbackSessionKey === "sk_base",
      "C4: fallback 落盘",
    );

    // debounce 调度不抛异常
    scheduleSessionRoutingPersist(active, fallback);
    console.log("OK C4 flush + schedule");
  } finally {
    process.env.APP_DATA_DIR = prev;
    rmSync(appData, { recursive: true, force: true });
  }
}

/** C5：pruneExpiredEntries 运行期剔除 */
function testRuntimePrune(): void {
  const appData = makeAppData();
  const prev = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appData;
  try {
    const expired = Date.now() - SESSION_ROUTING_TTL_MS - 1000;
    writeRoutingFile(
      appData,
      JSON.stringify({
        version: 1,
        activeSessions: {
          c1: { sessionKey: "s1", lastTouchedAt: expired },
        },
        fallbackSessions: {},
      }),
    );
    const active = new Map<string, string>();
    const fallback = new Map<string, string>();
    loadSessionRoutingInto(active, fallback);
    assert(active.size === 0, "C5: load 已 prune");

    active.set("c2", "s2");
    flushSessionRoutingPersist(active, fallback);
    const n = pruneExpiredEntries(active, fallback);
    assert(n === 0, "C5: 未过期条目 prune=0");
    assert(active.has("c2"), "C5: 新鲜条目保留");
    console.log("OK C5 runtime prune");
  } finally {
    process.env.APP_DATA_DIR = prev;
    rmSync(appData, { recursive: true, force: true });
  }
}

/** curl 封装 */
async function curlJson(
  method: string,
  url: string,
  body?: object,
): Promise<{ code: number; data: unknown }> {
  const args = [
    "-s",
    "-w",
    "%{http_code}",
    "-o",
    "/tmp/kb_session_routing_curl.json",
    "-X",
    method,
    url,
  ];
  if (body) {
    args.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
  }
  const code = await new Promise<string>((resolve, reject) => {
    const p = spawn("curl", args);
    let out = "";
    p.stdout.on("data", (d) => {
      out += String(d);
    });
    p.on("close", (c) => (c === 0 ? resolve(out.trim()) : reject(new Error(`curl exit ${c}`))));
  });
  const raw = readFileSync("/tmp/kb_session_routing_curl.json", "utf8");
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    /* 非 JSON */
  }
  return { code: Number(code), data };
}

/** 启动临时 Daemon 测 HTTP session 路由（需 bundle） */
async function testDaemonHttpPersist(): Promise<void> {
  const daemonBin = join(REPO_ROOT, "dist-bundle/daemon-entry.mjs");
  if (!existsSync(daemonBin)) {
    console.log("SKIP C6 HTTP（dist-bundle 不存在，须 npm run build:bundle）");
    return;
  }

  const appData = join("/tmp", `kb-session-routing-daemon-${process.pid}-${Date.now()}`);
  mkdirSync(appData, { recursive: true });
  const channels = JSON.stringify([
    {
      id: "kb_test",
      name: "kb_test",
      type: "feishu",
      mainUserEnabled: true,
      mainUserChatId: "ou_kb_test",
      allowOthers: false,
      workspaceDir: REPO_ROOT,
    },
  ]);
  const env = {
    ...process.env,
    APP_DATA_DIR: appData,
    LARK_DAEMON_PORT: String(TEST_PORT),
    LARK_WORKSPACE_DIR: REPO_ROOT,
    CLAW_CHANNELS_JSON: channels,
    DAEMON_LOG_PATH: join(appData, "daemon.log"),
  };
  const child: ChildProcess = spawn("node", [daemonBin], { env, stdio: "pipe" });
  let port = 0;
  const onData = (chunk: Buffer) => {
    const m = chunk.toString().match(/port=(\d+)/);
    if (m) port = Number(m[1]);
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);

  try {
    for (let i = 0; i < 40 && port === 0; i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!port) {
      try {
        const lock = JSON.parse(
          readFileSync(join(appData, "daemon.lock.json"), "utf8"),
        ) as { port?: number };
        port = lock.port ?? 0;
      } catch {
        /* ignore */
      }
    }
    if (!port) throw new Error("临时 Daemon 未就绪");

    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 20; i++) {
      try {
        const { code } = await curlJson("GET", `${base}/health`);
        if (code === 200) break;
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    const post = await curlJson("POST", `${base}/api/active-session`, {
      chatId: "chat_http",
      sessionKey: "sk_http::/tmp/ws",
    });
    assert(post.code === 200, `C6: POST active-session 200（got ${post.code}）`);

    await new Promise((r) => setTimeout(r, 700));

    const routingPath = join(appData, "session-routing.json");
    assert(existsSync(routingPath), "C6: debounce 后磁盘存在");
    const disk = JSON.parse(readFileSync(routingPath, "utf8")) as {
      activeSessions: Record<string, { sessionKey: string }>;
    };
    assert(
      disk.activeSessions.chat_http?.sessionKey === "sk_http::/tmp/ws",
      "C6: HTTP 写入落盘",
    );

    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));

    const child2: ChildProcess = spawn("node", [daemonBin], { env, stdio: "pipe" });
    let port2 = 0;
    const onData2 = (chunk: Buffer) => {
      const m = chunk.toString().match(/port=(\d+)/);
      if (m) port2 = Number(m[1]);
    };
    child2.stdout?.on("data", onData2);
    child2.stderr?.on("data", onData2);
    for (let i = 0; i < 40 && port2 === 0; i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!port2) {
      const lock = JSON.parse(
        readFileSync(join(appData, "daemon.lock.json"), "utf8"),
      ) as { port?: number };
      port2 = lock.port ?? 0;
    }
    const base2 = `http://127.0.0.1:${port2}`;
    const get = await curlJson("GET", `${base2}/api/active-sessions`);
    assert(get.code === 200, "C6: 重启后 GET active-sessions 200");
    const body = get.data as { sessions?: Record<string, string> };
    assert(
      body.sessions?.chat_http === "sk_http::/tmp/ws",
      "C6: 重启后路由恢复",
    );
    child2.kill("SIGTERM");
    console.log("OK C6 Daemon HTTP 跨重启恢复");
  } catch (e) {
    child.kill("SIGTERM");
    throw e;
  } finally {
    rmSync(appData, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  console.log("session-routing-persist-contract: 静态 + 模块契约");
  testStaticWiring();
  testLoadValid();
  testLoadTtlPrune();
  testCorruptDegrade();
  testFlushPersist();
  testRuntimePrune();
  await testDaemonHttpPersist();
  console.log("ALL PASS");
}

main().catch((e) => {
  console.error(`FAIL: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
