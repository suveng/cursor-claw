/**
 * 斜杠执行模式稳态收尾契约冒烟：ST-S1～S7 静态 + mock + 临时 Daemon HTTP
 * 运行：./run-slash-steady-state-contract.sh
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeSlashCommand, type SlashExecutorDeps } from "../../../../../src/daemon/daemon-slash-executor.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "../../../../..");
const TEST_PORT = Number(process.env.KB_SLASH_TEST_PORT ?? "0");

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

function readRepo(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

/** ST-S1/S6 静态：默认 daemon 与非法回退 */
function testStaticDefaultDaemon(): void {
  const daemonTs = readRepo("src/daemon/daemon.ts");
  assert(/SLASH_EXEC_MODE \?\? "daemon"/.test(daemonTs), "ST-S1: getSlashExecMode 默认 daemon");
  assert(/return "daemon"/.test(daemonTs), "ST-S1: 非法值回退 daemon");
  const mgr = readRepo("electron/daemon/daemon-manager.ts");
  assert(/SLASH_EXEC_MODE \?\? "daemon"/.test(mgr), "ST-S1: resolveSlashExecMode 默认 daemon");
  console.log("OK ST-S1 静态默认 daemon");
}

/** ST-S2 静态：daemon 默认不写 .fcmd */
function testStaticNoDefaultDualWrite(): void {
  const src = readRepo("src/daemon/daemon.ts");
  assert(src.includes("if (mode === \"dual\")"), "ST-S2: dual 分支存在");
  assert(src.includes("daemon 默认不写 fcmd"), "ST-S2: dual-only 注释");
  const routes = readRepo("src/daemon/daemon-http-non-api-routes.ts");
  assert(routes.includes("仅 dual|electron 斜杠兼容"), "ST-S2: /commands 注释 dual-only");
  console.log("OK ST-S2 静态无双写主路径");
}

/** ST-S4 静态：/mcp-admin 移除与 injector 收口 */
function testStaticMcpAdminRemoved(): void {
  const http = readRepo("src/daemon/daemon-http-server.ts");
  assert(http.includes('pathname === "/mcp-admin"'), "ST-S4: /mcp-admin 分支存在");
  assert(http.includes("410"), "ST-S4: 返回 410");
  assert(!http.includes("createAdminMcpServer"), "ST-S4: 不再监听 admin MCP");
  const inj = readRepo("electron/agent/shared/workspace-injector.ts");
  const build = inj.match(/export function buildMcpServers[\s\S]*?^}/m)?.[0] ?? "";
  assert(build.includes('"cursor-claw"'), "ST-S4: 仍注入 cursor-claw");
  assert(!build.includes("mcp-admin"), "ST-S4: buildMcpServers 无 admin URL");
  assert(inj.includes("cursor-claw-admin"), "ST-S4: CLAW_MCP_KEYS 保留 cleanup");
  console.log("OK ST-S4 静态 mcp-admin 移除");
}

/** ST-S6 静态：改动文件行数（daemon.ts 历史债务除外） */
function testStaticEngineeringNorms(): void {
  const limits: Array<[string, number]> = [
    ["electron/agent/shared/workspace-injector.ts", 300],
    ["src/daemon/daemon-http-server.ts", 300],
    ["src/daemon/daemon-http-non-api-routes.ts", 300],
  ];
  for (const [rel, max] of limits) {
    const lines = readRepo(rel).split("\n").length;
    assert(lines <= max, `ST-S6: ${rel} ${lines} 行 > ${max}`);
  }
  console.log("OK ST-S6 静态工程规范（改动文件 ≤300）");
}

function makeDeps(opts: { electronMessage?: string } = {}): {
  deps: SlashExecutorDeps;
  replies: Array<{ messageId: string; text: string }>;
} {
  const replies: Array<{ messageId: string; text: string }> = [];
  const deps: SlashExecutorDeps = {
    log: () => {},
    replyToMessage: async (messageId, text) => { replies.push({ messageId, text }); },
    forwardElectronCommandApi: async () => ({
      ok: false,
      error: opts.electronMessage ?? "❌ 应用未运行，请先启动 Cursor Claw",
    }),
    getSlashExecMode: () => "daemon",
    workspaceDir: REPO_ROOT,
    pkgVersion: "contract-test",
    getUptime: () => 120_000,
    getFileQueueLength: () => 0,
    getFileQueueMessages: () => [],
    clearFileQueue: () => 0,
    readTasks: () => [],
    isElectronApiReachable: () => false,
  };
  return { deps, replies };
}

/** ST-S1/S5 mock：默认 daemon 本地斜杠不经 Electron */
async function testMockLocalSlash(): Promise<void> {
  const { deps, replies } = makeDeps();
  await executeSlashCommand(deps, "/status", "st_s1", "c1", "p2p", "im");
  assert(replies.length === 1 && replies[0]!.text.includes("Daemon"), "ST-S1 mock: /status 本地回复");
  await executeSlashCommand(deps, "/help", "st_s5h", "c1", "p2p", "im");
  assert(replies.length === 2 && replies[1]!.text.length > 20, "ST-S5 mock: /help 可回复");
  await executeSlashCommand(deps, "/stop", "st_s5s", "c1", "p2p", "im");
  assert(replies[2]!.text.includes("未运行"), "ST-S5 mock: /stop 未运行文案");
  console.log("OK ST-S1/S5 mock 本地斜杠");
}

/** ST-S7：/merge 不进入通用执行器 */
async function testMergeIsolation(): Promise<void> {
  const { deps, replies } = makeDeps();
  await executeSlashCommand(deps, "/merge", "st_s7", "c1", "p2p", "im");
  assert(replies.length === 0, "ST-S7: /merge 无通用 reply");
  console.log("OK ST-S7 merge 划界");
}

async function curlJson(method: string, url: string, body?: object): Promise<{ code: number; data: unknown }> {
  const args = ["-s", "-w", "%{http_code}", "-o", "/tmp/kb_steady_curl.json", "-X", method, url];
  if (body) args.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
  const code = await new Promise<string>((resolve, reject) => {
    const p = spawn("curl", args);
    let out = "";
    p.stdout.on("data", (d) => { out += String(d); });
    p.on("close", (c) => (c === 0 ? resolve(out.trim()) : reject(new Error(`curl ${c}`))));
  });
  const raw = readFileSync("/tmp/kb_steady_curl.json", "utf8");
  let data: unknown = raw;
  try { data = JSON.parse(raw); } catch { /* 非 JSON */ }
  return { code: Number(code), data };
}

/** 启动临时 Daemon；mode 未传则删除 SLASH_EXEC_MODE 测默认 */
async function startDaemon(mode?: "daemon" | "dual"): Promise<{
  base: string; appData: string; child: ChildProcess; logs: string;
}> {
  const appData = join("/tmp", `kb-steady-${process.pid}-${Date.now()}`);
  mkdirSync(appData, { recursive: true });
  const channels = JSON.stringify([{
    id: "kb_steady", name: "kb_steady", type: "feishu",
    mainUserEnabled: true, mainUserChatId: "ou_kb", allowOthers: false, workspaceDir: REPO_ROOT,
  }]);
  const env = { ...process.env, APP_DATA_DIR: appData, LARK_DAEMON_PORT: String(TEST_PORT),
    LARK_WORKSPACE_DIR: REPO_ROOT, CLAW_CHANNELS_JSON: channels,
    DAEMON_LOG_PATH: join(appData, "daemon.log") };
  if (mode === undefined) delete env.SLASH_EXEC_MODE;
  else env.SLASH_EXEC_MODE = mode;
  const child = spawn("node", [join(REPO_ROOT, "dist-bundle/daemon-entry.mjs")], { env, stdio: "pipe" });
  let logs = "";
  let port = 0;
  const onData = (chunk: Buffer) => {
    const text = chunk.toString();
    logs += text;
    const m = text.match(/port=(\d+)/);
    if (m) port = Number(m[1]);
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  for (let i = 0; i < 40 && !port; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (!port) {
      try {
        const lock = JSON.parse(readFileSync(join(appData, "daemon.lock.json"), "utf8")) as { port?: number };
        port = lock.port ?? 0;
      } catch { /* retry */ }
    }
  }
  if (!port) { child.kill("SIGTERM"); throw new Error("Daemon 未就绪"); }
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 20; i++) {
    try {
      if ((await curlJson("GET", `${base}/health`)).code === 200) {
        // 启动日志可能仅在 DAEMON_LOG_PATH 文件（stderr 缓冲竞态）
        try {
          logs += readFileSync(join(appData, "daemon.log"), "utf8");
        } catch { /* 文件尚未落盘 */ }
        return { base, appData, child, logs };
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill("SIGTERM");
  throw new Error("health 未就绪");
}

/** ST-S1 运行时：未设 env 启动日志含 SLASH_EXEC_MODE=daemon */
async function testDaemonDefaultStartupLog(): Promise<void> {
  const { child, logs, base } = await startDaemon();
  try {
    assert(logs.includes("SLASH_EXEC_MODE=daemon"), "ST-S1: 启动日志默认 daemon");
    const cmds = await curlJson("GET", `${base}/commands`);
    assert(cmds.code === 200, "ST-S2: /commands 可访问");
    const body = cmds.data as { commands?: unknown[] };
    assert(Array.isArray(body.commands) && body.commands.length === 0, "ST-S2: 默认无 .fcmd 待执行");
    console.log("OK ST-S1 运行时启动日志 + ST-S2 无 fcmd 队列");
  } finally { child.kill("SIGTERM"); }
}

/** ST-S3/ST-S4 HTTP 契约 */
async function testDaemonHttpContracts(): Promise<void> {
  const { base, child } = await startDaemon("dual");
  try {
    const admin = await curlJson("GET", `${base}/mcp-admin`);
    assert(admin.code === 410, `ST-S4: /mcp-admin 410（got ${admin.code}）`);
    const hint = JSON.stringify(admin.data);
    assert(hint.includes("/api/mcp") || hint.includes("/mcp"), "ST-S4: 410 body 指引新入口");
    const mcp = await curlJson("GET", `${base}/api/mcp`);
    assert(mcp.code === 200, "ST-S4: GET /api/mcp 200");
    const skip = await curlJson("GET", `${base}/commands/skip-check?messageId=kb_dual_test`);
    assert(skip.code === 200, "ST-S3: dual skip-check 路由 200");
    console.log("OK ST-S3 dual skip-check + ST-S4 mcp-admin/api/mcp");
  } finally { child.kill("SIGTERM"); }
}

async function main(): Promise<void> {
  console.log("slash-steady-state-contract: ST-S1～S7");
  testStaticDefaultDaemon();
  testStaticNoDefaultDualWrite();
  testStaticMcpAdminRemoved();
  testStaticEngineeringNorms();
  await testMockLocalSlash();
  await testMergeIsolation();
  await testDaemonDefaultStartupLog();
  await testDaemonHttpContracts();
  console.log("ALL PASS");
}

main().catch((e) => {
  console.error(`FAIL: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
