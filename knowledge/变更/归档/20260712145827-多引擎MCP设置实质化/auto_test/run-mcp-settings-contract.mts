/**
 * 多引擎 MCP 设置实质化契约冒烟：ST-M1～M5 静态 + mock + 临时 Daemon HTTP
 * 运行：./run-mcp-settings-contract.sh
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeSlashMcp } from "../../../../../src/daemon/daemon-slash-mcp.ts";
import {
  formatMcpHealthDisplay,
  formatMcpHealthDisplayIm,
  formatMcpPanelStatusLabel,
} from "../../../../../src/shared/mcp-health-label.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "../../../../..");
const TEST_PORT = Number(process.env.KB_MCP_TEST_PORT ?? "0");

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

function readRepo(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

/** ST-M1：健康 SSOT 禁止裸「未知」，三处消费对齐 */
function testStaticHealthSsot(): void {
  const ssot = readRepo("src/shared/mcp-health-label.ts");
  assert(!ssot.includes('return "未知"'), "ST-M1: SSOT 无裸「未知」");
  assert(ssot.includes("暂不可查（依赖未就绪）"), "ST-M1: 空 status 降级句");
  for (const rel of [
    "src/daemon/daemon-http-mcp-admin.ts",
    "src/daemon/daemon-slash-mcp.ts",
    "electron/scheduling/command-handler.ts",
  ]) {
    const src = readRepo(rel);
    assert(src.includes("mcp-health-label"), `ST-M1: ${rel} 引用 SSOT`);
  }
  assert(formatMcpHealthDisplay(undefined) === "暂不可查（依赖未就绪）", "ST-M1: 纯函数降级");
  assert(
    formatMcpHealthDisplay(undefined, "应用未运行").includes("应用未运行"),
    "ST-M1: healthError 上浮",
  );
  assert(!formatMcpHealthDisplayIm(undefined).includes("未知"), "ST-M1: IM 格式无未知");
  assert(formatMcpPanelStatusLabel(undefined, "disk") === "未探测", "ST-M1: 面板 disk 空态");
  console.log("OK ST-M1 健康 SSOT");
}

/** ST-M2：Settings Codex/OpenCode 实质化，无静默占位组件 */
function testStaticSettingsBlocks(): void {
  const block = readRepo("src/renderer/components/SettingsMcpEngineBlock.tsx");
  assert(!block.includes("SettingsMcpCodexPlaceholder"), "ST-M2: 无 Codex 占位");
  assert(!block.includes("SettingsMcpOpencodePlaceholder"), "ST-M2: 无 OpenCode 占位");
  assert(block.includes("SettingsMcpDiskReadonly"), "ST-M2: 统一只读块");
  const strategy = readRepo("src/renderer/lib/mcp-view-strategy.ts");
  assert(/case "codex":[\s\S]*supported: true/.test(strategy), "ST-M2: codex supported");
  assert(/case "opencode":[\s\S]*supported: true/.test(strategy), "ST-M2: opencode supported");
  assert(strategy.includes("TOML"), "ST-M2: Codex 编辑引导");
  const settings = readRepo("src/renderer/pages/Settings.tsx");
  assert(settings.includes("SettingsMcpDaemonGuide"), "ST-M2: MCP Tab 挂指引");
  console.log("OK ST-M2 Settings 只读实质化");
}

/** ST-M3：可复制指引与 buildMcpServers 一致 */
function testStaticDaemonGuide(): void {
  const guide = readRepo("src/renderer/components/SettingsMcpDaemonGuide.tsx");
  const inj = readRepo("electron/agent/shared/workspace-injector.ts");
  assert(guide.includes("buildCursorMcpSnippet"), "ST-M3: 片段构建函数");
  assert(guide.includes("cursor-claw"), "ST-M3: 仅 cursor-claw");
  assert(!guide.includes("mcp-admin") || guide.includes("废弃"), "ST-M3: 指引不推荐使用 admin");
  assert(inj.includes('"cursor-claw"'), "ST-M3: injector SSOT 对齐");
  const snippet = JSON.parse(
    `{"mcpServers":{"cursor-claw":{"url":"http://127.0.0.1:19528/mcp"}}}`,
  );
  assert(snippet.mcpServers["cursor-claw"].url.endsWith("/mcp"), "ST-M3: 合法 JSON 形态");
  console.log("OK ST-M3 Daemon 指引片段");
}

/** ST-M4：改动文件 ≤300 行；session 读盘 fallback 已拆 */
function testStaticEngineeringNorms(): void {
  const limits: Array<[string, number]> = [
    ["electron/session/session-mcp-status.ts", 300],
    ["electron/session/session-mcp-disk-fallback.ts", 300],
    ["src/renderer/components/SettingsMcpEngineBlock.tsx", 300],
    ["src/shared/mcp-health-label.ts", 300],
    ["src/renderer/components/SettingsMcpDaemonGuide.tsx", 300],
  ];
  for (const [rel, max] of limits) {
    const lines = readRepo(rel).split("\n").length;
    assert(lines <= max, `ST-M4: ${rel} ${lines} 行 > ${max}`);
  }
  const status = readRepo("electron/session/session-mcp-status.ts");
  assert(status.includes("session-mcp-disk-fallback"), "ST-M4: codex/opencode 读盘拆模块");
  console.log("OK ST-M4 工程规范");
}

/** ST-M5：稳态收尾无回归（/mcp-admin 410、injector 无 admin URL） */
function testStaticSteadyStateRegression(): void {
  const http = readRepo("src/daemon/daemon-http-server.ts");
  assert(http.includes('pathname === "/mcp-admin"'), "ST-M5: /mcp-admin 分支");
  assert(http.includes("410"), "ST-M5: 410 响应");
  const inj = readRepo("electron/agent/shared/workspace-injector.ts");
  const build = inj.match(/export function buildMcpServers[\s\S]*?^}/m)?.[0] ?? "";
  assert(!build.includes("mcp-admin"), "ST-M5: buildMcpServers 无 admin");
  console.log("OK ST-M5 稳态收尾无回归");
}

/** ST-M1 mock：agent-api 不可达时 /mcp ls 健康列含降级句 */
async function testMockSlashMcpHealthDegrade(): Promise<void> {
  const tmpWs = join("/tmp", `kb-mcp-ws-${process.pid}`);
  mkdirSync(join(tmpWs, ".cursor"), { recursive: true });
  writeFileSync(
    join(tmpWs, ".cursor/mcp.json"),
    JSON.stringify({ mcpServers: { "kb-contract": { command: "echo", args: ["ok"] } } }),
  );
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      ok: false,
      status: 503,
      json: async () => ({ error: "应用未运行，请先启动 Cursor Claw" }),
    }) as Response;
  try {
    const res = await executeSlashMcp({ workspaceDir: tmpWs }, "/mcp ls");
    assert(res.ok, "ST-M1 mock: /mcp ls 可回复");
    assert(res.message.includes("暂不可查"), "ST-M1 mock: 含降级前缀");
    assert(!res.message.includes("未知"), "ST-M1 mock: 健康列无未知");
  } finally {
    globalThis.fetch = origFetch;
    rmSync(tmpWs, { recursive: true, force: true });
  }
  console.log("OK ST-M1 mock 斜杠健康降级");
}

async function curlJson(method: string, url: string, body?: object): Promise<{ code: number; data: unknown }> {
  const args = ["-s", "-w", "%{http_code}", "-o", "/tmp/kb_mcp_curl.json", "-X", method, url];
  if (body) args.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
  const code = await new Promise<string>((resolve, reject) => {
    const p = spawn("curl", args);
    let out = "";
    p.stdout.on("data", (d) => { out += String(d); });
    p.on("close", (c) => (c === 0 ? resolve(out.trim()) : reject(new Error(`curl ${c}`))));
  });
  const raw = readFileSync("/tmp/kb_mcp_curl.json", "utf8");
  let data: unknown = raw;
  try { data = JSON.parse(raw); } catch { /* 非 JSON */ }
  return { code: Number(code), data };
}

async function startDaemon(): Promise<{ base: string; child: ChildProcess }> {
  const appData = join("/tmp", `kb-mcp-${process.pid}-${Date.now()}`);
  mkdirSync(appData, { recursive: true });
  const channels = JSON.stringify([{
    id: "kb_mcp", name: "kb_mcp", type: "feishu",
    mainUserEnabled: true, mainUserChatId: "ou_kb", allowOthers: false, workspaceDir: REPO_ROOT,
  }]);
  const env = {
    ...process.env,
    APP_DATA_DIR: appData,
    LARK_DAEMON_PORT: String(TEST_PORT),
    LARK_WORKSPACE_DIR: REPO_ROOT,
    CLAW_CHANNELS_JSON: channels,
    SLASH_EXEC_MODE: "daemon",
  };
  const child = spawn("node", [join(REPO_ROOT, "dist-bundle/daemon-entry.mjs")], { env, stdio: "pipe" });
  let port = 0;
  const onData = (chunk: Buffer) => {
    const m = chunk.toString().match(/port=(\d+)/);
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
      if ((await curlJson("GET", `${base}/health`)).code === 200) return { base, child };
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill("SIGTERM");
  throw new Error("health 未就绪");
}

/** ST-M5 HTTP：/mcp-admin 410 + /api/mcp 可用 */
async function testDaemonHttpRegression(): Promise<void> {
  const { base, child } = await startDaemon();
  try {
    const admin = await curlJson("GET", `${base}/mcp-admin`);
    assert(admin.code === 410, `ST-M5: /mcp-admin 410（got ${admin.code}）`);
    const api = await curlJson("GET", `${base}/api/mcp`);
    assert(api.code === 200, "ST-M5: GET /api/mcp 200");
    console.log("OK ST-M5 Daemon HTTP 回归");
  } finally { child.kill("SIGTERM"); }
}

async function main(): Promise<void> {
  console.log("mcp-settings-contract: ST-M1～M5");
  testStaticHealthSsot();
  testStaticSettingsBlocks();
  testStaticDaemonGuide();
  testStaticEngineeringNorms();
  testStaticSteadyStateRegression();
  await testMockSlashMcpHealthDegrade();
  await testDaemonHttpRegression();
  console.log("ALL PASS");
}

main().catch((e) => {
  console.error(`FAIL: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
