/**
 * Admin CRUD 文件 IO 辅助：路径、JSON 读写、任务列表（从 daemon-http-admin-crud 切出）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type * as http from "node:http";

export type AdminRouteHandler = (method: string, req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean>;

const HOME_DIR = os.homedir();
export const GLOBAL_MCP_PATH = path.join(HOME_DIR, ".cursor", "mcp.json");
export const SKILLS_DIR = path.join(HOME_DIR, ".cursor", "skills");

export interface TaskEntry {
  id: string;
  name: string;
  cron: string;
  content: string;
  enabled: boolean;
  independent?: boolean;
  channelId?: string;
  model?: string;
  modelParams?: string;
}

export function getProjectMcpPath(workspaceDir: string): string {
  return path.join(workspaceDir, ".cursor", "mcp.json");
}

export function getRulesDir(workspaceDir: string): string {
  return path.join(workspaceDir, ".cursor", "rules");
}

export function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch { /* ignore */ }
  return null;
}

export function writeJsonSafe(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function readTasks(tasksFile: string): TaskEntry[] {
  const data = readJsonSafe(tasksFile);
  return Array.isArray(data) ? (data as TaskEntry[]) : [];
}

export function writeTasks(tasksFile: string, tasks: TaskEntry[]): void {
  writeJsonSafe(tasksFile, tasks);
}
