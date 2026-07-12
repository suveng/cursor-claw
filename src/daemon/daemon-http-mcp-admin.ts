/**
 * MCP admin 辅助：配置读写、开关与健康探测转发（供 daemon-http-admin-content）。
 */
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { formatMcpHealthDisplay } from "../shared/mcp-health-label.js";
import { GLOBAL_MCP_PATH, getProjectMcpPath, readJsonSafe, writeJsonSafe } from "./daemon-http-admin-io.js";

const APP_DATA_DIR = process.env.APP_DATA_DIR ?? "";

export interface McpEntry {
  name: string;
  scope: "global" | "project";
  filePath: string;
  config: Record<string, unknown>;
}

/** mcp.json disabled 字段：false 表示显式禁用 */
export function isMcpEnabled(config: Record<string, unknown>): boolean {
  return config.disabled !== true;
}

/** 按名称查找 MCP；project 同名覆盖 global（与 mcp-manager 一致） */
export function findMcpEntry(name: string, workspaceDir: string): McpEntry | null {
  const projectPath = getProjectMcpPath(workspaceDir);
  const projectServers = readJsonSafe(projectPath)?.mcpServers as Record<string, Record<string, unknown>> | undefined;
  if (projectServers?.[name]) {
    return { name, scope: "project", filePath: projectPath, config: { ...projectServers[name] } };
  }
  const globalServers = readJsonSafe(GLOBAL_MCP_PATH)?.mcpServers as Record<string, Record<string, unknown>> | undefined;
  if (globalServers?.[name]) {
    return { name, scope: "global", filePath: GLOBAL_MCP_PATH, config: { ...globalServers[name] } };
  }
  return null;
}

/** 合并 global + project 列表，供 GET /api/mcp 与斜杠 ls 对齐 */
export function mergeMcpServersForList(workspaceDir: string): Record<string, { config: unknown; scope: string; enabled: boolean }> {
  const servers: Record<string, { config: unknown; scope: string; enabled: boolean }> = {};
  const globalServers = readJsonSafe(GLOBAL_MCP_PATH)?.mcpServers as Record<string, unknown> | undefined;
  if (globalServers) {
    for (const [k, v] of Object.entries(globalServers)) {
      servers[k] = { config: v, scope: "global", enabled: isMcpEnabled(v as Record<string, unknown>) };
    }
  }
  const projectServers = readJsonSafe(getProjectMcpPath(workspaceDir))?.mcpServers as Record<string, unknown> | undefined;
  if (projectServers) {
    for (const [k, v] of Object.entries(projectServers)) {
      servers[k] = { config: v, scope: "project", enabled: isMcpEnabled(v as Record<string, unknown>) };
    }
  }
  return servers;
}

/** 写 mcp.json disabled 字段，等价 Electron toggleMcpServer */
export function toggleMcpServerEnabled(
  name: string,
  enabled: boolean,
  workspaceDir: string,
): { ok: boolean; message?: string; error?: string } {
  const entry = findMcpEntry(name, workspaceDir);
  if (!entry) return { ok: false, error: `找不到 MCP 服务器: ${name}` };
  const raw = { ...entry.config };
  if (enabled) delete raw.disabled;
  else raw.disabled = true;
  const mcpJson = readJsonSafe(entry.filePath) ?? {};
  const mcpServers = (mcpJson.mcpServers ?? {}) as Record<string, unknown>;
  mcpServers[name] = raw;
  mcpJson.mcpServers = mcpServers;
  writeJsonSafe(entry.filePath, mcpJson);
  return { ok: true, message: `${name} 已${enabled ? "启用" : "禁用"}` };
}

function readElectronAgentApiPort(): number {
  if (!APP_DATA_DIR) return 0;
  try {
    const data = JSON.parse(fs.readFileSync(path.join(APP_DATA_DIR, "agent-api-port.json"), "utf-8")) as { port?: number };
    return data.port ?? 0;
  } catch {
    return 0;
  }
}

/** 健康探测需主进程；失败时返回可理解中文，不静默成功 */
async function postElectronAgentApi<T>(subpath: string, body: object): Promise<{ ok: boolean; data?: T; error?: string }> {
  const port = readElectronAgentApiPort();
  if (!port) return { ok: false, error: "应用未运行，无法获取 MCP 健康状态" };
  const payload = JSON.stringify(body);
  return new Promise((resolve) => {
    const req = http.request(
      `http://127.0.0.1:${port}${subpath}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        timeout: 15_000,
      },
      (res) => {
        const chunks: string[] = [];
        res.on("data", (c: Buffer) => chunks.push(c.toString()));
        res.on("end", () => {
          try {
            const data = JSON.parse(chunks.join("")) as T & { error?: string };
            if (res.statusCode && res.statusCode >= 400) {
              resolve({ ok: false, error: data.error ?? `主进程 HTTP ${res.statusCode}，无法获取 MCP 健康状态` });
              return;
            }
            resolve({ ok: true, data });
          } catch {
            resolve({ ok: false, error: "主进程响应无效，无法获取 MCP 健康状态" });
          }
        });
      },
    );
    req.on("error", () => resolve({ ok: false, error: "应用未运行或未就绪，无法获取 MCP 健康状态" }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "主进程响应超时，无法获取 MCP 健康状态" }); });
    req.end(payload);
  });
}

/** 转发 Electron agent-api 获取 MCP 健康 map（M3；端点由主进程侧补齐） */
export async function fetchElectronMcpStatusMap(workspaceDir: string): Promise<{ ok: boolean; statusMap?: Record<string, string>; error?: string }> {
  const res = await postElectronAgentApi<{ statusMap?: Record<string, string>; error?: string }>(
    "/api/mcp/status-map",
    { workspaceDir, force: false },
  );
  if (!res.ok) return { ok: false, error: res.error };
  if (res.data?.statusMap) return { ok: true, statusMap: res.data.statusMap };
  return { ok: false, error: res.data?.error ?? "无法获取 MCP 健康状态" };
}

export function buildMcpServerInfo(entry: McpEntry, healthStatus?: string, healthError?: string) {
  const enabled = isMcpEnabled(entry.config);
  const healthKey = enabled ? healthStatus : "disabled";
  return {
    name: entry.name,
    scope: entry.scope,
    source: entry.scope,
    enabled,
    type: entry.config.url ? "url" : "command",
    command: entry.config.command as string | undefined,
    args: entry.config.args as string[] | undefined,
    url: entry.config.url as string | undefined,
    envKeys: entry.config.env && typeof entry.config.env === "object"
      ? Object.keys(entry.config.env as Record<string, unknown>)
      : [],
    health: formatMcpHealthDisplay(
      healthKey || undefined,
      enabled && healthError ? healthError : undefined,
    ),
    healthStatus: healthKey ?? null,
    healthError,
  };
}
