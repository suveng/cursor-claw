/**
 * `/api/*` 消息发送与 presentation 路由簇（从 daemon-http-routes 切出）。
 */
import type * as http from "node:http";
import type { PresentationEvent } from "./daemon-presentation-types.js";
import type { HttpRoutesDeps } from "./daemon-http-routes-types.js";

/** 发送路由侧通道运行时（窄化 unknown rt，避免与 daemon ChannelRuntime 强耦合） */
type SendChannelRt = {
  wechat?: { sendText: (chatId: string, text: string) => Promise<boolean>; sendMedia: (chatId: string, path: string) => Promise<unknown> };
  sender?: {
    sendMessage: (text: string, replyId?: string, chatId?: string, title?: string) => Promise<string | undefined>;
    sendImage: (path: string, replyId?: string, chatId?: string) => Promise<void>;
    sendFile: (path: string, replyId?: string, chatId?: string) => Promise<void>;
  };
};

/** send-text / send-image / send-file / presentation-event / stream-text */
export async function tryHandleSendRoute(
  deps: HttpRoutesDeps,
  pathname: string,
  method: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
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
      const rt = ch.rt as SendChannelRt;
      sendOk = await rt.wechat!.sendText(ch.chatId!, text);
      deps.json(res, { ok: sendOk });
    } else {
      const rt = ch.rt as SendChannelRt;
      const sender = rt.sender!;
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
      const rt = ch.rt as SendChannelRt;
      await rt.wechat!.sendMedia(ch.chatId!, image_path);
    } else {
      const rt = ch.rt as SendChannelRt;
      await rt.sender!.sendImage(image_path, message_id, ch.chatId);
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
      const rt = ch.rt as SendChannelRt;
      await rt.wechat!.sendMedia(ch.chatId!, file_path);
    } else {
      const rt = ch.rt as SendChannelRt;
      await rt.sender!.sendFile(file_path, message_id, ch.chatId);
    }
    deps.json(res, { ok: true });
    if (session_key) {
      deps.sessionLastReplyAt.set(session_key, Date.now());
      deps.ackOnReply(message_id, session_key);
      deps.stopSessionProgress(session_key);
    }
    return true;
  }

  return false;
}
