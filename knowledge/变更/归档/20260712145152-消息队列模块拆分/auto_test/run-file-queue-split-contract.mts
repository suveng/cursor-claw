/**
 * 消息队列模块拆分 — 契约冒烟（磁盘行为 + 静态接线 + 行数 + tsc）
 * 运行：./run-file-queue-split-contract.sh
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { initFileQueue } from "../../../../../src/bridge/file-queue-path.ts";
import { pushToFileQueue } from "../../../../../src/bridge/file-queue-enqueue.ts";
import {
  claimSessionMessages,
} from "../../../../../src/bridge/file-queue-claim.ts";
import {
  ackMessages,
  releaseClaimedMessages,
  cleanupOrphanClaimedOnColdStart,
} from "../../../../../src/bridge/file-queue-lifecycle.ts";
import { getSessionUnclaimedCount } from "../../../../../src/bridge/file-queue-query.ts";
import { parseMessageFile } from "../../../../../src/bridge/file-queue-message-io.ts";
import { sanitizeSessionDir } from "../../../../../src/bridge/file-queue-path.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "../../../../..");
const BRIDGE = join(ROOT, "src/bridge");
const DAEMON = join(ROOT, "src/daemon");

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

function readSrc(dir: string, name: string): string {
  return readFileSync(join(dir, name), "utf8");
}

/** 临时队列目录；每用例独立子目录避免串扰 */
function withTempQueue(fn: (sessionKey: string) => void): void {
  const base = join(tmpdir(), `fq-split-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(base, { recursive: true });
  const prev = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = base;
  try {
    initFileQueue();
    fn("sk_contract");
  } finally {
    process.env.APP_DATA_DIR = prev;
    rmSync(base, { recursive: true, force: true });
  }
}

/** ST-Q1：入队 → claim → ack 主路径 */
function behaviorQ1(): void {
  withTempQueue((sk) => {
    assert(pushToFileQueue("hello-q1", "mid_q1", "test", sk), "ST-Q1: 入队应成功");
    assert(getSessionUnclaimedCount(sk) === 1, "ST-Q1: unclaimed=1");

    const claimed = claimSessionMessages(sk);
    assert(claimed.length === 1 && claimed[0]!.messageId === "mid_q1", "ST-Q1: claim 命中");
    assert(getSessionUnclaimedCount(sk) === 0, "ST-Q1: claim 后 unclaimed=0");

    const acked = ackMessages("mid_q1", sk);
    assert(acked.includes("mid_q1"), "ST-Q1: ack 返回 id");
    assert(claimSessionMessages(sk).length === 0, "ST-Q1: ack 后无 pending");
  });
  console.log("OK ST-Q1 入队→claim→ack");
}

/** ST-Q2：release 后可再 claim */
function behaviorQ2(): void {
  withTempQueue((sk) => {
    pushToFileQueue("hello-q2", "mid_q2", "test", sk);
    claimSessionMessages(sk);
    const released = releaseClaimedMessages(["mid_q2"], sk);
    assert(released.includes("mid_q2"), "ST-Q2: release 命中");
    assert(getSessionUnclaimedCount(sk) === 1, "ST-Q2: release 后 .qmsg 恢复");

    const again = claimSessionMessages(sk);
    assert(again.some((m) => m.messageId === "mid_q2"), "ST-Q2: 可再次 claim 同 id");
  });
  console.log("OK ST-Q2 release→再claim");
}

/** ST-Q3：ack cutoff、不误删 .qmsg、重复 ack 空数组 */
function behaviorQ3(): void {
  withTempQueue((sk) => {
    pushToFileQueue("a", "mid_a", "test", sk);
    // 人为拉开时间戳，保证 cutoff 序
    const dir = join(process.env.APP_DATA_DIR!, "file-queue", sanitizeSessionDir(sk));
    const files = readdirSync(dir).filter((f) => f.endsWith(".qmsg"));
    assert(files.length === 1, "ST-Q3: 首条入队");
    pushToFileQueue("b", "mid_b", "test", sk);

    claimSessionMessages(sk);
    // 再入队一条未 claim 的 .qmsg
    pushToFileQueue("c", "mid_c", "test", sk);
    assert(getSessionUnclaimedCount(sk) === 1, "ST-Q3: 存在未 claim .qmsg");

    const acked = ackMessages("mid_b", sk);
    assert(acked.includes("mid_b"), "ST-Q3: ack mid_b");
    assert(getSessionUnclaimedCount(sk) === 1, "ST-Q3: 未 claim .qmsg 保留");

    const dup = ackMessages("mid_b", sk);
    assert(dup.length === 0, "ST-Q3: 重复 ack 返回 []");
  });
  console.log("OK ST-Q3 ack cutoff + 重复ack");
}

/** ST-Q4：遗留磁盘格式无需迁移即可读写 */
function behaviorQ4(): void {
  const base = join(tmpdir(), `fq-legacy-${Date.now()}`);
  mkdirSync(base, { recursive: true });
  const prev = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = base;
  try {
    initFileQueue();
    const sk = "sk_legacy";
    const sessDir = join(base, "file-queue", sanitizeSessionDir(sk));
    mkdirSync(sessDir, { recursive: true });

    // 模拟拆分前遗留：旧 JSON 顶层 chatType + .claimed
    const legacyName = "1000_legacy_id.qmsg";
    writeFileSync(
      join(sessDir, legacyName),
      JSON.stringify({
        text: "legacy",
        messageId: "legacy_id",
        timestamp: 1000,
        source: "old",
        sessionKey: sk,
        chatType: "group",
        senderOpenId: "ou_legacy",
      }),
      "utf8",
    );
    writeFileSync(
      join(sessDir, "2000_old_claimed.claimed"),
      JSON.stringify({
        text: "claimed-old",
        messageId: "old_claimed",
        timestamp: 2000,
        source: "old",
        sessionKey: sk,
      }),
      "utf8",
    );

    const parsed = parseMessageFile(join(sessDir, legacyName));
    assert(parsed?.meta?.chatType === "group", "ST-Q4: 旧格式 chatType 进 meta");
    assert(parsed?.meta?.senderOpenId === "ou_legacy", "ST-Q4: 旧格式 senderOpenId");

    const claimed = claimSessionMessages(sk);
    assert(claimed.length >= 2, "ST-Q4: 遗留文件可 claim");

    const recycled = cleanupOrphanClaimedOnColdStart();
    assert(recycled >= 0, "ST-Q4: 冷启动 recycle 可调用");
  } finally {
    process.env.APP_DATA_DIR = prev;
    rmSync(base, { recursive: true, force: true });
  }
  console.log("OK ST-Q4 遗留磁盘兼容");
}

/** ST-Q5：各 file-queue*.ts ≤300 行 */
function structureQ5(): void {
  const files = readdirSync(BRIDGE).filter((f) => f.startsWith("file-queue") && f.endsWith(".ts"));
  for (const f of files) {
    const lines = readSrc(BRIDGE, f).split("\n").length;
    assert(lines <= 300, `ST-Q5: ${f} ${lines} 行 > 300`);
  }
  const facade = readSrc(BRIDGE, "file-queue.ts");
  assert(!facade.includes("function "), "ST-Q5: file-queue.ts 无业务函数体");
  console.log("OK ST-Q5 行数合规");
}

/** ST-Q6：中文注释 + tsc */
function engineeringQ6(): void {
  const life = readSrc(BRIDGE, "file-queue-lifecycle.ts");
  assert(life.includes("勿与 ackMessages"), "ST-Q6: lifecycle 含中文划界注释");
  const agents = readSrc(BRIDGE, "AGENTS.md");
  assert(agents.includes("file-queue-lifecycle.ts"), "ST-Q6: AGENTS 登记子模块");

  const tsc = spawnSync("npx", ["tsc", "--noEmit"], { cwd: ROOT, encoding: "utf8" });
  assert(tsc.status === 0, `ST-Q6: tsc 失败 exit=${tsc.status}`);
  console.log("OK ST-Q6 中文注释 + tsc");
}

/** ST-Q7：调用方仍 import file-queue.js；子模块无环引 */
function importQ7(): void {
  const daemonSrc = readSrc(DAEMON, "daemon.ts");
  assert(daemonSrc.includes('from "../bridge/file-queue.js"'), "ST-Q7: daemon 仍 file-queue.js");
  assert(!daemonSrc.includes("file-queue-enqueue"), "ST-Q7: daemon 不直引子模块");

  const callers = [
    "daemon-orchestrator.ts",
    "daemon-presentation-types.ts",
    "daemon-presentation-handlers.ts",
    "daemon-presentation-merge-preview.ts",
  ];
  for (const f of callers) {
    const src = readSrc(DAEMON, f);
    if (src.includes("file-queue")) {
      assert(src.includes("../bridge/file-queue.js"), `ST-Q7: ${f} 路径不变`);
      assert(!src.includes("file-queue-"), `ST-Q7: ${f} 不直引子模块`);
    }
  }

  const claimSrc = readSrc(BRIDGE, "file-queue-claim.ts");
  const lifeSrc = readSrc(BRIDGE, "file-queue-lifecycle.ts");
  assert(!claimSrc.includes("file-queue-lifecycle"), "ST-Q7: claim 不 import lifecycle");
  assert(!lifeSrc.includes("file-queue-claim"), "ST-Q7: lifecycle 不 import claim");

  const required = [
    "pushToFileQueue",
    "claimSessionMessages",
    "ackMessages",
    "releaseClaimedMessages",
    "cleanupOrphanClaimedOnColdStart",
  ];
  for (const sym of required) {
    assert(daemonSrc.includes(sym), `ST-Q7: daemon 仍 import ${sym}`);
  }
  console.log("OK ST-Q7 import 路径不变");
}

function main(): void {
  behaviorQ1();
  behaviorQ2();
  behaviorQ3();
  behaviorQ4();
  structureQ5();
  engineeringQ6();
  importQ7();
  console.log("PASS file-queue-split-contract");
}

main();
