/**
 * Admin CRUD / workspace / agent 子路由（从 daemon.ts 抽出）。
 */
import * as fs from "node:fs";
import type * as http from "node:http";
import { randomUUID } from "node:crypto";
import { createAdminContentRoutes } from "./daemon-http-admin-content.js";
import { readTasks, writeTasks, type AdminRouteHandler, type TaskEntry } from "./daemon-http-admin-io.js";

export type { AdminRouteHandler } from "./daemon-http-admin-io.js";

export interface AdminCrudDeps {
  log: (level: string, ...args: unknown[]) => void;
  workspaceDir: string;
  tasksFile: string;
  channels: Map<string, { cfg: { id: string } }>;
  activeSessionMap: Map<string, string>;
  sessionToChatMap: Map<string, string>;
  readBody: (req: http.IncomingMessage) => Promise<string>;
  json: (res: http.ServerResponse, data: unknown, status?: number) => void;
  clearFileQueue: () => number;
  pushCommandToQueue: (command: string, messageId: string, source: string, chatId?: string, chatType?: string) => boolean;
}

export function createAdminCrudRoutes(deps: AdminCrudDeps) {
  const contentRoutes = createAdminContentRoutes({
    workspaceDir: deps.workspaceDir,
    readBody: deps.readBody,
    json: deps.json,
  });

  async function handleTasksAdmin(method: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    if (method === "GET") {
      deps.json(res, { ok: true, tasks: readTasks(deps.tasksFile) });
      return true;
    }
    if (method === "POST") {
      const body = JSON.parse(await deps.readBody(req));
      const { action, id, name, cron, content, enabled, independent, channelId, model, modelParams } = body as {
        action: string; id?: string; name?: string; cron?: string; content?: string; enabled?: boolean; independent?: boolean
        channelId?: string; model?: string; modelParams?: string
      };
      const tasks = readTasks(deps.tasksFile);

      if (action === "add") {
        if (!name || !cron || !content) { deps.json(res, { ok: false, error: "name, cron, content required" }, 400); return true; }
        const newTask: TaskEntry = {
          id: randomUUID(), name: name.trim(), cron: cron.trim(), content,
          enabled: enabled ?? true, independent: independent ?? true,
          channelId: channelId || deps.channels.keys().next().value, model, modelParams,
        };
        tasks.push(newTask);
        writeTasks(deps.tasksFile, tasks);
        deps.json(res, { ok: true, task: newTask });
        return true;
      }
      if (!id) { deps.json(res, { ok: false, error: "id required" }, 400); return true; }
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx === -1) { deps.json(res, { ok: false, error: "task not found" }, 404); return true; }

      if (action === "update") {
        if (name !== undefined) tasks[idx].name = name.trim();
        if (cron !== undefined) tasks[idx].cron = cron.trim();
        if (content !== undefined) tasks[idx].content = content;
        if (enabled !== undefined) tasks[idx].enabled = enabled;
        if (independent !== undefined) tasks[idx].independent = independent;
        if (channelId !== undefined) tasks[idx].channelId = channelId;
        if (model !== undefined) tasks[idx].model = model;
        if (modelParams !== undefined) tasks[idx].modelParams = modelParams;
        writeTasks(deps.tasksFile, tasks);
        deps.json(res, { ok: true, task: tasks[idx] });
        return true;
      }
      if (action === "delete") {
        const removed = tasks.splice(idx, 1)[0];
        writeTasks(deps.tasksFile, tasks);
        deps.json(res, { ok: true, removed });
        return true;
      }
      if (action === "toggle") {
        tasks[idx].enabled = !tasks[idx].enabled;
        writeTasks(deps.tasksFile, tasks);
        deps.json(res, { ok: true, task: tasks[idx] });
        return true;
      }
      deps.json(res, { ok: false, error: "unknown action" }, 400);
      return true;
    }
    return false;
  }

  async function handleWorkspaceAdmin(method: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    if (method === "GET") {
      deps.json(res, { ok: true, workspaceDir: deps.workspaceDir });
      return true;
    }
    if (method === "PUT" || method === "POST") {
      const body = JSON.parse(await deps.readBody(req));
      const { dir } = body as { dir?: string };
      if (!dir?.trim()) { deps.json(res, { ok: false, error: "dir is required" }, 400); return true; }
      const newDir = dir.trim();
      if (!fs.existsSync(newDir)) { deps.json(res, { ok: false, error: "directory does not exist" }, 400); return true; }
      const oldDir = deps.workspaceDir;
      deps.workspaceDir = newDir;
      if (oldDir !== newDir) {
        for (const [chatId, oldSessionKey] of deps.activeSessionMap) {
          if (oldSessionKey.endsWith(`::${oldDir}`)) {
            const newSessionKey = `${chatId}::${newDir}`;
            deps.activeSessionMap.set(chatId, newSessionKey);
            deps.sessionToChatMap.delete(oldSessionKey);
            deps.sessionToChatMap.set(newSessionKey, chatId);
            deps.log("INFO", `[Workspace] 会话路由迁移: ${oldSessionKey} → ${newSessionKey}`);
          }
        }
      }
      deps.log("INFO", `[Workspace] hot-updated: ${oldDir} -> ${newDir}`);
      process.stdout.write(`__WORKSPACE_SWITCH__:${JSON.stringify({ dir: newDir })}\n`);
      deps.json(res, { ok: true, message: `工作目录已切换`, dir: newDir, oldDir });
      return true;
    }
    return false;
  }

  async function handleAgentAdmin(_method: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    if (_method !== "POST") return false;
    const body = JSON.parse(await deps.readBody(req));
    const { action } = body as { action: string };
    const supportedActions = ["stop", "restart", "reset", "clean", "launch"];

    if (action === "launch") {
      const { message, chatId } = body as { message?: string; chatId?: string };
      if (!message?.trim()) { deps.json(res, { ok: false, error: "message is required" }, 400); return true; }
      const taskId = `temp-${Date.now()}`;
      const payload = JSON.stringify({ taskId, taskName: "临时会话", content: message.trim(), chatType: "temp", chatId });
      process.stdout.write(`__IND_LAUNCH__:${payload}\n`);
      deps.json(res, { ok: true, taskId, message: "临时 Agent 已启动" });
      return true;
    }
    if (action === "clean") {
      const cleared = deps.clearFileQueue();
      deps.json(res, { ok: true, cleared });
      return true;
    }
    if (supportedActions.includes(action)) {
      const msgId = `api-${Date.now()}`;
      deps.pushCommandToQueue(`/${action}`, msgId, `mcp-api`);
      deps.json(res, { ok: true, message: `/${action} command queued` });
      return true;
    }
    deps.json(res, { ok: false, error: `unknown action, supported: ${supportedActions.join(", ")}` }, 400);
    return true;
  }

  const adminCrudRoutes: Record<string, AdminRouteHandler> = {
    ...contentRoutes,
    "/api/tasks": handleTasksAdmin,
  };
  const adminEntityRoutes: Record<string, AdminRouteHandler> = {
    "/api/workspace": handleWorkspaceAdmin,
    "/api/agent": handleAgentAdmin,
  };
  return { adminCrudRoutes, adminEntityRoutes };
}
