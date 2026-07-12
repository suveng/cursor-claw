/**
 * HTTP dispatch 失败重入队对齐 — 契约冒烟（源码静态 + handleLaunchFailure mock）
 * 运行：./run-http-dispatch-retry-contract.sh
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  createDispatchRetry,
  MAX_DISPATCH_RETRIES,
  DISPATCH_BACKOFF_MS,
} from "../../../../../src/daemon/daemon-orchestrator-retry.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "../../../../..");
const SRC = join(ROOT, "src/daemon");

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

function readSrc(name: string): string {
  return readFileSync(join(SRC, name), "utf8");
}

/** 提取 dispatch 路由块（POST /api/agent/dispatch） */
function extractDispatchBlock(src: string): string {
  const start = src.indexOf('pathname === "/api/agent/dispatch"');
  assert(start >= 0, "未找到 POST /api/agent/dispatch 路由");
  return src.slice(start, start + 2500);
}

/** ST-H1～H6：源码接线静态核对 */
function staticContractChecks(): void {
  const routeSrc = readSrc("daemon-http-routes-orchestrator.ts");
  const orchSrc = readSrc("daemon-orchestrator.ts");
  const typesSrc = readSrc("daemon-http-routes-types.ts");
  const daemonSrc = readSrc("daemon.ts");
  const retrySrc = readSrc("daemon-orchestrator-retry.ts");
  const agentsSrc = readSrc("AGENTS.md");
  const block = extractDispatchBlock(routeSrc);

  // ST-H1：失败走 handleLaunchFailure，路由内无 ackMessages
  assert(block.includes("handleLaunchFailure"), "ST-H1: dispatch 失败应调 handleLaunchFailure");
  assert(!block.includes("ackMessages"), "ST-H1: dispatch 路由禁止内联 ackMessages");
  assert(retrySrc.includes("dispatch_retry_scheduled"), "ST-H1: retry 模块含 dispatch_retry_scheduled");
  assert(retrySrc.includes("releaseClaimedMessages"), "ST-H1: retry 含 releaseClaimedMessages");

  // ST-H2：耗尽停试
  assert(retrySrc.includes("dispatch_retry_exhausted"), "ST-H2: 含 dispatch_retry_exhausted");
  assert(retrySrc.includes("已停止自动重试"), "ST-H2: 耗尽通知含停试文案");

  // ST-H3：成功清零、不提前 ack
  assert(block.includes("clearDispatchRetryAttempt"), "ST-H3: 成功分支清零 attempt");
  const okBranch = block.slice(block.indexOf("if (result.ok)"));
  assert(!okBranch.includes("ackMessages"), "ST-H3: 成功分支不 ack");
  assert(daemonSrc.includes("ackOnReply"), "ST-H3: 最终 ack 仍经 ackOnReply");

  // ST-H4：busy 经 handleLaunchFailure + agent_busy_requeue
  assert(block.includes("parseBusyRetryDelayMs"), "ST-H4: busy 解析 retry_after");
  assert(retrySrc.includes("agent_busy_requeue"), "ST-H4: retry 含 agent_busy_requeue");
  assert(!block.includes("scheduleBusyRetry"), "ST-H4: dispatch 路由不再独立 scheduleBusyRetry");

  // ST-H5：IM 与 HTTP 共用 dispatchRetry.handleLaunchFailure
  assert(orchSrc.includes("handleLaunchFailure: dispatchRetry.handleLaunchFailure"), "ST-H5: OrchestratorApi 绑定同一实例");
  assert(orchSrc.includes("await dispatchRetry.handleLaunchFailure"), "ST-H5: IM 路径调 dispatchRetry");
  assert(typesSrc.includes("handleLaunchFailure"), "ST-H5: HttpRoutesDeps 声明 handleLaunchFailure");
  assert(daemonSrc.includes("orchestratorApi.handleLaunchFailure"), "ST-H5: daemon 注入 orchestrator 方法");
  assert(String(MAX_DISPATCH_RETRIES) === "3", "ST-H5: MAX_DISPATCH_RETRIES=3");
  assert(DISPATCH_BACKOFF_MS.join(",") === "600,1200,2400", "ST-H5: 退避序列对齐");

  // ST-H6：HTTP 响应形状不变
  assert(block.includes("deps.json(res, result, result.ok ? 200 : 400)"), "ST-H6: 响应仍 ok/error + 200/400");

  // AGENTS 登记
  assert(agentsSrc.includes("HTTP dispatch 失败重试对齐"), "AGENTS: HTTP dispatch retry 对齐说明");
  assert(agentsSrc.includes("dispatch_retry_scheduled"), "AGENTS: 日志关键字");

  console.log("OK 静态契约 ST-H1～H6 源码核对");
}

/** mock deps：验证 retry 行为（HTTP 与 IM 共用 SSOT） */
async function mockRetryBehavior(): Promise<void> {
  const released: string[][] = [];
  const acked: string[] = [];
  const logs: string[] = [];
  let notifyText = "";

  const retry = createDispatchRetry({
    log: (_lvl, ...args) => logs.push(args.map(String).join(" ")),
    releaseClaimedMessages: (ids) => {
      released.push([...ids]);
      return ids;
    },
    ackMessages: (id) => {
      acked.push(id);
      return [id];
    },
    notifySessionUser: async (_sk, text) => {
      notifyText = text;
    },
    formatOrchestratorFailure: (e) => `失败:${e ?? "unknown"}`,
    scheduleAgentDispatch: () => {},
  });

  // ST-H1：可恢复失败 release + dispatch_retry_scheduled
  const r1 = await retry.handleLaunchFailure({
    sessionKey: "sk_h1",
    messageIds: ["m1"],
    error: "transient",
    busyDelayMs: 0,
  });
  assert(r1 === "retried", "ST-H1 mock: 应返回 retried");
  assert(released.length === 1 && released[0]![0] === "m1", "ST-H1 mock: release 命中");
  assert(logs.some((l) => l.includes("dispatch_retry_scheduled")), "ST-H1 mock: 日志含 dispatch_retry_scheduled");
  assert(acked.length === 0, "ST-H1 mock: 未耗尽禁止 ack");

  // ST-H4：busy 路径 agent_busy_requeue
  logs.length = 0;
  released.length = 0;
  const r4 = await retry.handleLaunchFailure({
    sessionKey: "sk_h4",
    messageIds: ["m_busy"],
    error: "agent_busy",
    busyDelayMs: 1500,
  });
  assert(r4 === "retried", "ST-H4 mock: busy 应 retried");
  assert(logs.some((l) => l.includes("agent_busy_requeue")), "ST-H4 mock: agent_busy_requeue");
  assert(released.length === 1, "ST-H4 mock: busy release");

  // ST-H2：连续失败至耗尽
  const skEx = "sk_h2";
  acked.length = 0;
  notifyText = "";
  for (let i = 0; i < MAX_DISPATCH_RETRIES; i++) {
    await retry.handleLaunchFailure({
      sessionKey: skEx,
      messageIds: ["m_ex"],
      error: "persistent",
      busyDelayMs: 0,
    });
  }
  const rEx = await retry.handleLaunchFailure({
    sessionKey: skEx,
    messageIds: ["m_ex"],
    error: "persistent",
    busyDelayMs: 0,
  });
  assert(rEx === "exhausted", "ST-H2 mock: 耗尽应 exhausted");
  assert(logs.some((l) => l.includes("dispatch_retry_exhausted")), "ST-H2 mock: dispatch_retry_exhausted");
  assert(notifyText.includes("已停止自动重试"), "ST-H2 mock: 停试通知");
  assert(acked.includes("m_ex"), "ST-H2 mock: 耗尽后 ack");

  // ST-H3：成功清零 attempt（clearAttempt 后不再立即 exhausted）
  retry.clearAttempt("sk_h3");
  const r3 = await retry.handleLaunchFailure({
    sessionKey: "sk_h3",
    messageIds: ["m_ok"],
    error: "once",
    busyDelayMs: 0,
  });
  assert(r3 === "retried", "ST-H3 mock: 清零后首次失败仍可重试");
  retry.clearAttempt("sk_h3");

  console.log("OK mock retry ST-H1/H2/H3/H4 行为");
}

/** ST-H7：行数 + tsc */
function engineeringChecks(): void {
  const limits: Array<[string, number]> = [
    ["daemon-http-routes-orchestrator.ts", 300],
    ["daemon-orchestrator.ts", 300],
    ["daemon-http-routes-types.ts", 300],
  ];
  for (const [file, max] of limits) {
    const lines = readSrc(file).split("\n").length;
    assert(lines <= max, `ST-H7: ${file} ${lines} 行 > ${max}`);
  }

  const tsc = spawnSync("npx", ["tsc", "--noEmit"], { cwd: ROOT, encoding: "utf8" });
  assert(tsc.status === 0, `ST-H7: tsc 失败 exit=${tsc.status}`);
  console.log("OK ST-H7 行数 + tsc");
}

async function main(): Promise<void> {
  staticContractChecks();
  await mockRetryBehavior();
  engineeringChecks();
  console.log("PASS http-dispatch-retry-contract");
}

void main();
