/**
 * Admin 内容类 CRUD：MCP / rules / skills 子路由（从 daemon-http-admin-crud 切出）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type * as http from "node:http";
import type { AdminRouteHandler } from "./daemon-http-admin-io.js";
import {
  GLOBAL_MCP_PATH,
  SKILLS_DIR,
  getProjectMcpPath,
  getRulesDir,
  readJsonSafe,
  writeJsonSafe,
} from "./daemon-http-admin-io.js";

export interface AdminContentDeps {
  workspaceDir: string;
  readBody: (req: http.IncomingMessage) => Promise<string>;
  json: (res: http.ServerResponse, data: unknown, status?: number) => void;
}

/** MCP / rules / skills 三条 admin 路由 */
export function createAdminContentRoutes(deps: AdminContentDeps): Record<string, AdminRouteHandler> {
  async function handleMcpAdmin(method: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    if (method === "GET") {
      const globalCfg = readJsonSafe(GLOBAL_MCP_PATH);
      const projectCfg = readJsonSafe(getProjectMcpPath(deps.workspaceDir));
      const servers: Record<string, { config: unknown; scope: string }> = {};
      const globalServers = globalCfg?.mcpServers as Record<string, unknown> | undefined;
      const projectServers = projectCfg?.mcpServers as Record<string, unknown> | undefined;
      if (globalServers) {
        for (const [k, v] of Object.entries(globalServers)) servers[k] = { config: v, scope: "global" };
      }
      if (projectServers) {
        for (const [k, v] of Object.entries(projectServers)) servers[k] = { config: v, scope: "project" };
      }
      deps.json(res, { ok: true, servers });
      return true;
    }
    if (method === "POST") {
      const body = JSON.parse(await deps.readBody(req));
      const { action, name, config, scope } = body as { action: string; name?: string; config?: string; scope?: string };
      const targetPath = (scope ?? "global") === "project" ? getProjectMcpPath(deps.workspaceDir) : GLOBAL_MCP_PATH;

      if (action === "add") {
        if (!name || !config) { deps.json(res, { ok: false, error: "name and config required" }, 400); return true; }
        let parsed: unknown;
        try { parsed = JSON.parse(config); } catch { deps.json(res, { ok: false, error: "invalid config JSON" }, 400); return true; }
        const mcpJson = readJsonSafe(targetPath) ?? {};
        const mcpServers = (mcpJson.mcpServers ?? {}) as Record<string, unknown>;
        mcpServers[name] = parsed;
        mcpJson.mcpServers = mcpServers;
        writeJsonSafe(targetPath, mcpJson);
        deps.json(res, { ok: true, message: `${name} saved` });
        return true;
      }
      if (action === "delete") {
        if (!name) { deps.json(res, { ok: false, error: "name required" }, 400); return true; }
        for (const p of [GLOBAL_MCP_PATH, getProjectMcpPath(deps.workspaceDir)]) {
          const mcpJson = readJsonSafe(p);
          const mcpServers = mcpJson?.mcpServers as Record<string, unknown> | undefined;
          if (mcpServers?.[name]) {
            delete mcpServers[name];
            writeJsonSafe(p, mcpJson);
            deps.json(res, { ok: true, message: `${name} deleted` });
            return true;
          }
        }
        deps.json(res, { ok: false, error: "not found" }, 404);
        return true;
      }
      deps.json(res, { ok: false, error: "unknown action" }, 400);
      return true;
    }
    return false;
  }

  async function handleRulesAdmin(method: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    if (method === "GET") {
      if (!fs.existsSync(getRulesDir(deps.workspaceDir))) { deps.json(res, { ok: true, rules: [] }); return true; }
      const files = fs.readdirSync(getRulesDir(deps.workspaceDir)).filter((f) => f.endsWith(".mdc") || f.endsWith(".md"));
      deps.json(res, { ok: true, rules: files });
      return true;
    }
    if (method === "POST") {
      const body = JSON.parse(await deps.readBody(req));
      const { action, name, content } = body as { action: string; name?: string; content?: string };

      if (action === "read") {
        if (!name) { deps.json(res, { ok: false, error: "name required" }, 400); return true; }
        const fp = path.join(getRulesDir(deps.workspaceDir), name);
        if (!fs.existsSync(fp)) { deps.json(res, { ok: false, error: "not found" }, 404); return true; }
        deps.json(res, { ok: true, content: fs.readFileSync(fp, "utf-8") });
        return true;
      }
      if (action === "save") {
        if (!name || content === undefined) { deps.json(res, { ok: false, error: "name and content required" }, 400); return true; }
        let fileName = name.trim();
        if (!fileName.endsWith(".mdc") && !fileName.endsWith(".md")) fileName += ".mdc";
        if (!fs.existsSync(getRulesDir(deps.workspaceDir))) fs.mkdirSync(getRulesDir(deps.workspaceDir), { recursive: true });
        fs.writeFileSync(path.join(getRulesDir(deps.workspaceDir), fileName), content, "utf-8");
        deps.json(res, { ok: true, message: `${fileName} saved` });
        return true;
      }
      if (action === "delete") {
        if (!name) { deps.json(res, { ok: false, error: "name required" }, 400); return true; }
        const fp = path.join(getRulesDir(deps.workspaceDir), name);
        if (!fs.existsSync(fp)) { deps.json(res, { ok: false, error: "not found" }, 404); return true; }
        fs.unlinkSync(fp);
        deps.json(res, { ok: true, message: `${name} deleted` });
        return true;
      }
      deps.json(res, { ok: false, error: "unknown action" }, 400);
      return true;
    }
    return false;
  }

  async function handleSkillsAdmin(method: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    if (method === "GET") {
      if (!fs.existsSync(SKILLS_DIR)) { deps.json(res, { ok: true, skills: [] }); return true; }
      const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
      const skills = dirs.map((d) => {
        const skillFile = path.join(SKILLS_DIR, d.name, "SKILL.md");
        const preview = fs.existsSync(skillFile) ? fs.readFileSync(skillFile, "utf-8").split("\n")[0].slice(0, 80) : "";
        return { name: d.name, preview };
      });
      deps.json(res, { ok: true, skills });
      return true;
    }
    if (method === "POST") {
      const body = JSON.parse(await deps.readBody(req));
      const { action, name, content } = body as { action: string; name?: string; content?: string };

      if (action === "read") {
        if (!name) { deps.json(res, { ok: false, error: "name required" }, 400); return true; }
        const fp = path.join(SKILLS_DIR, name, "SKILL.md");
        if (!fs.existsSync(fp)) { deps.json(res, { ok: false, error: "not found" }, 404); return true; }
        deps.json(res, { ok: true, content: fs.readFileSync(fp, "utf-8") });
        return true;
      }
      if (action === "save") {
        if (!name || content === undefined) { deps.json(res, { ok: false, error: "name and content required" }, 400); return true; }
        const dir = path.join(SKILLS_DIR, name.trim());
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "SKILL.md"), content, "utf-8");
        deps.json(res, { ok: true, message: `${name} saved` });
        return true;
      }
      if (action === "delete") {
        if (!name) { deps.json(res, { ok: false, error: "name required" }, 400); return true; }
        const dir = path.join(SKILLS_DIR, name);
        if (!fs.existsSync(dir)) { deps.json(res, { ok: false, error: "not found" }, 404); return true; }
        fs.rmSync(dir, { recursive: true, force: true });
        deps.json(res, { ok: true, message: `${name} deleted` });
        return true;
      }
      deps.json(res, { ok: false, error: "unknown action" }, 400);
      return true;
    }
    return false;
  }

  return {
    "/api/mcp": handleMcpAdmin,
    "/api/rules": handleRulesAdmin,
    "/api/skills": handleSkillsAdmin,
  };
}
