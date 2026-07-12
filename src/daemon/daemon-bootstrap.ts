/**
 * Daemon 启动后半段：通道 start、HTTP listen、定时任务（经 deps 注入）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { cleanupMediaCache } from "../bridge/lark-core.js";
import {
  getQueueDir,
  getQueueLength as getFileQueueLength,
  getQueueMessages as getFileQueueMessages,
  deleteQueueMessage as deleteFileQueueMessage,
  claimNextMessage,
  getDistinctSessions,
} from "../bridge/file-queue.js";
import { LOCK_FILE_NAME } from "../shared/constants.js";
import { makeChatKey, type DaemonChannelConfig } from "../shared/channel-types.js";
import {
  startDaemonScheduledTasks,
  stopDaemonScheduledTasks,
  setDaemonSchedulerLogger,
} from "./daemon-scheduled-tasks.js";
import { startHttpServer as startDaemonHttpServer, type HttpServerDeps } from "./daemon-http-server.js";
import type { ChannelRuntime } from "./daemon-channel.js";
import type * as http from "node:http";
import { recoverStaleInstances } from "../workflow/workflow-engine.js";

export function clearFileQueue(log: (level: string, ...args: unknown[]) => void): number {
  const queueDir = getQueueDir();
  if (!queueDir) return 0;
  let count = 0;
  const exts = [".qmsg", ".claimed", ".done", ".tmp"];
  const clearDir = (dir: string) => {
    try {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) clearDir(full);
        else if (exts.some((ext) => f.endsWith(ext))) {
          try { fs.unlinkSync(full); count++; } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  };
  clearDir(queueDir);
  log("INFO", `队列已清空: ${count} 条消息`);
  return count;
}

export function createLockHelpers(opts: {
  appDataDir: string;
  pkgVersion: string;
  workspaceDir: string;
}) {
  const getLockFilePath = () => path.join(opts.appDataDir, LOCK_FILE_NAME);
  return {
    writeLockFile(port: number): void {
      try {
        fs.writeFileSync(getLockFilePath(), JSON.stringify({
          pid: process.pid, port, version: opts.pkgVersion,
          startedAt: new Date().toISOString(), workspaceDir: opts.workspaceDir,
        }));
      } catch { /* ignore */ }
    },
    removeLockFile(): void {
      try { fs.unlinkSync(getLockFilePath()); } catch { /* ignore */ }
    },
  };
}

export function startMediaCacheCleanup(log: (level: string, ...args: unknown[]) => void): void {
  const sweep = () => {
    const n = cleanupMediaCache(24 * 60 * 60 * 1000);
    if (n > 0) log("INFO", `媒体缓存已清理 ${n} 个过期文件`);
  };
  sweep();
  setInterval(sweep, 6 * 60 * 60 * 1000).unref();
}

export interface PostWireStartDeps {
  log: (level: string, ...args: unknown[]) => void;
  pkgVersion: string;
  configuredPort: number;
  channelConfigs: DaemonChannelConfig[];
  channels: Map<string, ChannelRuntime>;
  startFeishuChannel: (rt: ChannelRuntime) => Promise<void>;
  initWeChatChannel: (rt: ChannelRuntime) => NonNullable<ChannelRuntime["wechat"]>;
  pickChannel: (channelId?: string) => ChannelRuntime | null;
  channelDefaultChatId: (rt: ChannelRuntime) => string | null;
  isChannelConnected: (rt: ChannelRuntime) => boolean;
  getChannelStatusList: () => unknown[];
  pushMessage: (
    content: string, messageId?: string, chatId?: string, chatType?: string,
  ) => Promise<void>;
  trackMessageSession: (messageId: string, sessionKey: string) => void;
  sessionToChatMap: Map<string, string>;
  replyToMessage: (messageId: string, text: string, chatId?: string) => Promise<void>;
  readBody: (req: http.IncomingMessage) => Promise<string>;
  json: (res: http.ServerResponse, data: unknown, status?: number) => void;
  handleAdminApi: HttpServerDeps["handleAdminApi"];
  activeMcpConnections: number;
  lastMcpRequestTime: number;
  cleanExpiredCommands: () => void;
  getPendingCommands: HttpServerDeps["getPendingCommands"];
  claimCommand: HttpServerDeps["claimCommand"];
  clearFileQueue: () => number;
  removeLockFile: () => void;
  writeLockFile: (port: number) => void;
  setDaemonPort: (port: number) => void;
}

/** 通道启动 + HTTP + 定时任务；返回监听端口 */
export async function startChannelsHttpAndScheduler(deps: PostWireStartDeps): Promise<number> {
  // 冷启动：尊重 WORKFLOW_AUTO_PAUSE_STALE（Electron 注入；缺省 true）
  const recovered = recoverStaleInstances();
  if (recovered.length > 0) {
    deps.log("INFO", `workflow recover: ${recovered.length} 个 running→paused`);
  }

  for (const cfg of deps.channelConfigs) {
    const rt: ChannelRuntime = { cfg, lastP2pChatId: null, bindArmed: false };
    deps.channels.set(cfg.id, rt);
    if (cfg.type === "feishu") {
      deps.startFeishuChannel(rt).catch((e: unknown) => {
        deps.log("ERROR", `[${cfg.name}] 飞书通道启动失败: ${e instanceof Error ? e.message : e}`);
      });
    } else {
      rt.wechat = deps.initWeChatChannel(rt);
      rt.wechat.start(cfg.wechatToken, cfg.wechatAccountId).catch((e: unknown) => {
        deps.log("WARN", `[WeChat:${cfg.name}] 启动失败: ${e instanceof Error ? e.message : e}`);
      });
    }
  }

  const daemonPort = await startDaemonHttpServer({
    log: deps.log,
    pkgVersion: deps.pkgVersion,
    configuredPort: deps.configuredPort,
    readBody: deps.readBody,
    json: deps.json,
    handleAdminApi: deps.handleAdminApi,
    activeMcpConnections: deps.activeMcpConnections,
    lastMcpRequestTime: deps.lastMcpRequestTime,
    getChannelStatusList: deps.getChannelStatusList as HttpServerDeps["getChannelStatusList"],
    getFileQueueLength,
    getFileQueueMessages,
    deleteFileQueueMessage: deleteFileQueueMessage,
    stopDaemonScheduledTasks,
    removeLockFile: deps.removeLockFile,
    cleanExpiredCommands: deps.cleanExpiredCommands,
    channels: deps.channels,
    channelDefaultChatId: deps.channelDefaultChatId as HttpServerDeps["channelDefaultChatId"],
    isChannelConnected: deps.isChannelConnected as (rt: unknown) => boolean,
    pushMessage: deps.pushMessage,
    clearFileQueue: deps.clearFileQueue,
    claimNextMessage,
    trackMessageSession: deps.trackMessageSession,
    getDistinctSessions,
    getPendingCommands: deps.getPendingCommands,
    claimCommand: deps.claimCommand,
    replyToMessage: deps.replyToMessage,
  });
  deps.setDaemonPort(daemonPort);
  process.env.LARK_DAEMON_PORT = String(daemonPort);
  deps.writeLockFile(daemonPort);
  deps.log("INFO", "MCP 服务已就绪 (/mcp Agent 工具；MCP 管理走 POST /api/mcp 或 IM /mcp)");

  setDaemonSchedulerLogger((msg) => { deps.log("INFO", msg); });
  startDaemonScheduledTasks(
    (task, content) => {
      const rt = deps.pickChannel(task.channelId);
      const target = rt ? deps.channelDefaultChatId(rt) : null;
      if (rt && target) {
        deps.pushMessage(content, `internal_${task.id}_${Date.now()}`, makeChatKey(rt.cfg.id, target), "p2p")
          .catch((e: unknown) =>
            deps.log("WARN", `定时任务「${task.name}」入队失败: ${e instanceof Error ? e.message : e}`));
      } else {
        deps.log("WARN", `定时任务「${task.name}」消息无法入队: 通道无主用户且无私聊记录`);
      }
    },
    (task, content) => {
      const rt = deps.pickChannel(task.channelId);
      const target = rt ? deps.channelDefaultChatId(rt) : null;
      const notifyChatKey = rt && target ? makeChatKey(rt.cfg.id, target) : undefined;
      if (notifyChatKey) deps.sessionToChatMap.set(task.id, notifyChatKey);
      process.stdout.write(`__IND_LAUNCH__:${JSON.stringify({
        taskId: task.id, taskName: task.name, content,
        channelId: rt?.cfg.id, model: task.model, modelParams: task.modelParams,
      })}\n`);
    },
  );
  return daemonPort;
}
