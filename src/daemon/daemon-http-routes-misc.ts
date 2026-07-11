/**
 * `/api/*` SSE 与 Lark 名称查询路由簇（从 daemon-http-routes 切出）。
 */
import type * as http from "node:http";
import type { HttpRoutesDeps } from "./daemon-http-routes-types.js";

/** queue-events SSE / chat-names / user-names */
export async function tryHandleMiscApiRoute(
  deps: HttpRoutesDeps,
  pathname: string,
  method: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
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

  if (pathname === "/api/chat-names" && method === "POST") {
    const body = JSON.parse(await deps.readBody(req));
    const chatIds = Array.isArray(body.chatIds) ? body.chatIds as string[] : [];
    const names: Record<string, string> = {};
    for (const cid of chatIds) {
      const { channelId, chatId } = deps.parseChatKey(cid);
      const rt = channelId ? deps.channels.get(channelId) : [...deps.channels.values()].find((c) => c.cfg.type === "feishu" && c.client);
      const client = rt?.client as { im?: { chat?: { get: (opts: { path: { chat_id: string } }) => Promise<{ data?: { name?: string; chat?: { name?: string } } }> } } } | undefined;
      if (!client) continue;
      try {
        const r = await client.im!.chat!.get({ path: { chat_id: chatId } });
        const name = r?.data?.name || r?.data?.chat?.name;
        if (name) names[cid] = name;
      } catch { /* ignore */ }
    }
    deps.json(res, { ok: true, names });
    return true;
  }

  if (pathname === "/api/user-names" && method === "POST") {
    const body = JSON.parse(await deps.readBody(req));
    const openIds = Array.isArray(body.openIds) ? body.openIds as string[] : [];
    const clients = [...deps.channels.values()].filter((c) => c.cfg.type === "feishu" && c.client).map((c) => c.client!);
    if (clients.length === 0) { deps.json(res, { ok: false, error: "飞书未启用" }, 400); return true; }
    const names: Record<string, string> = {};
    for (const oid of openIds) {
      for (const client of clients) {
        try {
          const c = client as { contact?: { user?: { get: (opts: { path: { user_id: string }; params: { user_id_type: string } }) => Promise<{ data?: { user?: { name?: string } } }> } } };
          const r = await c.contact!.user!.get({
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

  return false;
}
