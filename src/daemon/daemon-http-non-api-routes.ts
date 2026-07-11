/**
 * 非 `/api/*` HTTP 路由：健康检查、队列、通道 bind、enqueue 等（从 daemon-http-server 切出）。
 */
import type * as http from "node:http";

/** 非 API 路由所需 deps 子集 */
export interface NonApiRoutesDeps {
  log: (level: string, ...args: unknown[]) => void;
  pkgVersion: string;
  readBody: (req: http.IncomingMessage) => Promise<string>;
  json: (res: http.ServerResponse, data: unknown, status?: number) => void;
  getChannelStatusList: () => Array<{ type: string; connected?: boolean; status?: string; mainUserBound?: boolean }>;
  getFileQueueLength: () => number;
  getFileQueueMessages: () => unknown[];
  deleteFileQueueMessage: (fileId: string) => boolean;
  stopDaemonScheduledTasks: () => void;
  removeLockFile: () => void;
  cleanExpiredCommands: () => void;
  channels: Map<string, {
    cfg: { name: string; type: string; mainUserEnabled?: boolean; mainUserChatId?: string };
    lastP2pChatId: string | null;
    bindArmed?: boolean;
    wechat?: { sendText: (chatId: string, text: string) => Promise<boolean> };
    sender?: { sendMessage: (text: string, replyId?: string, chatId?: string) => Promise<string | undefined> };
  }>;
  channelDefaultChatId: (rt: { cfg: { mainUserEnabled?: boolean; mainUserChatId?: string }; lastP2pChatId: string | null }) => string | null;
  isChannelConnected: (rt: unknown) => boolean;
  pushMessage: (content: string, messageId?: string, chatId?: string, chatType?: string) => Promise<void>;
  clearFileQueue: () => number;
  claimNextMessage: (sessionKey: string) => { messageId?: string; text: string } | null;
  trackMessageSession: (messageId: string, sessionKey: string) => void;
  getDistinctSessions: () => unknown[];
  getPendingCommands: () => unknown[];
  claimCommand: (fileId: string) => Record<string, unknown> | null;
  replyToMessage: (messageId: string, text: string, chatId?: string) => Promise<void>;
}

/** 处理非 `/api` 路径；已处理返回 true */
export async function handleNonApiRoute(
  deps: NonApiRoutesDeps,
  pathname: string,
  method: string | undefined,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  if (method === "GET" && (pathname === "/health" || pathname === "/status")) {
    deps.cleanExpiredCommands();
    const channelList = deps.getChannelStatusList();
    const feishuList = channelList.filter((c) => c.type === "feishu");
    const wechatList = channelList.filter((c) => c.type === "wechat");
    deps.json(res, {
      status: "ok",
      version: deps.pkgVersion,
      uptime: Math.floor(process.uptime()),
      queueLength: deps.getFileQueueLength(),
      channels: channelList,
      hasChatId: channelList.some((c) => c.connected),
      feishuEnabled: feishuList.length > 0,
      feishuConnected: feishuList.some((c) => c.connected),
      wechatEnabled: wechatList.length > 0,
      wechatStatus: wechatList.some((c) => c.status === "connected") ? "connected" : (wechatList[0]?.status ?? "disconnected"),
      wechatReady: wechatList.some((c) => c.connected),
    });
    return true;
  }

  if (method === "GET" && pathname === "/queue") {
    deps.json(res, { length: deps.getFileQueueLength(), messages: deps.getFileQueueMessages() });
    return true;
  }

  if (method === "POST" && pathname === "/queue-delete") {
    const body = JSON.parse(await deps.readBody(req));
    const { fileId } = body as { fileId?: string };
    if (!fileId) { deps.json(res, { ok: false, error: "fileId required" }, 400); return true; }
    const ok = deps.deleteFileQueueMessage(fileId);
    deps.json(res, { ok, queueLength: deps.getFileQueueLength() });
    return true;
  }

  if (method === "POST" && pathname === "/shutdown") {
    deps.log("INFO", ">>> 收到 shutdown 请求，准备退出");
    deps.json(res, { ok: true });
    setTimeout(() => {
      deps.stopDaemonScheduledTasks();
      deps.removeLockFile();
      process.exit(0);
    }, 200);
    return true;
  }

  if (method === "POST" && pathname === "/channel-test") {
    const body = JSON.parse(await deps.readBody(req));
    const channelId = typeof body.channelId === "string" ? body.channelId : "";
    const rt = deps.channels.get(channelId);
    if (!rt) { deps.json(res, { ok: false, error: "通道不存在或未启用" }, 400); return true; }
    if (!deps.isChannelConnected(rt)) { deps.json(res, { ok: false, error: "通道未连接" }, 400); return true; }
    const chatId = deps.channelDefaultChatId(rt);
    if (!chatId) { deps.json(res, { ok: false, error: "暂无私聊记录，请先绑定主用户或给机器人发一条消息" }, 400); return true; }
    try {
      if (rt.cfg.type === "wechat") {
        deps.json(res, { ok: await rt.wechat!.sendText(chatId, "🔗 微信测试成功！连接正常。") });
      } else {
        const msgId = await rt.sender!.sendMessage("🔗 绑定测试成功！连接正常。", undefined, chatId);
        deps.json(res, { ok: !!msgId });
      }
    } catch (e: unknown) {
      deps.json(res, { ok: false, error: e instanceof Error ? e.message : "发送失败" }, 500);
    }
    return true;
  }

  if (method === "POST" && pathname === "/channel-bind") {
    const body = JSON.parse(await deps.readBody(req));
    const channelId = typeof body.channelId === "string" ? body.channelId : "";
    const arm = body.arm !== false;
    const rt = deps.channels.get(channelId);
    if (!rt) { deps.json(res, { ok: false, error: "通道不存在或未启用" }, 400); return true; }
    rt.bindArmed = arm;
    deps.log("INFO", `[Bind] 通道「${rt.cfg.name}」绑定模式: ${arm ? "开启（等待私聊消息）" : "取消"}`);
    deps.json(res, { ok: true });
    return true;
  }

  if (method === "POST" && pathname === "/enqueue") {
    const body = JSON.parse(await deps.readBody(req));
    const content = typeof body.content === "string" ? body.content : "";
    if (!content) { deps.json(res, { error: "content is required" }, 400); return true; }
    const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
    const chatType = typeof body.chatType === "string" ? body.chatType : "p2p";
    const internalMsgId = `internal_enqueue_${Date.now()}`;
    if (chatId) {
      await deps.pushMessage(content, internalMsgId, chatId, chatType);
    } else {
      await deps.pushMessage(content, internalMsgId);
    }
    deps.json(res, { ok: true, queueLength: deps.getFileQueueLength() });
    return true;
  }

  if (method === "POST" && pathname === "/clear-queue") {
    deps.json(res, { ok: true, cleared: deps.clearFileQueue() });
    return true;
  }

  if (method === "POST" && pathname === "/dequeue-all") {
    const body = await deps.readBody(req).catch(() => "{}");
    const parsed = JSON.parse(body || "{}") as { sessionKey?: string; chatId?: string };
    const filterSession = parsed.sessionKey || parsed.chatId;
    if (!filterSession) {
      deps.json(res, { ok: false, error: "sessionKey is required" }, 400);
      return true;
    }
    const messages: Array<{ messageId?: string; text: string }> = [];
    let m: ReturnType<typeof deps.claimNextMessage>;
    while ((m = deps.claimNextMessage(filterSession)) !== null) {
      if (m.messageId) deps.trackMessageSession(m.messageId, filterSession);
      messages.push(m);
    }
    if (messages.length > 0) deps.log("INFO", `dequeue-all 已领取 ${messages.length} 条: session=${filterSession}`);
    deps.json(res, { ok: true, messages, queueLength: deps.getFileQueueLength() });
    return true;
  }

  if (method === "GET" && pathname === "/queue-chat-ids") {
    deps.json(res, { chats: deps.getDistinctSessions() });
    return true;
  }

  if (method === "GET" && pathname === "/commands") {
    deps.json(res, { commands: deps.getPendingCommands() });
    return true;
  }

  if (method === "POST" && pathname === "/commands/claim") {
    const body = JSON.parse(await deps.readBody(req));
    const result = deps.claimCommand(body.id);
    deps.json(res, result ? { ok: true, ...result } : { ok: false, error: "not found" });
    return true;
  }

  if (method === "POST" && pathname === "/cmd/result") {
    const body = JSON.parse(await deps.readBody(req)) as { messageId: string; ok: boolean; message: string; chatId?: string };
    deps.log("INFO", `指令执行完成: ok=${body.ok}, msgId=${body.messageId}, chatId=${body.chatId ?? "N/A"}`);
    if (body.messageId) await deps.replyToMessage(body.messageId, body.message, body.chatId);
    deps.json(res, { ok: true });
    return true;
  }

  return false;
}
