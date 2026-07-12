/**
 * 三引擎续接终态 hardening — ST-R1～ST-R6 契约冒烟
 * 运行：./run-recover-hardening-contract.sh
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyResumeFailure,
  notifyResumeFailure,
} from "../../../../../electron/agent/shared/run-resume-notify.ts";
import {
  resetSendTextCapture,
  sendTextCalls,
} from "../../../../../knowledge/变更/归档/20260711232258-四引擎 Engine Port 与 RunLifecycle 抽象/auto_test/stubs/daemon-client-stub.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "../../../../..");

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

function readRepo(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

/** 断言 recover 循环 try 块内 probe 在 enterGuardWithLifecycle 之前 */
function assertProbeBeforeGuard(recoverFile: string, probeCall: string): void {
  const src = readRepo(recoverFile);
  const tryBlock = src.match(/try \{[\s\S]*?await probe[\s\S]*?\} catch/m)?.[0] ?? "";
  assert(tryBlock.includes(probeCall), `${recoverFile} try 块缺少 ${probeCall}`);
  const probeIdx = tryBlock.indexOf(probeCall);
  const guardIdx = tryBlock.indexOf("enterGuardWithLifecycle");
  assert(guardIdx >= 0, `${recoverFile} try 块缺少 enterGuardWithLifecycle`);
  assert(probeIdx < guardIdx, `${recoverFile}: probe 须在 guard 之前`);
}

/** ST-R1：三引擎 guard 前等价探活 + 终态分类 */
function testStR1ProbeWiring(): void {
  assert(existsSync(join(REPO_ROOT, "electron/agent/claude-code/cc-run-probe.ts")), "cc-run-probe.ts 存在");
  assert(existsSync(join(REPO_ROOT, "electron/agent/codex/codex-run-probe.ts")), "codex-run-probe.ts 存在");

  assertProbeBeforeGuard("electron/agent/claude-code/cc-run-recover.ts", "await probeCcRecoverTarget");
  assertProbeBeforeGuard("electron/agent/codex/codex-run-recover.ts", "await probeCodexRecoverTarget");
  assertProbeBeforeGuard("electron/agent/opencode/opencode-run-recover.ts", "await probeOpencodeRecoverTarget");

  const oc = classifyResumeFailure("opencode", "OpenCode session 已失效");
  assert(oc.category === "unrecoverable" && oc.reason === "会话已失效", "ST-R1: OpenCode 失效→unrecoverable");
  const cx = classifyResumeFailure("codex", "运行已结束");
  assert(cx.category === "unrecoverable", "ST-R1: Codex 终态→unrecoverable");

  console.log("OK ST-R1 三引擎 probe 挂接与终态分类");
}

/** ST-R2：Codex CLI 缺失逐条 notify，禁止整函数静默早退 */
function testStR2CodexCliMissing(): void {
  const src = readRepo("electron/agent/codex/codex-run-recover.ts");
  assert(src.includes("failAllCodexRunsOnCliMissing"), "ST-R2: failAllCodexRunsOnCliMissing 存在");
  assert(src.includes("notifyResumeFailure(record.sessionKey, cliError, \"unrecoverable\")"), "ST-R2: CLI 缺失逐条 notify");
  assert(!/if \(!cliCheck\.ok\) \{\s*return/.test(src), "ST-R2: 无 CLI 失败即 return 早退");

  const cli = classifyResumeFailure("codex", "未检测到 Codex CLI，请先安装");
  assert(cli.category === "unrecoverable" && /CLI/.test(cli.reason), "ST-R2: CLI 文案分类");

  console.log("OK ST-R2 Codex CLI 缺失可感知");
}

/** ST-R3：retryable vs unrecoverable IM 尾句 */
async function testStR3FailureCategory(): Promise<void> {
  const retry = classifyResumeFailure("opencode", "ECONNREFUSED connect");
  assert(retry.category === "retryable", "ST-R3: 瞬时网络→retryable");
  const unrec = classifyResumeFailure("cc", "CC session 不存在或已结束");
  assert(unrec.category === "unrecoverable", "ST-R3: CC 终态→unrecoverable");

  resetSendTextCapture();
  await notifyResumeFailure("__st_r3_retry__", "会话恢复失败", "retryable");
  assert(sendTextCalls.length === 1, "ST-R3: retryable notify 已调用");
  const retryBody = sendTextCalls[0]!.body as { text?: string; stop_progress?: boolean };
  assert(String(retryBody.text).includes("重试"), "ST-R3: retryable IM 含重试");
  assert(retryBody.stop_progress === true, "ST-R3: stop_progress true");

  resetSendTextCapture();
  await notifyResumeFailure("__st_r3_unrec__", "运行已结束", "unrecoverable");
  const unrecBody = sendTextCalls[0]!.body as { text?: string };
  assert(String(unrecBody.text).includes("新任务"), "ST-R3: unrecoverable IM 含新任务");

  const notifySrc = readRepo("electron/agent/shared/run-resume-notify.ts");
  assert(notifySrc.includes("RETRYABLE_TAIL"), "ST-R3: RETRYABLE_TAIL 存在");
  assert(notifySrc.includes("UNRECOVERABLE_TAIL"), "ST-R3: UNRECOVERABLE_TAIL 存在");

  console.log("OK ST-R3 失败分类与 IM 尾句");
}

/** ST-R4：成功续接主路径 start*Run 未移除 */
function testStR4SuccessPath(): void {
  assert(readRepo("electron/agent/claude-code/cc-run-recover.ts").includes("startCcQuery("), "ST-R4: startCcQuery");
  assert(readRepo("electron/agent/codex/codex-run-recover.ts").includes("startCodexRun("), "ST-R4: startCodexRun");
  assert(readRepo("electron/agent/opencode/opencode-run-recover.ts").includes("startOpencodeRun("), "ST-R4: startOpencodeRun");

  const orch = readRepo("electron/agent/shared/agent-run-recover-orchestrator.ts");
  assert(orch.includes("recoverCcActiveRuns"), "ST-R4: orchestrator 仍调 CC recover");
  assert(orch.includes("recoverCodexActiveRuns"), "ST-R4: orchestrator 仍调 Codex recover");

  console.log("OK ST-R4 成功续接主路径保留");
}

/** ST-R5：Cursor getRun 终态分支未改 */
function testStR5CursorNoRegression(): void {
  const sdk = readRepo("electron/agent/cursor-sdk/sdk-run-recover.ts");
  assert(sdk.includes("Agent.getRun"), "ST-R5: Agent.getRun 保留");
  assert(/run\.status === "finished"/.test(sdk), "ST-R5: 终态 status 判定保留");
  assert(sdk.includes('notifyResumeFailure(sessionKey, "运行已结束")'), "ST-R5: 终态 notify 调用保留");

  const diff = execSync("git diff -- electron/agent/cursor-sdk/sdk-run-recover.ts", {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  assert(diff === "", "ST-R5: sdk-run-recover.ts 无业务 diff");

  console.log("OK ST-R5 Cursor 无回归");
}

/** ST-R6：未扩大 IM 入队 / Gateway / orchestrator 编排 */
function testStR6ScopeBound(): void {
  const orch = readRepo("electron/agent/shared/agent-run-recover-orchestrator.ts");
  assert(!orch.includes("probe"), "ST-R6: orchestrator 无 probe");
  assert(!orch.includes("ResumeFailureCategory"), "ST-R6: orchestrator 无分类类型");

  for (const rel of ["src/bridge/file-queue.ts", "src/daemon/daemon.ts"]) {
    const src = readRepo(rel);
    assert(!src.includes("probeCcRecoverTarget"), `ST-R6: ${rel} 无 recover probe`);
    assert(!src.includes("ResumeFailureCategory"), `ST-R6: ${rel} 无失败分类`);
  }

  console.log("OK ST-R6 范围克制");
}

/** 工程规范：改动文件 ≤300 行 */
function testEngineeringNorms(): void {
  const files = [
    "electron/agent/shared/run-resume-notify.ts",
    "electron/agent/codex/codex-run-recover.ts",
    "electron/agent/codex/codex-run-probe.ts",
    "electron/agent/claude-code/cc-run-recover.ts",
    "electron/agent/claude-code/cc-run-probe.ts",
    "electron/agent/opencode/opencode-run-recover.ts",
  ];
  for (const rel of files) {
    const lines = readRepo(rel).split("\n").length;
    assert(lines <= 300, `${rel} ${lines} 行 > 300`);
  }
  console.log("OK 工程规范 单文件≤300行");
}

async function main(): Promise<void> {
  console.log("run-recover-hardening-contract: 开始");
  testStR1ProbeWiring();
  testStR2CodexCliMissing();
  await testStR3FailureCategory();
  testStR4SuccessPath();
  testStR5CursorNoRegression();
  testStR6ScopeBound();
  testEngineeringNorms();
  console.log("run-recover-hardening-contract: ALL PASS");
}

main().catch((e: unknown) => {
  console.error(`FAIL: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
