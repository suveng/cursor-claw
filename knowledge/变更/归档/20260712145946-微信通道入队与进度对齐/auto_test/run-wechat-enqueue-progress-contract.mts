/**
 * 微信通道入队与进度对齐 — 契约冒烟（gate 表驱动 + 源码静态 + tsc）
 * 运行：./run-wechat-enqueue-progress-contract.sh
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  buildWechatBotAliases,
  shouldEnqueueWechatGroupMessage,
} from "../../../../../src/daemon/wechat-group-enqueue-gate.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "../../../../..");
const SRC_DAEMON = join(ROOT, "src/daemon");
const SRC_BRIDGE = join(ROOT, "src/bridge");
const SRC_SHARED = join(ROOT, "src/shared");

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

function readSrc(dir: string, name: string): string {
  return readFileSync(join(dir, name), "utf8");
}

/** ST-W1：gate 纯函数表驱动（@ 过滤） */
function gateTableTests(): void {
  const aliases = buildWechatBotAliases("ClawBot", "小爪");
  assert(aliases.length === 2, "ST-W1: buildWechatBotAliases 去重");

  assert(
    !shouldEnqueueWechatGroupMessage({ text: "大家好", mode: "mention_required", botAliases: aliases }),
    "ST-W1: 无 @ 不入队",
  );
  assert(
    shouldEnqueueWechatGroupMessage({ text: "@ClawBot 你好", mode: "mention_required", botAliases: aliases }),
    "ST-W1: @ 机器人入队",
  );
  assert(
    shouldEnqueueWechatGroupMessage({ text: "@小爪 帮忙", mode: "mention_required", botAliases: aliases }),
    "ST-W1: 显示名 @ 命中",
  );
  assert(
    shouldEnqueueWechatGroupMessage({ text: "闲聊", mode: "all", botAliases: aliases }),
    "ST-W1: all 模式恒 true",
  );
  assert(
    shouldEnqueueWechatGroupMessage({ text: "@所有人 通知", mode: "mention_required", botAliases: aliases }),
    "ST-W1: @所有人 视为命中",
  );

  console.log("OK ST-W1 gate 表驱动");
}

/** ST-W2：配置字段与 Daemon 缺省 */
function configStaticChecks(): void {
  const channelTypes = readSrc(SRC_SHARED, "channel-types.ts");
  const daemonMgr = readFileSync(join(ROOT, "electron/daemon/daemon-manager.ts"), "utf8");
  const channelPanel = readFileSync(join(ROOT, "src/renderer/components/ChannelPanel.tsx"), "utf8");

  assert(channelTypes.includes('wechatGroupEnqueueMode?: "mention_required" | "all"'), "ST-W2: 类型含 wechatGroupEnqueueMode");
  assert(channelTypes.includes("wechatBotDisplayName"), "ST-W2: 类型含 wechatBotDisplayName");
  assert(channelPanel.includes('wechatGroupEnqueueMode: "mention_required"'), "ST-W2: UI 默认 mention_required");
  assert(daemonMgr.includes("mention_required"), "ST-W2: daemon-manager 缺省 mention_required");

  console.log("OK ST-W2 配置静态");
}

/** ST-W3：typing 续期静态 */
function typingStaticChecks(): void {
  const mgr = readSrc(SRC_BRIDGE, "wechat-manager.ts");
  const daemonAgents = readSrc(SRC_DAEMON, "AGENTS.md");

  assert(mgr.includes("TYPING_REFRESH_MS"), "ST-W3: 含 TYPING_REFRESH_MS");
  assert(mgr.includes("wechat_typing_refresh"), "ST-W3: 含 wechat_typing_refresh 日志");
  assert(mgr.includes("typingRefreshTimers"), "ST-W3: 续期 timer Map");
  assert(mgr.includes("clearTypingRefreshTimer"), "ST-W3: stop 清 timer");
  assert(daemonAgents.includes("startProgressTyping"), "ST-W3: AGENTS 登记 typing 续期");

  console.log("OK ST-W3 typing 静态");
}

/** ST-W4：出站 track（wxc_ 前缀 + send-text 接线） */
function trackStaticChecks(): void {
  const mgr = readSrc(SRC_BRIDGE, "wechat-manager.ts");
  const sendRoute = readSrc(SRC_DAEMON, "daemon-http-routes-send.ts");
  const daemon = readSrc(SRC_DAEMON, "daemon.ts");

  assert(mgr.includes("WeChatSendResult"), "ST-W4: WeChatSendResult 类型");
  assert(mgr.includes("wxc_"), "ST-W4: outboundId wxc_ 前缀");
  const wechatBlock = sendRoute.slice(sendRoute.indexOf('ch.type === "wechat"'));
  assert(wechatBlock.includes("trackMessageSession"), "ST-W4: send-text 微信 track");
  assert(wechatBlock.includes("message_id: sentMsgId"), "ST-W4: 响应含 message_id");
  assert(daemon.includes("trackMessageSession"), "ST-W4: daemon 导出 track");

  console.log("OK ST-W4 track 静态");
}

/** ST-F1：飞书主路径无微信 gate 污染 */
function feishuRegressionChecks(): void {
  const daemon = readSrc(SRC_DAEMON, "daemon.ts");
  const feishuStart = daemon.indexOf("async function startFeishuChannel");
  assert(feishuStart >= 0, "ST-F1: 找到 startFeishuChannel");
  const feishuBlock = daemon.slice(feishuStart, feishuStart + 3500);
  assert(feishuBlock.includes("isBotMentioned"), "ST-F1: 飞书仍用 isBotMentioned");
  assert(!feishuBlock.includes("shouldEnqueueWechatGroupMessage"), "ST-F1: 飞书块无微信 gate");
  assert(!feishuBlock.includes("wechat_group_skip"), "ST-F1: 飞书块无 wechat_group_skip");

  console.log("OK ST-F1 飞书静态无回归");
}

/** 入站接线 + 工程规范 */
function wiringAndEngineeringChecks(): void {
  const daemon = readSrc(SRC_DAEMON, "daemon.ts");
  const gate = readSrc(SRC_DAEMON, "wechat-group-enqueue-gate.ts");
  const initStart = daemon.indexOf("function initWeChatChannel");
  assert(initStart >= 0, "未找到 initWeChatChannel");
  const block = daemon.slice(initStart, initStart + 2200);
  assert(block.includes("shouldEnqueueWechatGroupMessage"), "入站应调 gate");
  assert(block.includes("wechat_group_skip"), "跳过应打 wechat_group_skip");

  const gateLines = gate.split("\n").length;
  assert(gateLines <= 120, `gate 文件 ${gateLines} 行 > 120`);

  const tsc = spawnSync("npx", ["tsc", "--noEmit"], { cwd: ROOT, encoding: "utf8" });
  assert(tsc.status === 0, `tsc 失败 exit=${tsc.status}`);
  console.log("OK 入站接线 + gate 行数 + tsc");
}

function main(): void {
  gateTableTests();
  configStaticChecks();
  typingStaticChecks();
  trackStaticChecks();
  feishuRegressionChecks();
  wiringAndEngineeringChecks();
  console.log("PASS wechat-enqueue-progress-contract");
}

main();
