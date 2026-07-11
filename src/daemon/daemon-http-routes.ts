// @ts-nocheck — 批1 自 daemon.ts 机械搬移；批2 再收紧类型
// @ts-nocheck — 批1 自 daemon.ts 机械搬移；批2 再收紧类型
/**
 * `/api/*` 路由表（从 daemon.ts 抽出）。
 */
import * as http from "node:http";
import type { AgentPhase } from "./daemon-orchestrator.js";
import type { PresentationEvent } from "./daemon-presentation-types.js";
import type { AdminRouteHandler } from "./daemon-http-admin-crud.js";

export interface HttpRoutesDeps {
  log: (level: string, ...args: unknown[]) => void;
  pkgVersion: string;
  daemonPort: number;
  lastMcpRequestTime: number;
  activeMcpConnections: number;
  readBody: (req: http.IncomingMessage) => Promise<string>;
  json: (res: http.ServerResponse, data: unknown, status?: number) => void;
  readTasks: () => Array<{ enabled: boolean }>;
  getChannelStatusList: () => unknown[];
  getFileQueueLength: () => number;
  getSessionAgentPhase: (sessionKey: string) => AgentPhase | undefined;
  setSessionAgentPhase: (sessionKey: string, phase: AgentPhase | "idle") => void;
  mergeBatchBySession: ReadonlyMap<string, { phase: string }>;
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
  handlePresentationEvent: (body: PresentationEvent) => Promise<unknown>;
  handleStreamText: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  forwardElectronAgentApi: (subpath: string, body: object) => Promise<{ ok: boolean; error?: string }>;
  parseBusyRetryDelayMs: (error?: string) => number;
  scheduleBusyRetry: (sessionKey: string, delayMs: number) => void;
  getEarliestMessageTime: (sessionKey: string) => number | null;
  setActiveSession: (chatId: string, sessionKey: string) => void;
  activeSessionMap: Map<string, string>;
  /** 临时 sessionKey → 回退目标 sessionKey（与 activeSessionMap 并列 SSOT） */
  fallbackSessionMap: Map<string, string>;
  sseClients: Set<http.ServerResponse>;
  channels: Map<string, { client?: unknown; cfg: { type: string } }>;
  parseChatKey: (raw: string) => { channelId?: string; chatId: string };
  adminCrudRoutes: Record<string, AdminRouteHandler>;
  adminEntityRoutes: Record<string, AdminRouteHandler>;
}

export function createAdminApiHandler(deps: HttpRoutesDeps) {
  async function handleAdminApi(pathname: string, method: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    if (!pathname.startsWith("/api/")) return false;

    if (method === "GET" && pathname === "/api/status") {
      const tasks = deps.readTasks();
      const recentlyActive = deps.lastMcpRequestTime > 0 && (Date.now() - deps.lastMcpRequestTime) < 120_000;
      const channelList = deps.getChannelStatusList();
      deps.json(res, {
        daemon: {
          running: true, version: deps.pkgVersion, uptime: Math.floor(process.uptime()), port: deps.daemonPort,
          agentRunning: deps.activeMcpConnections > 0 || recentlyActive,
          sessionAgentCount: deps.activeMcpConnections,
        },
        queue: { length: deps.getFileQueueLength() },
        tasks: { total: tasks.length, enabled: tasks.filter((t) => t.enabled).length },
        channels: channelList,
        feishu: { connected: channelList.some((c) => c.type === "feishu" && c.connected), hasChatId: channelList.some((c) => c.type === "feishu" && c.mainUserBound) },
        wechat: { enabled: channelList.some((c) => c.type === "wechat"), status: channelList.some((c) => c.type === "wechat" && c.status === "connected") ? "connected" : "disconnected" },
      });
      return true;
    }

    const crudHandler = deps.adminCrudRoutes[pathname];
    if (crudHandler) return crudHandler(method, req, res);

    // ── 消息发送 API ──
    if (method === "POST" && pathname === "/api/session-agent-phase") {
      try {
        const body = JSON.parse(await deps.readBody(req));
        const { session_key, phase } = body as { session_key?: string; phase?: AgentPhase };
        if (!session_key?.trim()) {
          deps.json(res, { ok: false, error: "session_key is required" }, 400);
          return true;
        }
        if (phase !== "starting" && phase !== "processing" && phase !== "idle") {
          deps.json(res, { ok: false, error: "invalid phase" }, 400);
          return true;
        }
        if (phase === "idle") {
          deps.setSessionAgentPhase(session_key, "idle");
          const batch = deps.mergeBatchBySession.get(session_key);
          if (batch && !deps.isTerminalMergePhase(batch.phase)) {
            deps.renderMergeBatchCardForSession(batch).catch((e: unknown) => {
              deps.log("WARN", `idle 后合并卡刷新失败: ${e instanceof Error ? e.message : e}`);
            });
          }
          void deps.flushReadyMergeBatches(session_key);
          // processing 期间入队的消息当时无法 claim；idle 后须重调度（含单条 unclaimed，非仅 merge ready）
          deps.scheduleAgentDispatch(session_key);
        } else {
          deps.setSessionAgentPhase(session_key, phase);
          const batch = deps.mergeBatchBySession.get(session_key);
          if (batch?.phase === "ready" && !deps.isTerminalMergePhase(batch.phase)) {
            deps.renderMergeBatchCardForSession(batch).catch((e: unknown) => {
              deps.log("WARN", `phase 变更后合并卡刷新失败: ${e instanceof Error ? e.message : e}`);
            });
          }
        }
        deps.json(res, { ok: true });
      } catch (e: unknown) {
        deps.json(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/merge-batch/action") {
      try {
        const body = JSON.parse(await deps.readBody(req)) as { session_key?: string; action?: string; text?: string };
        const sessionKey = body.session_key?.trim();
        const action = body.action?.trim();
        if (!sessionKey) {
          deps.json(res, { ok: false, error: "session_key is required" }, 400);
          return true;
        }
        if (!action) {
          deps.json(res, { ok: false, error: "action is required" }, 400);
          return true;
        }
        const result = await deps.handleMergeBatchAction(sessionKey, action, body.text);
        deps.json(res, result, result.ok ? 200 : 400);
      } catch (e: unknown) {
        deps.json(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/orchestrator/claim-and-merge") {
      try {
        const body = JSON.parse(await deps.readBody(req)) as { session_key?: string };
        const sessionKey = body.session_key?.trim();
        if (!sessionKey) {
          deps.json(res, { ok: false, error: "session_key is required" }, 400);
          return true;
        }
        const result = deps.performClaimAndMerge(sessionKey);
        if (!result.ok) {
          deps.json(res, { ok: false, error: result.error }, 400);
          return true;
        }
        deps.json(res, { text: result.text, message_ids: result.message_ids });
      } catch (e: unknown) {
        deps.json(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/send-text") {
      const body = JSON.parse(await deps.readBody(req));
      const { text, message_id, session_key, stop_progress } = body as {
        text: string; message_id?: string; session_key?: string; stop_progress?: boolean;
      };
      if (!text) { deps.json(res, { ok: false, error: "text is required" }, 400); return true; }

      const ch = deps.resolveChannel(session_key);
      if (ch.type === "error") { deps.json(res, { ok: false, error: ch.message }, 400); return true; }
      let sendOk = false;
      if (ch.type === "wechat") {
        sendOk = await ch.rt.wechat!.sendText(ch.chatId, text);
        deps.json(res, { ok: sendOk });
      } else {
        const sender = ch.rt.sender!;
        const title = deps.extractWorkspaceTitle(session_key);
        let sentMsgId: string | undefined;
        if (message_id) {
          sentMsgId = await sender.sendMessage(text, message_id, undefined, title);
          if (!sentMsgId) {
            deps.log("INFO", `回复退避: message_id=${message_id} → ${ch.chatId ? `chat_id=${ch.chatId}` : "默认发送"}`);
            sentMsgId = await sender.sendMessage(text, undefined, ch.chatId, title);
          }
        } else {
          sentMsgId = await sender.sendMessage(text, undefined, ch.chatId, title);
        }
        if (sentMsgId && session_key) deps.trackMessageSession(sentMsgId, session_key);
        sendOk = !!sentMsgId;
        deps.json(res, { ok: sendOk, message_id: sentMsgId });
      }
      if (sendOk) {
        if (session_key) deps.sessionLastReplyAt.set(session_key, Date.now());
        deps.ackOnReply(message_id, session_key);
        if (stop_progress && session_key) deps.stopSessionProgress(session_key);
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/presentation-event") {
      try {
        const body = JSON.parse(await deps.readBody(req)) as PresentationEvent;
        const result = await deps.handlePresentationEvent(body);
        if (!result.ok && result.error === "session_key is required") {
          deps.json(res, result, 400);
        } else {
          deps.json(res, result);
        }
      } catch (e: unknown) {
        deps.json(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/stream-text") {
      const body = JSON.parse(await deps.readBody(req));
      const result = await deps.handleStreamText(body as {
        session_key?: string;
        text?: string;
        stream_id?: string;
        outbound_message_id?: string;
        message_id?: string;
        final?: boolean;
      });
      if (!result.ok && result.error === "session_key and text are required") {
        deps.json(res, result, 400);
      } else {
        deps.json(res, result);
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/send-image") {
      const body = JSON.parse(await deps.readBody(req));
      const { image_path, message_id, session_key } = body as { image_path: string; message_id?: string; session_key?: string };
      if (!image_path) { deps.json(res, { ok: false, error: "image_path is required" }, 400); return true; }
      const ch = deps.resolveChannel(session_key);
      if (ch.type === "error") { deps.json(res, { ok: false, error: ch.message }, 400); return true; }
      if (ch.type === "wechat") {
        await ch.rt.wechat!.sendMedia(ch.chatId, image_path);
      } else {
        await ch.rt.sender!.sendImage(image_path, message_id, ch.chatId);
      }
      deps.json(res, { ok: true });
      if (session_key) {
        deps.sessionLastReplyAt.set(session_key, Date.now());
        deps.ackOnReply(message_id, session_key);
        deps.stopSessionProgress(session_key);
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/send-file") {
      const body = JSON.parse(await deps.readBody(req));
      const { file_path, message_id, session_key } = body as { file_path: string; message_id?: string; session_key?: string };
      if (!file_path) { deps.json(res, { ok: false, error: "file_path is required" }, 400); return true; }
      const ch = deps.resolveChannel(session_key);
      if (ch.type === "error") { deps.json(res, { ok: false, error: ch.message }, 400); return true; }
      if (ch.type === "wechat") {
        await ch.rt.wechat!.sendMedia(ch.chatId, file_path);
      } else {
        await ch.rt.sender!.sendFile(file_path, message_id, ch.chatId);
      }
      deps.json(res, { ok: true });
      if (session_key) {
        deps.sessionLastReplyAt.set(session_key, Date.now());
        deps.ackOnReply(message_id, session_key);
        deps.stopSessionProgress(session_key);
      }
      return true;
    }

    if (method === "GET" && pathname === "/api/session-last-reply") {
      const sk = new URL(req.url ?? "", "http://localhost").searchParams.get("sessionKey") || "";
      deps.json(res, { lastReplyAt: sk ? (deps.sessionLastReplyAt.get(sk) ?? null) : null });
      return true;
    }

    if (method === "GET" && pathname === "/api/session-earliest-msg") {
      const sk = new URL(req.url ?? "", "http://localhost").searchParams.get("sessionKey") || "";
      deps.json(res, { earliestMsgTime: sk ? deps.getEarliestMessageTime(sk) : null });
      return true;
    }

    if (method === "POST" && pathname === "/api/active-session") {
      const body = await deps.readBody(req);
      const { chatId, sessionKey } = JSON.parse(body);
      if (chatId && sessionKey) {
        deps.setActiveSession(chatId, sessionKey);
        deps.json(res, { ok: true });
      } else {
        deps.json(res, { ok: false, error: "chatId and sessionKey required" }, 400);
      }
      return true;
    }

    if (method === "GET" && pathname === "/api/active-sessions") {
      const entries: Record<string, string> = {};
      for (const [k, v] of deps.activeSessionMap) entries[k] = v;
      deps.json(res, { sessions: entries });
      return true;
    }

    if (method === "DELETE" && pathname === "/api/active-session") {
      const qs = new URL(req.url ?? "", "http://localhost").searchParams;
      const chatId = qs.get("chatId");
      if (chatId) deps.activeSessionMap.delete(chatId);
      deps.json(res, { ok: true });
      return true;
    }

    // ── 会话回退栈（临时 sessionKey → 创建前的活跃 sessionKey）──
    if (method === "POST" && pathname === "/api/session-fallback") {
      try {
        const body = JSON.parse(await deps.readBody(req)) as {
          sessionKey?: string;
          fallbackSessionKey?: string;
        };
        const sessionKey = body.sessionKey?.trim();
        const fallbackSessionKey = body.fallbackSessionKey?.trim();
        if (!sessionKey || !fallbackSessionKey) {
          deps.json(res, { ok: false, error: "sessionKey and fallbackSessionKey required" }, 400);
          return true;
        }
        deps.fallbackSessionMap.set(sessionKey, fallbackSessionKey);
        deps.json(res, { ok: true });
      } catch (e: unknown) {
        deps.json(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
      }
      return true;
    }

    if (method === "GET" && pathname === "/api/session-fallback") {
      const sessionKey = new URL(req.url ?? "", "http://localhost").searchParams.get("sessionKey")?.trim() ?? "";
      if (!sessionKey) {
        deps.json(res, { ok: false, error: "sessionKey is required" }, 400);
        return true;
      }
      const fallback = deps.fallbackSessionMap.get(sessionKey) ?? null;
      deps.json(res, { fallbackSessionKey: fallback });
      return true;
    }

    if (method === "DELETE" && pathname === "/api/session-fallback") {
      const sessionKey = new URL(req.url ?? "", "http://localhost").searchParams.get("sessionKey")?.trim() ?? "";
      if (!sessionKey) {
        deps.json(res, { ok: false, error: "sessionKey is required" }, 400);
        return true;
      }
      deps.fallbackSessionMap.delete(sessionKey);
      deps.json(res, { ok: true });
      return true;
    }

    if (method === "POST" && pathname === "/api/agent/launch") {
      try {
        const body = JSON.parse(await deps.readBody(req)) as Record<string, unknown>;
        const result = await deps.forwardElectronAgentApi("/api/agent/launch", body);
        deps.json(res, result, result.ok ? 200 : 400);
      } catch (e: unknown) {
        deps.json(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/agent/dispatch") {
      try {
        const body = JSON.parse(await deps.readBody(req)) as {
          session_key?: string; task_text?: string; message_ids?: string[];
        };
        const session_key = body.session_key?.trim();
        const task_text = body.task_text ?? "";
        if (!session_key) {
          deps.json(res, { ok: false, error: "session_key is required" }, 400);
          return true;
        }
        const result = await deps.forwardElectronAgentApi("/api/agent/dispatch", {
          session_key,
          task_text,
          ...(Array.isArray(body.message_ids) && body.message_ids.length > 0 && { message_ids: body.message_ids }),
        });
        if (!result.ok) {
          deps.log("WARN", `dispatch_failed: session=${session_key} error=${result.error ?? "unknown"}`);
          const busyDelay = deps.parseBusyRetryDelayMs(result.error);
          if (busyDelay > 0) deps.scheduleBusyRetry(session_key, busyDelay);
        }
        deps.json(res, result, result.ok ? 200 : 400);
      } catch (e: unknown) {
        deps.json(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
      }
      return true;
    }

    if (method === "GET" && pathname === "/api/poll-message") {
      deps.json(res, { error: "not found" }, 404);
      return true;
    }

    // ── SSE 队列事件流 ──
    if (pathname === "/api/queue-events" && method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "connected", ts: Date.now() })}\n\n`);
      deps.sseClients.add(res);
      req.on("close", () => { deps.sseClients.delete(res); });
      return true;
    }

    // ── Chat 名称查询（按 chatKey 路由到对应通道）──
    if (pathname === "/api/chat-names" && method === "POST") {
      const body = JSON.parse(await deps.readBody(req));
      const chatIds = Array.isArray(body.chatIds) ? body.chatIds as string[] : [];
      const names: Record<string, string> = {};
      for (const cid of chatIds) {
        const { channelId, chatId } = deps.parseChatKey(cid);
        const rt = channelId ? deps.channels.get(channelId) : [...deps.channels.values()].find((c) => c.cfg.type === "feishu" && c.client);
        const client = rt?.client;
        if (!client) continue;
        try {
          const r: any = await client.im.chat.get({ path: { chat_id: chatId } });
          const name = r?.data?.name || r?.data?.chat?.name;
          if (name) names[cid] = name;
        } catch { /* ignore */ }
      }
      deps.json(res, { ok: true, names });
      return true;
    }

    // ── 用户名查询（通过 open_id 获取用户名）──
    if (pathname === "/api/user-names" && method === "POST") {
      const body = JSON.parse(await deps.readBody(req));
      const openIds = Array.isArray(body.openIds) ? body.openIds as string[] : [];
      const clients = [...deps.channels.values()].filter((c) => c.cfg.type === "feishu" && c.client).map((c) => c.client!);
      if (clients.length === 0) { deps.json(res, { ok: false, error: "飞书未启用" }, 400); return true; }
      const names: Record<string, string> = {};
      for (const oid of openIds) {
        for (const client of clients) {
          try {
            const r: any = await client.contact.user.get({
              path: { user_id: oid },
              params: { user_id_type: "open_id" },
            });
            const name = r?.data?.user?.name;
            if (name) { names[oid] = name; break; }
          } catch { /* ignore */ }
        }
      }
      deps.json(res, { ok: true, names });
      return true;
    }

    const crudHandler2 = deps.adminEntityRoutes[pathname];
    if (crudHandler2) return crudHandler2(method, req, res);

    return false;
  }

  return handleAdminApi;
}
