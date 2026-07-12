/**
 * AgentEnginePort 注册表（一期占位，无 adapter 时 fallback 现有 HTTP handler）
 */
import type { AgentEnginePort } from "./run-lifecycle-types.js"

let registry: ReadonlyMap<string, AgentEnginePort> | null = null

/** 创建（或返回已有）引擎 Port 注册表 */
export function createEnginePortRegistry(): ReadonlyMap<string, AgentEnginePort> {
  if (!registry) registry = new Map<string, AgentEnginePort>()
  return registry
}

/** 按资源类型解析 Port；未注册返回 undefined（调用方走 legacy 路径） */
export function getEnginePort(resourceType: string): AgentEnginePort | undefined {
  return createEnginePortRegistry().get(resourceType)
}

/** 注册引擎 adapter（二期 T9～T13 挂接） */
export function registerEnginePort(resourceType: string, port: AgentEnginePort): void {
  createEnginePortRegistry().set(resourceType, port)
}
