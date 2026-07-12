/**
 * 飞书出站：plain text / post+md、回复、表情、图片/文件、下载。
 * 含 @ 时 Markdown→text 降级；由 LarkSender 门面委托。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { MEDIA_CACHE_DIR } from "./lark-utils.js";
import type { LarkSenderCtx } from "./lark-types.js";

/** 文本中含 `<at user_id="ou_xxx">` 时需用 text 消息才能产生真实 mention */
export function containsAtTag(text: string): boolean {
  return /<at\s+user_id=/.test(text);
}

/**
 * 构建出站消息体：默认 post + md；含 `<at user_id=` 时降级 plain text。
 */
export function buildOutboundPayload(
  ctx: LarkSenderCtx,
  text: string,
  title?: string,
): { content: string; msgType: string } {
  const fullText = `${ctx.messagePrefix}${text}`;
  if (containsAtTag(fullText)) {
    const plain = title ? `【${title}】\n${fullText}` : fullText;
    return { content: JSON.stringify({ text: plain }), msgType: "text" };
  }
  const zhCn: Record<string, unknown> = {
    content: [[{ tag: "md", text: fullText }]],
  };
  if (title) zhCn.title = title;
  return { content: JSON.stringify({ zh_cn: zhCn }), msgType: "post" };
}

/** formatForSend 别名：与历史私有方法同语义 */
export function formatForSend(
  ctx: LarkSenderCtx,
  text: string,
  title?: string,
): { content: string; msgType: string } {
  return buildOutboundPayload(ctx, text, title);
}

/** 流式首包：发送 plain text（后续经 updateMessageContent 增量更新） */
export async function sendStreamMessage(
  ctx: LarkSenderCtx,
  text: string,
  chatId?: string,
  title?: string,
): Promise<string | undefined> {
  const targetChatId = chatId ?? ctx.chatId;
  if (!targetChatId) { ctx.log("WARN", "无发送目标"); return undefined; }
  try {
    const { content, msgType } = buildOutboundPayload(ctx, text, title);
    const res = await ctx.client.im.message.create({
      params: { receive_id_type: "chat_id" as any },
      data: { receive_id: targetChatId, content, msg_type: msgType },
    });
    if ((res as any).code === 0 || (res as any).code === undefined) {
      ctx.log("INFO", `飞书流式首包已发送(${text.length}字)`);
    } else {
      ctx.log("ERROR", `飞书流式首包失败: code=${(res as any).code}, msg=${(res as any).msg}`);
    }
    return (res as any)?.data?.message_id;
  } catch (e: any) {
    ctx.log("ERROR", `飞书流式首包异常: ${e?.message ?? e}`);
    return undefined;
  }
}

/** 更新已发送 outbound；返回 false 时 daemon 降级分段 sendMessage */
export async function updateMessageContent(
  ctx: LarkSenderCtx,
  messageId: string,
  text: string,
  title?: string,
): Promise<boolean> {
  try {
    const { content, msgType } = buildOutboundPayload(ctx, text, title);
    const res = await (ctx.client.im.message as any).update({
      path: { message_id: messageId },
      data: { msg_type: msgType, content },
    });
    if ((res as any).code === 0 || (res as any).code === undefined) return true;
    ctx.log("WARN", `飞书 ${msgType} update 失败: code=${(res as any).code}, msg=${(res as any).msg}`);
    return false;
  } catch (e: any) {
    ctx.log("WARN", `飞书消息更新失败 (${messageId}): ${e?.message ?? e}`);
    return false;
  }
}

/** 回复指定消息 */
export async function replyMessage(
  ctx: LarkSenderCtx,
  messageId: string,
  text: string,
  title?: string,
): Promise<string | undefined> {
  try {
    const { content, msgType } = formatForSend(ctx, text, title);
    const res = await ctx.client.im.message.reply({
      path: { message_id: messageId },
      data: { content, msg_type: msgType },
    });
    if ((res as any).code === 0 || (res as any).code === undefined) {
      ctx.log("INFO", `飞书回复已发送(${text.length}字)`);
    } else {
      ctx.log("ERROR", `飞书回复失败: code=${(res as any).code}, msg=${(res as any).msg}`);
    }
    return (res as any)?.data?.message_id;
  } catch (e: any) {
    ctx.log("ERROR", `飞书回复异常: ${e?.message ?? e}`);
    return undefined;
  }
}

/** 发送消息（有 replyMessageId 且非 internal_ 时走 reply） */
export async function sendMessage(
  ctx: LarkSenderCtx,
  text: string,
  replyMessageId?: string,
  chatId?: string,
  title?: string,
): Promise<string | undefined> {
  if (replyMessageId && !replyMessageId.startsWith("internal_")) {
    return replyMessage(ctx, replyMessageId, text, title);
  }
  const targetChatId = chatId ?? ctx.chatId;
  if (!targetChatId) { ctx.log("WARN", "无发送目标"); return undefined; }
  try {
    const { content, msgType } = formatForSend(ctx, text, title);
    const res = await ctx.client.im.message.create({
      params: { receive_id_type: "chat_id" as any },
      data: { receive_id: targetChatId, content, msg_type: msgType },
    });
    if ((res as any).code === 0 || (res as any).code === undefined) {
      ctx.log("INFO", `飞书消息已发送(${text.length}字)`);
    } else {
      ctx.log("ERROR", `飞书发送失败: code=${(res as any).code}, msg=${(res as any).msg}`);
    }
    return (res as any)?.data?.message_id;
  } catch (e: any) {
    ctx.log("ERROR", `飞书发送异常: ${e?.message ?? e}`);
    return undefined;
  }
}

/** 给消息添加表情反应（默认 Get） */
export async function addReaction(
  ctx: LarkSenderCtx,
  messageId: string,
  emojiType: string = "Get",
): Promise<boolean> {
  try {
    const res = await ctx.client.im.messageReaction.create({
      path: { message_id: messageId },
      data: { reaction_type: { emoji_type: emojiType } },
    });
    if ((res as any).code === 0 || (res as any).code === undefined) return true;
    ctx.log("WARN", `添加表情失败: code=${(res as any).code}`);
    return false;
  } catch (e: any) {
    ctx.log("WARN", `添加表情异常: ${e?.message ?? e}`);
    return false;
  }
}

/** 上传并发送图片 */
export async function sendImage(
  ctx: LarkSenderCtx,
  imagePath: string,
  replyMessageId?: string,
  chatId?: string,
): Promise<void> {
  const absPath = path.resolve(imagePath);
  if (!fs.existsSync(absPath)) { ctx.log("ERROR", `图片不存在: ${absPath}`); return; }
  try {
    const uploadRes: any = await ctx.client.im.image.create({
      data: { image_type: "message", image: fs.createReadStream(absPath) },
    });
    const imageKey = uploadRes?.data?.image_key ?? uploadRes?.image_key;
    if (!imageKey) { ctx.log("ERROR", `图片上传失败`); return; }
    const content = JSON.stringify({ image_key: imageKey });
    let sent = false;
    if (replyMessageId && !replyMessageId.startsWith("internal_")) {
      try {
        await ctx.client.im.message.reply({
          path: { message_id: replyMessageId },
          data: { content, msg_type: "image" },
        });
        sent = true;
      } catch (e: any) {
        ctx.log("WARN", `图片回复退避 (${replyMessageId}): ${e?.message}`);
      }
    }
    if (!sent) {
      const targetChatId = chatId ?? ctx.chatId;
      if (!targetChatId) { ctx.log("WARN", "无发送目标"); return; }
      await ctx.client.im.message.create({
        params: { receive_id_type: "chat_id" as any },
        data: { receive_id: targetChatId, content, msg_type: "image" },
      });
    }
    ctx.log("INFO", "图片已发送");
  } catch (e: any) {
    ctx.log("ERROR", `发送图片异常: ${e?.message ?? e}`);
  }
}

/** 上传并发送文件 */
export async function sendFile(
  ctx: LarkSenderCtx,
  filePath: string,
  replyMessageId?: string,
  chatId?: string,
): Promise<void> {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) { ctx.log("ERROR", `文件不存在: ${absPath}`); return; }
  try {
    const fileName = path.basename(absPath);
    const uploadRes: any = await ctx.client.im.file.create({
      data: { file_type: "stream", file_name: fileName, file: fs.createReadStream(absPath) },
    });
    const fileKey = uploadRes?.data?.file_key ?? uploadRes?.file_key;
    if (!fileKey) { ctx.log("ERROR", `文件上传失败`); return; }
    const content = JSON.stringify({ file_key: fileKey, file_name: fileName });
    let sent = false;
    if (replyMessageId && !replyMessageId.startsWith("internal_")) {
      try {
        await ctx.client.im.message.reply({
          path: { message_id: replyMessageId },
          data: { content, msg_type: "file" },
        });
        sent = true;
      } catch (e: any) {
        ctx.log("WARN", `文件回复退避 (${replyMessageId}): ${e?.message}`);
      }
    }
    if (!sent) {
      const targetChatId = chatId ?? ctx.chatId;
      if (!targetChatId) { ctx.log("WARN", "无发送目标"); return; }
      await ctx.client.im.message.create({
        params: { receive_id_type: "chat_id" as any },
        data: { receive_id: targetChatId, content, msg_type: "file" },
      });
    }
    ctx.log("INFO", `文件已发送: ${fileName}`);
  } catch (e: any) {
    ctx.log("ERROR", `发送文件异常: ${e?.message ?? e}`);
  }
}

/** 下载消息内图片到媒体缓存目录 */
export async function downloadImage(
  ctx: LarkSenderCtx,
  messageId: string,
  imageKey: string,
): Promise<string | null> {
  try {
    if (!fs.existsSync(MEDIA_CACHE_DIR)) fs.mkdirSync(MEDIA_CACHE_DIR, { recursive: true });
    const resp: any = await ctx.client.im.messageResource.get({
      path: { message_id: messageId, file_key: imageKey },
      params: { type: "image" },
    });
    const filePath = path.join(MEDIA_CACHE_DIR, `${imageKey}.png`);
    if (resp && typeof resp.pipe === "function") {
      const ws = fs.createWriteStream(filePath);
      await new Promise<void>((resolve, reject) => {
        resp.pipe(ws);
        ws.on("finish", resolve);
        ws.on("error", reject);
      });
      return filePath;
    }
    if (resp?.writeFile) { await resp.writeFile(filePath); return filePath; }
    return null;
  } catch (e: any) {
    ctx.log("ERROR", `下载图片异常: ${e?.message ?? e}`);
    return null;
  }
}
