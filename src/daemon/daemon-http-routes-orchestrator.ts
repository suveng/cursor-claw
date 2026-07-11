/**
 * `/api/*` orchestrator 与 merge 路由簇（从 daemon-http-routes 切出）。
 */
import type * as http from "node:http";
import type { AgentPhase } from "./daemon-orchestrator.js";
import type { HttpRoutesDeps } from "./daemon-http-routes-types.js";

/** session-agent-phase / merge-batch / claim-and-merge / agent launch|dispatch / poll-message */
export async function tryHandleOrchestratorRoute(
  deps: HttpRoutesDeps,
  pathname: string,
  method: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  if (method === "POST" && pathname === "/api/session-agent-phase") {
    try {
      const body = JSON.parse(await deps.readBody(req));
      const { session_key, phase } = body as { session_key?: string; phase?: AgentPhase };
      if (!session_key?.trim()) {
        deps.json(res, { ok: false, error: "session_key is required" }, 400);
        return true;
      }
      if (phase !== "starting" && phase !== "processing" && phase !== "idle") {
        deps.json(res, { ok: false, error: "invalid phase" }, 400);
        return true;
      }
      if (phase === "idle") {
        deps.setSessionAgentPhase(session_key, "idle");
        const batch = deps.mergeBatchBySession.get(session_key);
        if (batch && !deps.isTerminalMergePhase(batch.phase)) {
          deps.renderMergeBatchCardForSession(batch).catch((e: unknown) => {
            deps.log("WARN", `idle 后合并卡刷新失败: ${e instanceof Error ? e.message : e}`);
          });
        }
        void deps.flushReadyMergeBatches(session_key);
        deps.scheduleAgentDispatch(session_key);
      } else {
        deps.setSessionAgentPhase(session_key, phase);
        const batch = deps.mergeBatchBySession.get(session_key);
        if (batch?.phase === "ready" && !deps.isTerminalMergePhase(batch.phase)) {
          deps.renderMergeBatchCardForSession(batch).catch((e: unknown) => {
            deps.log("WARN", `phase 变更后合并卡刷新失败: ${e instanceof Error ? e.message : e}`);
          });
        }
      }
      deps.json(res, { ok: true });
    } catch (e: unknown) {
      deps.json(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
    }
    return true;
  }

  if (method === "POST" && pathname === "/api/merge-batch/action") {
    try {
      const body = JSON.parse(await deps.readBody(req)) as { session_key?: string; action?: string; text?: string };
      const sessionKey = body.session_key?.trim();
      const action = body.action?.trim();
      if (!sessionKey) {
        deps.json(res, { ok: false, error: "session_key is required" }, 400);
        return true;
      }
      if (!action) {
        deps.json(res, { ok: false, error: "action is required" }, 400);
        return true;
      }
      const result = await deps.handleMergeBatchAction(sessionKey, action, body.text);
      deps.json(res, result, result.ok ? 200 : 400);
    } catch (e: unknown) {
      deps.json(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
    }
    return true;
  }

  if (method === "POST" && pathname === "/api/orchestrator/claim-and-merge") {
    try {
      const body = JSON.parse(await deps.readBody(req)) as { session_key?: string };
      const sessionKey = body.session_key?.trim();
      if (!sessionKey) {
        deps.json(res, { ok: false, error: "session_key is required" }, 400);
        return true;
      }
      const result = deps.performClaimAndMerge(sessionKey);
      if (!result.ok) {
        deps.json(res, { ok: false, error: result.error }, 400);
        return true;
      }
      deps.json(res, { text: result.text, message_ids: result.message_ids });
    } catch (e: unknown) {
      deps.json(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
    }
    return true;
  }

  if (method === "POST" && pathname === "/api/agent/launch") {
    try {
      const body = JSON.parse(await deps.readBody(req)) as Record<string, unknown>;
      const result = await deps.forwardElectronAgentApi("/api/agent/launch", body);
      deps.json(res, result, result.ok ? 200 : 400);
    } catch (e: unknown) {
      deps.json(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
    }
    return true;
  }

  if (method === "POST" && pathname === "/api/agent/dispatch") {
    try {
      const body = JSON.parse(await deps.readBody(req)) as {
        session_key?: string; task_text?: string; message_ids?: string[];
      };
      const session_key = body.session_key?.trim();
      const task_text = body.task_text ?? "";
      if (!session_key) {
        deps.json(res, { ok: false, error: "session_key is required" }, 400);
        return true;
      }
      const result = await deps.forwardElectronAgentApi("/api/agent/dispatch", {
        session_key,
        task_text,
        ...(Array.isArray(body.message_ids) && body.message_ids.length > 0 && { message_ids: body.message_ids }),
      });
      if (!result.ok) {
        deps.log("WARN", `dispatch_failed: session=${session_key} error=${result.error ?? "unknown"}`);
        const busyDelay = deps.parseBusyRetryDelayMs(result.error);
        if (busyDelay > 0) deps.scheduleBusyRetry(session_key, busyDelay);
      }
      deps.json(res, result, result.ok ? 200 : 400);
    } catch (e: unknown) {
      deps.json(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
    }
    return true;
  }

  if (method === "GET" && pathname === "/api/poll-message") {
    deps.json(res, { error: "not found" }, 404);
    return true;
  }

  return false;
}
