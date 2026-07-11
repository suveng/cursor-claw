/**
 * MCP Server 工厂：agent 与 admin 工具注册（从 daemon-http-server 垂直切出）。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerAdminTools } from "./server-admin.js";
import { registerWorkflowAgentTools, registerWorkflowAdminTools } from "../workflow/server-workflow.js";

/** MCP 工厂所需最小 deps（httpJson / localDaemonUrl 由监听壳在端口确定后注入） */
export interface McpFactoryDeps {
  log: (level: string, ...args: unknown[]) => void;
  pkgVersion: string;
  httpJson: <T>(url: string, body?: unknown, timeoutMs?: number) => Promise<T>;
  localDaemonUrl: (p: string) => string;
}

/** 创建 agent MCP：send_text / send_image / send_file + workflow 工具 */
export function createMcpServer(deps: McpFactoryDeps): McpServer {
  const s = new McpServer({
    name: "cursor-claw",
    version: deps.pkgVersion,
    description: "消息桥接 – 通过飞书/微信与用户沟通",
  });

  s.tool(
    "send_text",
    "发送文本消息到飞书/微信。飞书群聊中可 @ 其他成员或机器人：在 text 中使用 `<at user_id=\"ou_xxx\">名字</at>` 标签（open_id 可从收到消息的 @名字(open_id=ou_xxx) 内联标注或 [可协作机器人] 名册中获取），被 @ 的机器人会收到事件并响应。",
    {
      text: z.string().describe("要发送的消息内容；含 <at user_id=\"ou_xxx\">名字</at> 标签时自动以可触发 @ 通知的文本消息发送"),
      message_id: z.string().optional().describe("要回复的消息ID，传入后以回复模式发送"),
      session_key: z.string().optional().describe("目标会话的 sessionKey，用于精确投递"),
    },
    async ({ text, message_id, session_key }) => {
      try {
        const r = await deps.httpJson<{ ok: boolean }>(
          deps.localDaemonUrl("/api/send-text"),
          { text, message_id, session_key },
        );
        if (!r?.ok) {
          deps.log("WARN", `send_text 发送失败: message_id=${message_id}`);
          return { content: [{ type: "text" as const, text: "[send_failed] 消息发送失败" }] };
        }
        return { content: [{ type: "text" as const, text: "消息已发送" }] };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        deps.log("ERROR", `send_text 异常: ${msg}`);
        return { content: [{ type: "text" as const, text: `[error] ${msg}` }] };
      }
    },
  );

  s.tool(
    "send_image",
    "发送本地图片到飞书/微信。image_path 为本地文件绝对路径。",
    {
      image_path: z.string().describe("图片绝对路径"),
      message_id: z.string().optional().describe("要回复的消息ID，传入后以回复模式发送"),
      session_key: z.string().optional().describe("目标会话的 sessionKey，用于精确投递"),
    },
    async ({ image_path, message_id, session_key }) => {
      try {
        await deps.httpJson(deps.localDaemonUrl("/api/send-image"), { image_path, message_id, session_key });
        return { content: [{ type: "text" as const, text: "图片已发送" }] };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        deps.log("ERROR", `send_image 异常: ${msg}`);
        return { content: [{ type: "text" as const, text: `[error] ${msg}` }] };
      }
    },
  );

  s.tool(
    "send_file",
    "发送本地文件到飞书/微信。file_path 为本地文件绝对路径。",
    {
      file_path: z.string().describe("文件绝对路径"),
      message_id: z.string().optional().describe("要回复的消息ID，传入后以回复模式发送"),
      session_key: z.string().optional().describe("目标会话的 sessionKey，用于精确投递"),
    },
    async ({ file_path, message_id, session_key }) => {
      try {
        await deps.httpJson(deps.localDaemonUrl("/api/send-file"), { file_path, message_id, session_key });
        return { content: [{ type: "text" as const, text: "文件已发送" }] };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        deps.log("ERROR", `send_file 异常: ${msg}`);
        return { content: [{ type: "text" as const, text: `[error] ${msg}` }] };
      }
    },
  );

  registerWorkflowAgentTools(s);
  return s;
}

/** 创建 admin MCP：server-admin + workflow admin 工具 */
export function createAdminMcpServer(deps: McpFactoryDeps): McpServer {
  const s = new McpServer({
    name: "cursor-claw-admin",
    version: deps.pkgVersion,
    description: "cursor-claw 管理工具",
  });
  registerAdminTools(s);
  registerWorkflowAdminTools(s);
  return s;
}
