/**
 * `/api/*` 路由表（从 daemon.ts 抽出）。
 */
import type * as http from "node:http";
import { tryHandleOrchestratorRoute } from "./daemon-http-routes-orchestrator.js";
import { tryHandleSendRoute } from "./daemon-http-routes-send.js";
import { tryHandleSessionRoute } from "./daemon-http-routes-session.js";
import { tryHandleMiscApiRoute } from "./daemon-http-routes-misc.js";
import { tryHandleWorkflowSignalRoute } from "./daemon-http-workflow-signal.js";

export type { HttpRoutesDeps } from "./daemon-http-routes-types.js";

import type { HttpRoutesDeps } from "./daemon-http-routes-types.js";

export function createAdminApiHandler(deps: HttpRoutesDeps) {
  async function handleAdminApi(pathname: string, method: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    if (!pathname.startsWith("/api/")) return false;

    if (method === "GET" && pathname === "/api/status") {
      const tasks = deps.readTasks();
      const recentlyActive = deps.lastMcpRequestTime > 0 && (Date.now() - deps.lastMcpRequestTime) < 120_000;
      const channelList = deps.getChannelStatusList();
      deps.json(res, {
        daemon: {
          running: true, version: deps.pkgVersion, uptime: Math.floor(process.uptime()), port: deps.daemonPort,
          agentRunning: deps.activeMcpConnections > 0 || recentlyActive,
          sessionAgentCount: deps.activeMcpConnections,
        },
        queue: { length: deps.getFileQueueLength() },
        tasks: { total: tasks.length, enabled: tasks.filter((t) => t.enabled).length },
        channels: channelList,
        feishu: { connected: channelList.some((c) => c.type === "feishu" && c.connected), hasChatId: channelList.some((c) => c.type === "feishu" && c.mainUserBound) },
        wechat: { enabled: channelList.some((c) => c.type === "wechat"), status: channelList.some((c) => c.type === "wechat" && c.status === "connected") ? "connected" : "disconnected" },
      });
      return true;
    }

    const crudHandler = deps.adminCrudRoutes[pathname];
    if (crudHandler) return crudHandler(method, req, res);

    if (await tryHandleWorkflowSignalRoute(deps, pathname, method, req, res)) return true;
    if (await tryHandleOrchestratorRoute(deps, pathname, method, req, res)) return true;
    if (await tryHandleSendRoute(deps, pathname, method, req, res)) return true;
    if (await tryHandleSessionRoute(deps, pathname, method, req, res)) return true;
    if (await tryHandleMiscApiRoute(deps, pathname, method, req, res)) return true;

    const entityHandler = deps.adminEntityRoutes[pathname];
    if (entityHandler) return entityHandler(method, req, res);

    return false;
  }

  return handleAdminApi;
}
