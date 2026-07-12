/**
 * 工作流恢复入口与信号接口 — 契约冒烟：静态接线 + 可选 Daemon HTTP
 * 运行：./run-workflow-resume-contract.sh
 */
import { spawn, type ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "../../../../..");
const TEST_PORT = Number(process.env.KB_WF_RESUME_TEST_PORT ?? "0");

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

/** 静态：关键符号与 T10 划界 */
function testStaticWiring(): void {
  const files = [
    "electron/workflow/workflow-runner.ts",
    "electron/scheduling/command-handler.ts",
    "src/workflow/server-workflow.ts",
    "src/daemon/daemon-http-workflow-signal.ts",
    "src/daemon/daemon-http-routes.ts",
    "electron/daemon/daemon-manager.ts",
    "electron/preload.ts",
    "src/renderer/env.d.ts",
    "src/renderer/components/WorkflowInstanceDetail.tsx",
  ];
  for (const f of files) {
    assert(existsSync(join(REPO_ROOT, f)), `文件存在: ${f}`);
  }

  assert(sh("grep -c 'export async function resumeWorkflowInstance' electron/workflow/workflow-runner.ts") === "1", "T1 resumeWorkflowInstance");
  assert(sh("grep -c 'export function resumeWorkflowAndEmit' src/workflow/server-workflow.ts") === "1", "T4 resumeWorkflowAndEmit");
  assert(sh("grep -c 'tryHandleWorkflowSignalRoute' src/daemon/daemon-http-routes.ts") >= "1", "T5 路由注册");
  assert(sh("grep -c 'workflow:resume' electron/daemon/daemon-manager.ts") >= "1", "T3 IPC workflow:resume");
  assert(sh("grep -c 'resumeWorkflowInstance' electron/preload.ts") >= "1", "T3 preload");
  assert(sh("grep -c 'sub === \"resume\"' electron/scheduling/command-handler.ts") >= "1", "T2 斜杠 resume");
  assert(sh("grep -c '/workflow resume' electron/scheduling/command-handler.ts") >= "1", "T2 help 文案");

  // T10：无 .fcmd 独路径
  const fcmdHits = sh("grep -r '\\.fcmd' electron/scheduling/command-handler.ts src/daemon/daemon.ts 2>/dev/null | grep -i resume || true");
  assert(fcmdHits === "", "resume 无 .fcmd 绕路");

  // AC-08：恢复路径无 gateway
  const gw = sh("grep -i gateway electron/workflow/workflow-runner.ts src/workflow/server-workflow.ts src/daemon/daemon-http-workflow-signal.ts 2>/dev/null || true");
  assert(gw === "", "恢复路径无 gateway");

  // AC-10：五类 source 日志
  assert(sh("grep -c 'source: \"electron\"' electron/workflow/workflow-runner.ts") >= "1", "log source=electron");
  assert(sh("grep -c 'source: \"ui\"' electron/daemon/daemon-manager.ts") >= "1", "log source=ui");
  assert(sh("grep -c 'source: \"slash\"' electron/scheduling/command-handler.ts") >= "1", "log source=slash");
  assert(sh("grep -c 'source: \"http\"' src/daemon/daemon-http-workflow-signal.ts") >= "1", "log source=http");
  assert(sh("grep -c 'source: \"daemon\"' src/workflow/server-workflow.ts") >= "1", "log source=daemon");

  console.log("OK 静态接线 T1–T5 + T10 + AC-08/10");
}

/** 静态：行数 ≤300（AC-09） */
function testLineLimits(): void {
  const limits: Array<[string, number]> = [
    ["electron/workflow/workflow-runner.ts", 300],
    ["src/renderer/components/WorkflowPanel.tsx", 300],
    ["src/renderer/components/WorkflowInstanceDetail.tsx", 300],
    ["src/workflow/server-workflow.ts", 300],
    ["src/daemon/daemon-http-workflow-signal.ts", 300],
    ["src/daemon/daemon-http-routes.ts", 300],
  ];
  for (const [file, max] of limits) {
    const n = Number(sh(`wc -l < ${file}`));
    assert(n <= max, `${file} ${n} 行 > ${max}`);
  }
  console.log("OK 行数 ≤300（AC-09）");
}

/** curl 封装 */
async function curlJson(
  method: string,
  url: string,
  body?: object,
): Promise<{ code: number; data: unknown }> {
  const args = ["-s", "-w", "%{http_code}", "-o", "/tmp/kb_wf_resume_curl.json", "-X", method, url];
  if (body) {
    args.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
  }
  const code = await new Promise<string>((resolve, reject) => {
    const p = spawn("curl", args);
    let out = "";
    p.stdout.on("data", (d) => { out += String(d); });
    p.on("close", (c) => (c === 0 ? resolve(out.trim()) : reject(new Error(`curl exit ${c}`))));
  });
  const raw = readFileSync("/tmp/kb_wf_resume_curl.json", "utf8");
  let data: unknown = raw;
  try { data = JSON.parse(raw); } catch { /* 非 JSON */ }
  return { code: Number(code), data };
}

/** 启动临时 Daemon */
async function startEphemeralDaemon(): Promise<{ base: string; child: ChildProcess }> {
  const appData = join("/tmp", `kb-wf-resume-${process.pid}-${Date.now()}`);
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
    SLASH_EXEC_MODE: "daemon",
    CLAW_CHANNELS_JSON: channels,
    DAEMON_LOG_PATH: join(appData, "daemon.log"),
  };
  const daemonBin = join(REPO_ROOT, "dist-bundle/daemon-entry.mjs");
  if (!existsSync(daemonBin)) {
    throw new Error("SKIP_HTTP: 须先 npm run build:mcp && npm run build:bundle");
  }
  const bundleSrc = readFileSync(daemonBin, "utf8");
  if (!bundleSrc.includes("workflow-signal")) {
    throw new Error("SKIP_HTTP: bundle 未含 workflow-signal，须先 build:mcp + build:bundle");
  }
  const child: ChildProcess = spawn("node", [daemonBin], { env, stdio: "pipe" });
  let port = 0;
  const onData = (chunk: Buffer) => {
    const text = chunk.toString();
    const m = text.match(/port=(\d+)/);
    if (m) port = Number(m[1]);
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);

  for (let i = 0; i < 40; i++) {
    if (port > 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!port) {
    try {
      const lock = JSON.parse(readFileSync(join(appData, "daemon.lock.json"), "utf8")) as { port?: number };
      port = lock.port ?? 0;
    } catch { /* ignore */ }
  }
  if (!port) {
    child.kill("SIGTERM");
    throw new Error("临时 Daemon 未就绪");
  }
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 20; i++) {
    try {
      const { code } = await curlJson("GET", `${base}/health`);
      if (code === 200) return { base, child };
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill("SIGTERM");
  throw new Error("Daemon health 未就绪");
}

/** HTTP：POST /api/workflow-signal 契约（400/404，无需 paused 实例） */
async function testWorkflowSignalHttp(): Promise<void> {
  const { base, child } = await startEphemeralDaemon();
  try {
    const badAction = await curlJson("POST", `${base}/api/workflow-signal`, {
      action: "pause",
      instanceId: "x",
    });
    assert(badAction.code === 400, `invalid action → 400（got ${badAction.code}）`);

    const noId = await curlJson("POST", `${base}/api/workflow-signal`, { action: "resume" });
    assert(noId.code === 400, `缺 instanceId → 400（got ${noId.code}）`);

    const missing = await curlJson("POST", `${base}/api/workflow-signal`, {
      action: "resume",
      instanceId: "__kb_nonexistent__",
    });
    assert(missing.code === 404, `不存在实例 → 404（got ${missing.code}）`);
    const missBody = missing.data as { ok?: boolean; error?: string };
    assert(missBody.ok === false && missBody.error === "实例不存在", "404 body 含实例不存在");

    console.log("OK HTTP workflow-signal 400/404 契约");
  } finally {
    child.kill("SIGTERM");
  }
}

async function main(): Promise<void> {
  console.log("workflow-resume-contract: 静态 + HTTP");
  testStaticWiring();
  testLineLimits();
  try {
    await testWorkflowSignalHttp();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("SKIP_HTTP:")) {
      console.log(`SKIP HTTP 契约（${msg.replace("SKIP_HTTP: ", "")}）`);
    } else {
      throw e;
    }
  }
  console.log("ALL PASS");
}

main().catch((e) => {
  console.error(`FAIL: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
