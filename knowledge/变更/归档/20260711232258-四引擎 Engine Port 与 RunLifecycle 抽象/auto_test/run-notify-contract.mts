/**
 * D3 契约冒烟：终态 notify / guard busy / RunLifecycle.resume
 * 运行：./run-notify-contract.sh 或 npm run test:run-notify-contract
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createOrchestratorNotify } from "../../../../../src/daemon/daemon-orchestrator-notify.ts"
import {
  enterGuardWithLifecycle,
  releaseRunGuard,
} from "../../../../../electron/agent/shared/agent-run-guard.ts"
import { completeRunFromTemplate } from "../../../../../electron/agent/shared/run-complete-template.ts"
import { createRunLifecycle } from "../../../../../electron/agent/shared/run-lifecycle.ts"
import type { RunLifecycleSessionSlice } from "../../../../../electron/agent/shared/run-lifecycle-types.ts"
import {
  resetSendTextCapture,
  sendTextCalls,
} from "./stubs/daemon-client-stub.mjs"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..")

function resetCapture(): void {
  resetSendTextCapture()
}

function installHttpCapture(): void {
  resetCapture()
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

function assertStopProgressNotify(label: string): void {
  assert(sendTextCalls.length >= 1, `${label}: notify 未被调用`)
  const last = sendTextCalls[sendTextCalls.length - 1]
  const body = last.body as Record<string, unknown>
  assert(String(last.url).includes("/api/send-text"), `${label}: URL 非 send-text`)
  assert(body.stop_progress === true, `${label}: payload 缺少 stop_progress: true`)
  console.log(`OK ${label}`)
}

/** 静态契约：源码终态路径须含 stop_progress */
function assertStaticContracts(): void {
  const checks: Array<{ file: string; patterns: RegExp[] }> = [
    {
      file: "electron/agent/shared/run-complete-template.ts",
      patterns: [
        /notifySessionChat\([^)]*stop_progress:\s*true/,
      ],
    },
    {
      file: "electron/agent/shared/agent-run-guard.ts",
      patterns: [/notifySessionChat\([^)]*stop_progress:\s*true/],
    },
    {
      file: "src/daemon/daemon-http-routes-orchestrator.ts",
      patterns: [/notifySessionUser\([\s\S]{0,240}?,\s*true\s*,/],
    },
    {
      file: "electron/agent/cursor-sdk/sdk-run-finalize.ts",
      patterns: [/completeRunFromTemplate|enterNotifying/],
    },
  ]
  for (const { file, patterns } of checks) {
    const text = readFileSync(join(REPO_ROOT, file), "utf8")
    for (const re of patterns) {
      assert(re.test(text), `静态契约 ${file} 未匹配 ${re}`)
    }
    console.log(`OK 静态契约 ${file}`)
  }
}

/** S7：resume 清零 errorNotified / runFinalizing */
function testRunLifecycleResume(): void {
  const session: RunLifecycleSessionSlice = {
    sessionKey: "__contract_resume__",
    errorNotified: true,
    runFinalizing: true,
  }
  const lifecycle = createRunLifecycle(session)
  lifecycle.resume()
  assert(session.errorNotified === false, "S7: errorNotified 未清零")
  assert(session.runFinalizing === false, "S7: runFinalizing 未清零")
  assert(lifecycle.phase === "guarding", "S7: phase 未回到 guarding")
  console.log("OK S7 RunLifecycle.resume")
}

/** S8：enterGuardWithLifecycle busy 路径触发 notify + stop_progress */
async function testGuardBusyNotify(): Promise<void> {
  const sessionKey = "__contract_guard_busy__"
  const holder = enterGuardWithLifecycle({ sessionKey })
  assert(holder.result === "allowed", "S8 setup: 首次 guard 应 allowed")

  resetCapture()
  const busy = enterGuardWithLifecycle({ sessionKey, errorNotified: false })
  assert(busy.result === "busy", "S8: 并发 guard 应 busy")
  await new Promise((r) => setTimeout(r, 50))
  assertStopProgressNotify("S8 guard busy")

  releaseRunGuard(sessionKey, holder.token)
}

/** S1 成功 / S4 失败 / 取消：completeRunFromTemplate 终态 notify */
async function testCompleteRunNotifyPaths(): Promise<void> {
  resetCapture()
  await completeRunFromTemplate(
    {
      sessionKey: "__contract_s1__",
      f41Stream: false,
      errorNotified: false,
      runFinalizing: false,
    },
    { source: "success", assistantText: "契约成功收尾" },
  )
  assertStopProgressNotify("S1 success complete")

  resetCapture()
  await completeRunFromTemplate(
    {
      sessionKey: "__contract_s4__",
      errorNotified: false,
      runFinalizing: false,
    },
    { source: "failure", failure: { reason: "run_error", detail: "contract" } },
  )
  assertStopProgressNotify("S4 failure complete")

  resetCapture()
  await completeRunFromTemplate(
    {
      sessionKey: "__contract_cancel__",
      errorNotified: false,
      runFinalizing: false,
    },
    { source: "cancelled" },
  )
  assertStopProgressNotify("S4 cancelled complete")
}

/** S5：Daemon dispatch 失败对称 notify（DI 工厂，无需真 HTTP） */
async function testOrchestratorDispatchNotify(): Promise<void> {
  const payloads: Array<Record<string, unknown>> = []
  const { notifySessionUser } = createOrchestratorNotify({
    httpJson: async (_url, body) => {
      payloads.push(body as Record<string, unknown>)
      return { ok: true }
    },
    localDaemonUrl: (p) => `http://127.0.0.1:19528${p}`,
    log: () => {},
  })
  await notifySessionUser("__contract_s5__", "dispatch failed", true)
  assert(payloads.length === 1, "S5: notifySessionUser 未调用")
  assert(payloads[0].stop_progress === true, "S5: payload 缺少 stop_progress")
  assert(payloads[0].session_key === "__contract_s5__", "S5: session_key 缺失")
  console.log("OK S5 orchestrator dispatch notify")
}

async function main(): Promise<void> {
  console.log("run-notify-contract: 开始")
  installHttpCapture()
  assertStaticContracts()
  testRunLifecycleResume()
  await testGuardBusyNotify()
  await testCompleteRunNotifyPaths()
  await testOrchestratorDispatchNotify()
  console.log("run-notify-contract: all checks passed")
}

main().catch((e: unknown) => {
  console.error("FAIL:", e instanceof Error ? e.message : e)
  process.exit(1)
})
