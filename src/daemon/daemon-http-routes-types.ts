/**
 * `/api/*` 路由 deps 类型（供 routes 子模块共享，避免循环 import）。
 */
import type * as http from "node:http";
import type { AgentPhase } from "./daemon-orchestrator.js";
import type { PresentationEvent } from "./daemon-presentation-types.js";
import type { AdminRouteHandler } from "./daemon-http-admin-io.js";

/** launch/dispatch 失败重试入参（HttpRoutesDeps / OrchestratorApi / dispatchRetry 对齐） */
export type DispatchLaunchFailureOpts = {
  sessionKey: string;
  messageIds: string[];
  error?: string;
  busyDelayMs: number;
};
export type DispatchLaunchFailureResult = "retried" | "exhausted";

export interface HttpRoutesDeps {
  log: (level: string, ...args: unknown[]) => void;
  pkgVersion: string;
  daemonPort: number;
  lastMcpRequestTime: number;
  activeMcpConnections: number;
  readBody: (req: http.IncomingMessage) => Promise<string>;
  json: (res: http.ServerResponse, data: unknown, status?: number) => void;
  readTasks: () => Array<{ enabled: boolean }>;
  getChannelStatusList: () => Array<{ type: string; connected?: boolean; status?: string; mainUserBound?: boolean }>;
  getFileQueueLength: () => number;
  getSessionAgentPhase: (sessionKey: string) => AgentPhase | undefined;
  setSessionAgentPhase: (sessionKey: string, phase: AgentPhase | "idle") => void;
  mergeBatchBySession: ReadonlyMap<string, { sessionKey: string; phase: string }>;
  isTerminalMergePhase: (phase: string) => boolean;
  renderMergeBatchCardForSession: (batch: { sessionKey: string; phase: string }) => Promise<void>;
  flushReadyMergeBatches: (sessionKey: string) => Promise<void>;
  scheduleAgentDispatch: (sessionKey?: string) => void;
  handleMergeBatchAction: (sessionKey: string, action: string, text?: string) => Promise<{ ok: boolean; error?: string }>;
  performClaimAndMerge: (sessionKey: string) => { ok: true; text: string; message_ids: string[] } | { ok: false; error: string };
  resolveChannel: (sessionKey?: string) => { type: string; message?: string; rt?: unknown; chatId?: string };
  extractWorkspaceTitle: (sessionKey?: string) => string | undefined;
  trackMessageSession: (messageId: string, sessionKey: string) => void;
  sessionLastReplyAt: Map<string, number>;
  ackOnReply: (messageId?: string, sessionKey?: string) => void;
  stopSessionProgress: (sessionKey: string) => void;
  handlePresentationEvent: (body: PresentationEvent) => Promise<{ ok: boolean; outbound_message_id?: string; error?: string }>;
  handleStreamText: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  forwardElectronAgentApi: (subpath: string, body: object) => Promise<{ ok: boolean; error?: string }>;
  parseBusyRetryDelayMs: (error?: string) => number;
  scheduleBusyRetry: (sessionKey: string, delayMs: number) => void;
  /** 与 IM launch 共用同一 dispatchRetry 实例；失败/busy 时 release 并延后重调度 */
  handleLaunchFailure: (opts: DispatchLaunchFailureOpts) => Promise<DispatchLaunchFailureResult>;
  /** HTTP dispatch 成功时清零 session 重试计数 */
  clearDispatchRetryAttempt: (sessionKey: string) => void;
  notifySessionUser: (sessionKey: string, text: string, stopProgress?: boolean) => Promise<void>;
  formatOrchestratorFailure: (error?: string) => string;
  ackMessages: (messageId: string, sessionKey?: string) => string[];
  getEarliestMessageTime: (sessionKey: string) => number | null;
  setActiveSession: (chatId: string, sessionKey: string) => void;
  clearActiveSession: (chatId: string) => void;
  activeSessionMap: Map<string, string>;
  fallbackSessionMap: Map<string, string>;
  sseClients: Set<http.ServerResponse>;
  channels: Map<string, { client?: unknown; cfg: { type: string } }>;
  parseChatKey: (raw: string) => { channelId?: string; chatId: string };
  adminCrudRoutes: Record<string, AdminRouteHandler>;
  adminEntityRoutes: Record<string, AdminRouteHandler>;
}
