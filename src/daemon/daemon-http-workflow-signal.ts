/**
 * POST /api/workflow-signal — 工作流外部信号（仅 action=resume）。
 */
import type * as http from "node:http";
import { resumeWorkflowAndEmit } from "../workflow/server-workflow.js";
import type { HttpRoutesDeps } from "./daemon-http-routes-types.js";

/** workflow_resume 结构化日志（HTTP 入口，写 stderr 便于 grep，不污染 stdout 信号行） */
function logWorkflowResumeHttp(instanceId: string, ok: boolean): void {
  process.stderr.write(
    `workflow_resume ${JSON.stringify({ instance_id: instanceId, source: "http", ok })}\n`,
  );
}

/** 将引擎错误文案映射为 HTTP 状态码 */
function mapResumeErrorStatus(error: string): number {
  if (error === "实例不存在") return 404;
  if (error === "工作流非暂停状态") return 409;
  return 400;
}

/** 处理 POST /api/workflow-signal */
export async function tryHandleWorkflowSignalRoute(
  deps: HttpRoutesDeps,
  pathname: string,
  method: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  if (pathname !== "/api/workflow-signal" || method !== "POST") return false;

  try {
    const body = JSON.parse(await deps.readBody(req)) as {
      action?: string;
      instanceId?: string;
    };

    if (body.action !== "resume") {
      deps.json(res, { ok: false, error: "invalid action" }, 400);
      return true;
    }

    const instanceId = typeof body.instanceId === "string" ? body.instanceId.trim() : "";
    if (!instanceId) {
      deps.json(res, { ok: false, error: "instanceId required" }, 400);
      return true;
    }

    // 与 MCP run 一致：emit stdout 信号后即返回 200，不等待 Electron 消费
    const result = resumeWorkflowAndEmit(instanceId);
    logWorkflowResumeHttp(instanceId, result.ok);

    if (!result.ok) {
      const status = mapResumeErrorStatus(result.error ?? "");
      deps.json(res, { ok: false, error: result.error }, status);
      return true;
    }

    deps.json(res, {
      ok: true,
      message: result.message,
      instanceId: result.instanceId,
    });
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    deps.log("WARN", `workflow-signal 请求解析失败: ${msg}`);
    deps.json(res, { ok: false, error: msg }, 400);
    return true;
  }
}
