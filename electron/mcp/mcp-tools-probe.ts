import { spawn } from "node:child_process"
import type { McpToolInfo } from "./mcp-types"

/** Windows shell 参数转义（原 agent-cli 抽出，仅 MCP stdio 探测使用） */
function quoteArg(a: string): string {
  if (process.platform !== "win32") return a
  if (/[\s"&|<>^()!%]/.test(a) || /[^\x20-\x7E]/.test(a)) return `"${a.replace(/"/g, '\\"')}"`
  return a
}

/** 从 JSON Schema 提取工具参数列表 */
function extractParams(schema: unknown): McpToolInfo["params"] {
  const s = schema as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] } | null
  if (!s?.properties) return undefined
  const required = new Set<string>(s.required ?? [])
  return Object.entries(s.properties).map(([k, v]) => ({
    name: k,
    type: v.type,
    description: v.description,
    required: required.has(k),
  }))
}

/** stdio MCP 直连探测；cwd 用于 npx/相对路径/项目根 env 等依赖工作目录的场景 */
export function queryToolsViaProtocol(
  cmd: string,
  args: string[],
  envOverride?: Record<string, string>,
  cwd?: string,
): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }> {
  return new Promise((resolve) => {
    const env: Record<string, string> = { ...process.env as Record<string, string>, ...(envOverride ?? {}) }
    if (!env.PATH && env.Path) env.PATH = env.Path

    let child: ReturnType<typeof spawn>
    try {
      const spawnOpts: Parameters<typeof spawn>[2] = { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: true }
      if (cwd) spawnOpts.cwd = cwd
      child = spawn(quoteArg(cmd), args.map(quoteArg), spawnOpts)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      resolve({ ok: false, tools: [], error: `启动失败: ${msg}` })
      return
    }

    let stdout = ""
    let phase: "init" | "list" | "done" = "init"
    const timeout = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      resolve({ ok: false, tools: [], error: "查询超时" })
    }, 15_000)

    const finish = (result: { ok: boolean; tools: McpToolInfo[]; error?: string }) => {
      if (phase === "done") return
      phase = "done"
      clearTimeout(timeout)
      try { child.kill() } catch { /* ignore */ }
      resolve(result)
    }

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString()
      for (const raw of stdout.split("\n")) {
        const line = raw.trim()
        if (!line) continue
        try {
          const msg = JSON.parse(line) as { id?: number; result?: { tools?: unknown[] } }
          if (msg.id === 1 && msg.result && phase === "init") {
            phase = "list"
            child.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n")
          }
          if (msg.id === 2 && msg.result?.tools) {
            const tools: McpToolInfo[] = (msg.result.tools as { name: string; description?: string; inputSchema?: unknown }[]).map((t) => ({
              name: t.name,
              description: t.description,
              params: extractParams(t.inputSchema),
            }))
            finish({ ok: true, tools })
          }
        } catch { /* 非 JSON 行 */ }
      }
    })

    child.on("error", (err) => finish({ ok: false, tools: [], error: `启动失败: ${err.message}` }))
    child.on("close", () => {
      if (phase === "done") return
      finish({ ok: false, tools: [], error: phase === "list" ? "进程退出，未获取到工具列表" : "进程退出，未获取到工具" })
    })

    child.stdin?.write(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "cursor-claw", version: "1.0.0" } },
    }) + "\n")
  })
}

/** HTTP/SSE MCP 端点直连探测 */
export async function queryToolsViaHttp(
  url: string,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }> {
  const rpc = (id: number, method: string, params: object = {}) => JSON.stringify({ jsonrpc: "2.0", id, method, params })
  const post = (body: string): Promise<unknown> => new Promise((resolve, reject) => {
    const u = new URL(url)
    const mod = u.protocol === "https:" ? require("node:https") : require("node:http")
    const req = mod.request(u, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(headers ?? {}) },
      timeout: 10_000,
    }, (res: { headers: Record<string, string>; on: (ev: string, fn: (chunk: Buffer) => void) => void }) => {
      let data = ""
      res.on("data", (chunk: Buffer) => { data += chunk.toString() })
      res.on("end", () => {
        try {
          if (res.headers["content-type"]?.includes("text/event-stream")) {
            for (const line of data.split("\n")) {
              if (line.startsWith("data:")) {
                const parsed = JSON.parse(line.slice(5).trim()) as { id?: number }
                if (parsed.id !== undefined) { resolve(parsed); return }
              }
            }
          }
          resolve(JSON.parse(data))
        } catch { resolve(null) }
      })
    })
    req.on("error", reject)
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })
    req.write(body)
    req.end()
  })

  try {
    const initRes = await post(rpc(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "cursor-claw", version: "1.0.0" } })) as { result?: unknown }
    if (!initRes?.result) return { ok: false, tools: [], error: "initialize 失败" }
    const listRes = await post(rpc(2, "tools/list")) as { result?: { tools?: { name: string; description?: string; inputSchema?: unknown }[] } }
    if (!listRes?.result?.tools) return { ok: false, tools: [], error: "tools/list 无结果" }
    const tools: McpToolInfo[] = listRes.result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      params: extractParams(t.inputSchema),
    }))
    return { ok: true, tools }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, tools: [], error: msg || "HTTP 请求失败" }
  }
}
