import * as path from "node:path"
import { getConfig } from "./config-store"
import type { AgentResource } from "../../src/shared/channel-types"

/** 解析 daemon.log 绝对路径；Profile 自定义为空时沿用工作目录 / userData 默认规则 */
export function resolveDaemonLogPath(
  workspaceDir: string | undefined,
  userDataDir: string,
  resourceDaemonLogPath?: string,
): string {
  const custom = resourceDaemonLogPath?.trim()
  if (custom) return custom
  const ws = workspaceDir?.trim()
  if (ws) return path.join(ws, ".cursor", "daemon.log")
  return path.join(userDataDir, "logs", "daemon.log")
}

/** 首个可运行资源：优先 SDK → Claude Code → Codex → OpenCode */
function findFirstRunnableResource(resources: AgentResource[]): AgentResource | undefined {
  return (
    resources.find((r) => r.type === "sdk")
    ?? resources.find((r) => r.type === "claude-code")
    ?? resources.find((r) => r.type === "codex")
    ?? resources.find((r) => r.type === "opencode")
  )
}

/** 当前 Daemon 日志 Profile：首个启用通道绑定资源，否则首个可运行资源 */
function resolveActiveDaemonResource(): AgentResource | undefined {
  const cfg = getConfig()
  const resources = cfg.agentResources ?? []
  const enabled = (cfg.channels ?? []).filter((c) => c.enabled)
  const boundId = enabled[0]?.agentResourceId
  if (boundId) {
    const bound = resources.find((r) => r.id === boundId)
    if (bound) return bound
  }
  return findFirstRunnableResource(resources)
}

/** 按当前通道绑定解析 Daemon / UI 共用日志路径 */
export function resolveActiveDaemonLogPath(userDataDir: string): string {
  const cfg = getConfig()
  const resource = resolveActiveDaemonResource()
  return resolveDaemonLogPath(cfg.workspaceDir, userDataDir, resource?.daemonLogPath)
}
