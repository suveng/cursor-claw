/**
 * 飞书入站解析：extractCardText / parseMessageContent / processIncomingMessage。
 * processIncomingMessage 会下载图片到媒体缓存。
 */
import type { LarkSenderCtx, ParsedMessage } from "./lark-types.js";
import { downloadImage } from "./lark-sender-outbound.js";

/** 递归提取 interactive 卡片元素中的可读文本 */
export function extractCardText(elements: any[], parts: string[]): void {
  for (const el of elements) {
    if (!el) continue;
    if (Array.isArray(el)) { extractCardText(el, parts); continue; }
    if (typeof el !== "object") continue;

    const tag: string = el.tag ?? "";
    switch (tag) {
      case "markdown":
      case "plain_text":
        if (el.content) parts.push(el.content);
        break;
      case "text":
        if (el.text) parts.push(el.text);
        break;
      case "div":
        if (el.text?.content) parts.push(el.text.content);
        if (Array.isArray(el.extra)) extractCardText(el.extra, parts);
        break;
      case "column_set":
        if (Array.isArray(el.columns)) {
          for (const col of el.columns) {
            if (Array.isArray(col.elements)) extractCardText(col.elements, parts);
          }
        }
        break;
      case "form":
      case "interactive_container":
      case "collapsible_panel":
        if (Array.isArray(el.elements)) extractCardText(el.elements, parts);
        break;
      case "action":
        if (Array.isArray(el.actions)) {
          for (const act of el.actions) {
            const txt = act.text?.content ?? act.text?.text;
            if (txt) parts.push(`[按钮: ${txt}]`);
          }
        }
        break;
      case "button":
        if (el.text?.content) parts.push(`[按钮: ${el.text.content}]`);
        break;
      case "note":
        if (Array.isArray(el.elements)) {
          const noteTexts = el.elements.filter((n: any) => n.content).map((n: any) => n.content);
          if (noteTexts.length) parts.push(noteTexts.join(" "));
        }
        break;
      case "table":
        if (el.header?.titles) parts.push(el.header.titles.map((t: any) => t.content ?? t).join(" | "));
        if (Array.isArray(el.rows)) {
          for (const row of el.rows) {
            if (Array.isArray(row)) parts.push(row.map((c: any) => c?.content ?? c?.text ?? String(c ?? "")).join(" | "));
          }
        }
        break;
      case "img":
      case "img_combination":
        parts.push("[图片]");
        break;
      case "chart":
        parts.push("[图表]");
        break;
      case "person":
        if (el.user_id) parts.push(`[@用户]`);
        break;
      case "hr":
        break;
      default:
        if (el.text?.content) parts.push(el.text.content);
        if (el.content && typeof el.content === "string") parts.push(el.content);
        if (Array.isArray(el.elements)) extractCardText(el.elements, parts);
        break;
    }
  }
}

/** 按 messageType 解析 content JSON 为文本与 imageKeys */
export function parseMessageContent(
  messageId: string,
  messageType: string,
  content: string,
): ParsedMessage {
  const result: ParsedMessage = { text: "", imageKeys: [] };
  try {
    const parsed = JSON.parse(content);
    switch (messageType) {
      case "text": result.text = parsed.text ?? content; break;
      case "image":
        if (parsed.image_key) {
          result.imageKeys.push({ messageId, imageKey: parsed.image_key });
          result.text = "[图片]";
        }
        break;
      case "post": {
        const localized = parsed.zh_cn ?? parsed.en_us ?? parsed.ja_jp ?? parsed;
        const lineTexts: string[] = [];
        if (localized.title) lineTexts.push(localized.title);
        const lines = localized.content ?? localized.elements ?? [];
        if (!Array.isArray(lines)) { result.text = content; break; }
        for (const line of lines) {
          if (!Array.isArray(line)) continue;
          const segs: string[] = [];
          for (const el of line) {
            switch (el.tag) {
              case "text": if (el.text) segs.push(el.text); break;
              case "a": if (el.text) segs.push(el.href ? `${el.text}(${el.href})` : el.text); break;
              case "at": if (el.user_name) segs.push(`@${el.user_name}`); break;
              case "img":
                if (el.image_key) {
                  result.imageKeys.push({ messageId, imageKey: el.image_key });
                  segs.push("[图片]");
                }
                break;
              case "media": segs.push("[视频]"); break;
              case "emotion": if (el.emoji_type) segs.push(`[${el.emoji_type}]`); break;
              case "code_block": if (el.text) segs.push(`\`\`\`${el.language ?? ""}\n${el.text}\n\`\`\``); break;
              case "hr": segs.push("---"); break;
            }
          }
          if (segs.length) lineTexts.push(segs.join(""));
        }
        result.text = lineTexts.join("\n");
        break;
      }
      case "interactive": {
        const parts: string[] = [];
        const header = parsed.header ?? parsed.i18n_header?.zh_cn ?? parsed.i18n_header?.en_us;
        if (header?.title?.content) parts.push(header.title.content);
        const isV2 = parsed.schema === "2.0";
        const elements = isV2
          ? (parsed.body?.elements ?? [])
          : (parsed.elements ?? parsed.i18n_elements?.zh_cn ?? parsed.i18n_elements?.en_us ?? parsed.i18n_body?.zh_cn?.elements ?? []);
        if (Array.isArray(elements)) extractCardText(elements, parts);
        result.text = parts.join("\n") || "[卡片消息]";
        break;
      }
      case "file": result.text = `[文件: ${parsed.file_name ?? "未知"}]`; break;
      case "folder": result.text = `[文件夹: ${parsed.folder_name ?? "未知"}]`; break;
      case "audio":
        result.text = parsed.duration
          ? `[语音消息 ${Math.ceil(parsed.duration / 1000)}s]`
          : "[语音消息]";
        break;
      case "video": result.text = parsed.file_name ? `[视频: ${parsed.file_name}]` : "[视频]"; break;
      case "media": {
        const mediaParts = [parsed.file_name ?? "视频"];
        if (parsed.duration) mediaParts.push(`${Math.ceil(parsed.duration / 1000)}s`);
        result.text = `[媒体: ${mediaParts.join(" ")}]`;
        if (parsed.image_key) result.imageKeys.push({ messageId, imageKey: parsed.image_key });
        break;
      }
      case "sticker": result.text = "[表情包]"; break;
      case "share_chat": result.text = parsed.chat_name ? `[分享群聊: ${parsed.chat_name}]` : "[分享群聊]"; break;
      case "share_user": result.text = parsed.user_id ? `[分享名片: ${parsed.user_id}]` : "[分享名片]"; break;
      case "merge_forward": result.text = "[合并转发消息]"; break;
      case "system": {
        const tpl = parsed.template ?? "";
        if (parsed.content) {
          try {
            const sysContent = JSON.parse(parsed.content);
            result.text = `[系统消息: ${sysContent.text ?? tpl}]`;
          } catch { result.text = `[系统消息: ${tpl || parsed.content}]`; }
        } else {
          result.text = tpl ? `[系统消息: ${tpl}]` : "[系统消息]";
        }
        break;
      }
      case "hongbao": result.text = "[红包]"; break;
      case "share_calendar_event": result.text = parsed.summary ? `[日程: ${parsed.summary}]` : "[日程邀请]"; break;
      case "calendar": result.text = parsed.summary ? `[日历: ${parsed.summary}]` : "[日历消息]"; break;
      case "general_calendar": result.text = parsed.summary ? `[日程: ${parsed.summary}]` : "[通用日历]"; break;
      case "location": result.text = parsed.name ? `[位置: ${parsed.name}]` : "[位置]"; break;
      case "video_chat": {
        const topic = parsed.topic ?? "";
        const vcType = parsed.call_type === "1" ? "视频通话" : "语音通话";
        result.text = topic ? `[${vcType}: ${topic}]` : `[${vcType}]`;
        break;
      }
      case "todo": result.text = parsed.task_content?.summary ?? "[待办任务]"; break;
      case "vote": result.text = parsed.topic ? `[投票: ${parsed.topic}]` : "[投票]"; break;
      default: result.text = parsed.text ?? "[不支持的消息类型]";
    }
  } catch { result.text = content; }
  return result;
}

/** 解析入站并下载图片，返回拼接后的可读文本 */
export async function processIncomingMessage(
  ctx: LarkSenderCtx,
  messageId: string,
  messageType: string,
  content: string,
): Promise<string> {
  const parsed = parseMessageContent(messageId, messageType, content);
  const total = parsed.imageKeys.length;
  let text = parsed.text;
  if (total > 1) {
    let idx = 0;
    text = text.replace(/\[图片\]/g, () => `[图片${++idx}]`);
  }
  const parts: string[] = [];
  if (text) parts.push(text);
  for (let i = 0; i < total; i++) {
    const img = parsed.imageKeys[i];
    const localPath = await downloadImage(ctx, img.messageId, img.imageKey);
    const label = total > 1 ? `图片${i + 1}` : "图片";
    parts.push(localPath ? `[${label}已保存: ${localPath}]` : `[${label}下载失败: ${img.imageKey}]`);
  }
  return parts.join("\n");
}
