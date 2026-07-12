/**
 * 斜杠 /mcp 子命令：复用 T3 daemon-http-mcp-admin 与 admin IO 语义。
 */
import {
  GLOBAL_MCP_PATH,
  getProjectMcpPath,
  readJsonSafe,
  writeJsonSafe,
} from "./daemon-http-admin-io.js";
import {
  buildMcpServerInfo,
  fetchElectronMcpStatusMap,
  findMcpEntry,
  mergeMcpServersForList,
  toggleMcpServerEnabled,
} from "./daemon-http-mcp-admin.js";

/** /mcp 斜杠所需最小 deps */
export interface SlashMcpDeps {
  workspaceDir: string;
}

/** 与 electron/command-handler MCP_SUBCMD_HELP 对齐 */
const MCP_SUBCMD_HELP = [
  "📦 MCP 服务器管理",
  "",
  "  /mcp ls              列出所有 MCP 服务器",
  "  /mcp info <序号|名称>  查看详情",
  "  /mcp enable <序号|名称> 启用",
  "  /mcp disable <序号|名称> 禁用",
  "  /mcp delete <序号|名称> 删除",
  '  /mcp add <json>       添加（如 /mcp add {"name":"test","command":"npx","args":["-y","xxx"]}）',
].join("\n");

function formatMcpHealthStatus(status?: string): string {
  if (!status) return "未知";
  if (status === "ready") return "🟢 可连接";
  if (status === "disabled") return "⚪ 已禁用";
  if (status === "needs_login") return "🟡 需 OAuth 授权";
  return `🔴 ${status}`;
}

/** 按序号或名称解析 MCP 目标 */
function resolveMcpNameByToken(
  servers: Record<string, { config: unknown; scope: string; enabled: boolean }>,
  token: string,
): string | null {
  const names = Object.keys(servers);
  const idx = parseInt(token, 10);
  if (!Number.isNaN(idx) && idx >= 1 && idx <= names.length) return names[idx - 1];
  return names.find((n) => n.toLowerCase() === token.toLowerCase()) ?? null;
}

/** 执行 /mcp 斜杠子命令 */
export async function executeSlashMcp(
  deps: SlashMcpDeps,
  raw: string,
): Promise<{ ok: boolean; message: string }> {
  const parts = raw.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length <= 1) return { ok: true, message: MCP_SUBCMD_HELP };
  const sub = parts[1].toLowerCase();
  if (sub === "help" || sub === "-h") return { ok: true, message: MCP_SUBCMD_HELP };

  const servers = mergeMcpServersForList(deps.workspaceDir);
  const names = Object.keys(servers);

  if (sub === "ls" || sub === "list") {
    if (names.length === 0) {
      return { ok: true, message: "📭 暂无 MCP 服务器\n\n💡 可在设置页 MCP Tab 或编辑 mcp.json 添加配置" };
    }
    const health = await fetchElectronMcpStatusMap(deps.workspaceDir);
    const statusMap = health.ok ? health.statusMap ?? {} : {};
    const lines = names.map((name, i) => {
      const s = servers[name];
      const flag = s.enabled === false ? "🔴" : "🟢";
      const src = s.scope === "global" ? "[G]" : "[P]";
      const cfg = s.config as Record<string, unknown>;
      const detail = cfg.url ? String(cfg.url) : String(cfg.command ?? "");
      const healthKey = s.enabled === false ? "disabled" : (statusMap[name] ?? "");
      return `  ${i + 1}. ${flag} ${src} ${name}  (${detail})  ${formatMcpHealthStatus(healthKey)}`;
    });
    return { ok: true, message: `📦 MCP 服务器列表：\n${lines.join("\n")}` };
  }

  if (sub === "info") {
    const token = parts[2];
    if (!token) return { ok: false, message: "用法: /mcp info <序号|名称>" };
    const name = resolveMcpNameByToken(servers, token);
    if (!name) return { ok: false, message: `❌ 找不到: ${token}` };
    const entry = findMcpEntry(name, deps.workspaceDir);
    if (!entry) return { ok: false, message: `❌ 找不到: ${token}` };
    let healthStatus: string | undefined;
    let healthError: string | undefined;
    if (entry.config.disabled !== true) {
      const h = await fetchElectronMcpStatusMap(deps.workspaceDir);
      if (h.ok) healthStatus = h.statusMap?.[name];
      else healthError = h.error;
    }
    const info = buildMcpServerInfo(entry, healthStatus, healthError);
    const lines = [
      `📦 ${info.name}`,
      `  类型: ${info.type}`,
      `  来源: ${info.source}`,
      `  开关: ${info.enabled ? "🟢 已启用" : "🔴 已禁用"}`,
      `  健康: ${info.health}${info.healthError ? `（${info.healthError}）` : ""}`,
    ];
    if (info.type === "url" && info.url) lines.push(`  URL: ${info.url}`);
    else if (info.command) lines.push(`  命令: ${info.command} ${(info.args ?? []).join(" ")}`);
    if (info.envKeys.length > 0) lines.push(`  环境变量: ${info.envKeys.join(", ")}`);
    return { ok: true, message: lines.join("\n") };
  }

  if (sub === "enable" || sub === "disable") {
    const token = parts[2];
    if (!token) return { ok: false, message: `用法: /mcp ${sub} <序号|名称>` };
    const name = resolveMcpNameByToken(servers, token);
    if (!name) return { ok: false, message: `❌ 找不到: ${token}` };
    const enabled = sub === "enable";
    const result = toggleMcpServerEnabled(name, enabled, deps.workspaceDir);
    return result.ok
      ? { ok: true, message: result.message ?? `✅ ${name} 已${enabled ? "启用" : "禁用"}` }
      : { ok: false, message: `❌ ${result.error ?? "操作失败"}` };
  }

  if (sub === "delete" || sub === "rm") {
    const token = parts[2];
    if (!token) return { ok: false, message: "用法: /mcp delete <序号|名称>" };
    const name = resolveMcpNameByToken(servers, token);
    if (!name) return { ok: false, message: `❌ 找不到: ${token}` };
    for (const p of [GLOBAL_MCP_PATH, getProjectMcpPath(deps.workspaceDir)]) {
      const mcpJson = readJsonSafe(p);
      const mcpServers = mcpJson?.mcpServers as Record<string, unknown> | undefined;
      if (mcpServers?.[name]) {
        delete mcpServers[name];
        writeJsonSafe(p, mcpJson!);
        return { ok: true, message: `🗑️ ${name} 已删除` };
      }
    }
    return { ok: false, message: `❌ 找不到: ${token}` };
  }

  if (sub === "add") {
    const jsonStr = raw.replace(/^\/mcp\s+add\s*/i, "").trim();
    if (!jsonStr) {
      return { ok: false, message: '用法: /mcp add {"name":"xxx","command":"npx","args":[...]}' };
    }
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      const name = parsed.name as string;
      if (!name) return { ok: false, message: "❌ 缺少 name 字段" };
      const { name: _omit, ...entry } = parsed;
      const targetPath = getProjectMcpPath(deps.workspaceDir);
      const mcpJson = readJsonSafe(targetPath) ?? {};
      const mcpServers = (mcpJson.mcpServers ?? {}) as Record<string, unknown>;
      mcpServers[name] = entry;
      mcpJson.mcpServers = mcpServers;
      writeJsonSafe(targetPath, mcpJson);
      return { ok: true, message: `✅ ${name} 已添加` };
    } catch (e: unknown) {
      return { ok: false, message: `❌ JSON 解析失败: ${e instanceof Error ? e.message : e}` };
    }
  }

  return { ok: false, message: `😅 未知子命令: ${sub}\n\n${MCP_SUBCMD_HELP}` };
}
