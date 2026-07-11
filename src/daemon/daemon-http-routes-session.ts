/**
 * `/api/*` 会话状态与回退栈路由簇（从 daemon-http-routes 切出）。
 */
import type * as http from "node:http";
import type { HttpRoutesDeps } from "./daemon-http-routes-types.js";

/** session-last-reply / active-session / session-fallback 等 */
export async function tryHandleSessionRoute(
  deps: HttpRoutesDeps,
  pathname: string,
  method: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
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

  return false;
}
