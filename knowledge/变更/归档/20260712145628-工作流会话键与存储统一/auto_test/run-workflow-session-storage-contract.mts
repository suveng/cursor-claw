/**
 * 工作流会话键与存储统一 — 契约冒烟：ST-WF1～WF6 + tsc
 * 运行：./run-workflow-session-storage-contract.sh
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "../../../../..");

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
  const dir = join("/tmp", `kb-wf-session-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 静态：存储 SSOT 接线（ST-WF2/ST-WF3/ST-WF4） */
function testStaticWiring(): void {
  const files = [
    "src/workflow/workflow-path.ts",
    "src/workflow/workflow-session-key.ts",
    "src/workflow/workflow-store.ts",
    "electron/workflow/workflow-file.ts",
    "electron/workflow/workflow-runner.ts",
    "electron/session/session-dispatcher-launch.ts",
    "src/workflow/server-workflow.ts",
    "src/workflow/workflow-engine.ts",
  ];
  for (const f of files) {
    assert(existsSync(join(REPO_ROOT, f)), `文件存在: ${f}`);
  }

  // ST-WF2：runner 不经 workflow-store 直读
  const runnerStore = sh(
    "grep 'workflow-store' electron/workflow/workflow-runner.ts 2>/dev/null || true",
  );
  assert(runnerStore === "", "ST-WF2 runner 不直接 import workflow-store");

  assert(
    sh("grep -c 'from \"../../src/workflow/workflow-store\"' electron/workflow/workflow-file.ts") >= "1",
    "ST-WF2 workflow-file 委托 store",
  );
  assert(
    sh("grep -c 'resolveWorkflowRoot' src/workflow/workflow-path.ts") >= "1",
    "ST-WF2 resolveWorkflowRoot 存在",
  );
  assert(
    sh("grep -c 'canUseStorage' src/workflow/workflow-store.ts") >= "1",
    "ST-WF2 APP_DATA_DIR 未设时 no-op 守卫",
  );

  // ST-WF3：resume/run 传持久 sessionKey
  assert(
    sh("grep -c 'sessionKey: fresh.sessionKey' electron/workflow/workflow-runner.ts") >= "2",
    "ST-WF3 runner run/resume 传 sessionKey",
  );
  assert(
    sh("grep -c 'sessionKey?: string' electron/session/session-dispatcher-launch.ts") >= "1",
    "ST-WF3 launchWorkflowAgent 接受 sessionKey?",
  );
  assert(
    sh("grep -c 'sessionKey: inst.sessionKey' src/workflow/server-workflow.ts") >= "1",
    "ST-WF3 emitLaunch payload 含 sessionKey",
  );
  assert(
    sh("grep -c 'assignInstanceSessionKey' src/workflow/workflow-engine.ts") >= "1",
    "ST-WF1 引擎调用 assignInstanceSessionKey",
  );

  // ST-WF4：非目标未扩面（既有 create/update 保留，不新增 action/斜杠/Gateway）
  const gw = sh(
    "grep -i gateway src/workflow/workflow-path.ts src/workflow/workflow-store.ts electron/workflow/workflow-file.ts 2>/dev/null || true",
  );
  assert(gw === "", "ST-WF4 存储路径无 gateway");
  const enumLine = sh("grep 'action: z.enum' src/workflow/server-workflow.ts || true");
  assert(
    enumLine.includes('"list"') && enumLine.includes('"run"') && enumLine.includes('"status"'),
    "ST-WF4 manage_workflows 基线 action 仍在",
  );
  assert(!enumLine.includes('"resume"'), "ST-WF4 manage_workflows 未扩 resume");
  const wfCreateSlash = sh(
    "grep '/workflow create' electron/scheduling/command-handler.ts 2>/dev/null || true",
  );
  assert(wfCreateSlash === "", "ST-WF4 斜杠未扩 /workflow create");

  // ST-WF5：工作流键不写入 session-routing 模块
  const wfInRouting = sh(
    "grep -E '::wf_|workflow-session-key|buildWorkflowSessionKey' src/daemon/daemon-session-routing-persist.ts 2>/dev/null || true",
  );
  assert(wfInRouting === "", "ST-WF5 session-routing 模块无工作流键写入");

  console.log("OK 静态接线 ST-WF2/ST-WF3/ST-WF4/ST-WF5");
}

/** 静态：新文件行数 ≤300 */
function testLineLimits(): void {
  const limits: Array<[string, number]> = [
    ["src/workflow/workflow-path.ts", 300],
    ["src/workflow/workflow-session-key.ts", 300],
    ["src/workflow/workflow-store.ts", 300],
    ["electron/workflow/workflow-file.ts", 300],
  ];
  for (const [file, max] of limits) {
    const n = Number(sh(`wc -l < ${file}`));
    assert(n <= max, `${file} ${n} 行 > ${max}`);
  }
  console.log("OK 行数 ≤300");
}

/** ST-WF1：isolated 路径 sessionKey 落盘可读 */
async function testSessionKeyPersist(): Promise<void> {
  const appData = makeAppData();
  const prev = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appData;
  try {
    const { saveInstance, getInstance } = await import(
      "../../../../../src/workflow/workflow-store.ts"
    );
    const { assignInstanceSessionKey, buildWorkflowSessionKey } = await import(
      "../../../../../src/workflow/workflow-session-key.ts"
    );

    const base = {
      id: "kb_wf_st1",
      workflowId: "builtin_demo",
      status: "paused" as const,
      currentNodeId: "node_iso",
      context: {},
      nodeHistory: [],
      notifyChatId: "feishu::ou_test",
      workingDirectory: REPO_ROOT,
      maxSteps: 50,
      stepCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const withKey = assignInstanceSessionKey(base, "node_iso");
    const expected = buildWorkflowSessionKey("feishu::ou_test", "kb_wf_st1", "node_iso");
    assert(withKey.sessionKey === expected, "ST-WF1 assignInstanceSessionKey 格式");

    saveInstance(withKey);
    const loaded = getInstance("kb_wf_st1");
    assert(loaded?.sessionKey === expected, "ST-WF1 磁盘 JSON 含 sessionKey");

    const fp = join(appData, "workflows", "instances", "kb_wf_st1.json");
    assert(existsSync(fp), "ST-WF1 实例文件在 SSOT instances/");
    const raw = JSON.parse(readFileSync(fp, "utf8")) as { sessionKey?: string };
    assert(raw.sessionKey === expected, "ST-WF1 JSON 字段 sessionKey 一致");
  } finally {
    if (prev === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = prev;
    rmSync(appData, { recursive: true, force: true });
  }
  console.log("OK ST-WF1 sessionKey 落盘");
}

/** ST-WF2/ST-WF6：路径解析与存储根日志 */
async function testWorkflowRootAndLog(): Promise<void> {
  const appData = makeAppData();
  const prev = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appData;
  try {
    const { resolveWorkflowRoot, logWorkflowStorageRootOnce } = await import(
      "../../../../../src/workflow/workflow-path.ts"
    );
    const root = resolveWorkflowRoot();
    assert(root === join(appData, "workflows"), "ST-WF2 SSOT 路径 = APP_DATA_DIR/workflows");

    const lines: string[] = [];
    const origInfo = console.info;
    console.info = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    logWorkflowStorageRootOnce();
    console.info = origInfo;
    assert(
      lines.some((l) => l.includes(`workflow_storage_root=${root}`)),
      "ST-WF6 workflow_storage_root 日志可观测",
    );
  } finally {
    if (prev === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = prev;
    rmSync(appData, { recursive: true, force: true });
  }
  console.log("OK ST-WF2/ST-WF6 路径与存储根日志");
}

/** ST-WF5：示例 session-routing.json 不含 ::wf_ 工作流键 */
function testSessionRoutingNoWfKeys(): void {
  const appData = makeAppData();
  const sample = {
    version: 1,
    activeSessions: {
      chat_a: { sessionKey: "feishu::ou_a::/tmp/ws", lastTouchedAt: Date.now() },
    },
    fallbackSessions: {},
  };
  const file = join(appData, "session-routing.json");
  mkdirSync(appData, { recursive: true });
  writeFileSync(file, JSON.stringify(sample), "utf8");
  const text = readFileSync(file, "utf8");
  assert(!text.includes("::wf_"), "ST-WF5 session-routing 样例无 ::wf_ 工作流键");
  rmSync(appData, { recursive: true, force: true });
  console.log("OK ST-WF5 无双写工作流键");
}

/** tsc 编译门禁 */
function testTsc(): void {
  sh("npm run build:mcp");
  console.log("OK tsc（build:mcp）");
}

async function main(): Promise<void> {
  console.log("workflow-session-storage-contract: ST-WF1～WF6 + tsc");
  testStaticWiring();
  testLineLimits();
  await testWorkflowRootAndLog();
  await testSessionKeyPersist();
  testSessionRoutingNoWfKeys();
  testTsc();
  console.log("ALL PASS");
}

main().catch((e) => {
  console.error(`FAIL: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
