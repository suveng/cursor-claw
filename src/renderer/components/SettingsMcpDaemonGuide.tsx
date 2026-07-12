import { useState, useEffect, useCallback } from "react"
import { Copy, Check } from "lucide-react"

/** 与 config-store 默认 daemonPort 对齐 */
const DEFAULT_DAEMON_PORT = 19528

/** 与 workspace-injector.buildMcpServers 一致的 Cursor MCP 片段（仅 cursor-claw，不含 admin） */
function buildCursorMcpSnippet(port: number): string {
  return JSON.stringify(
    {
      mcpServers: {
        "cursor-claw": { url: `http://127.0.0.1:${port}/mcp` },
      },
    },
    null,
    2,
  )
}

/** Settings MCP Tab 顶部：Daemon MCP 手动配置可复制指引（T4） */
export default function SettingsMcpDaemonGuide() {
  const [port, setPort] = useState(DEFAULT_DAEMON_PORT)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.electronAPI.getConfig().then((cfg) => {
      if (cfg.daemonPort) setPort(cfg.daemonPort)
    })
  }, [])

  const snippet = buildCursorMcpSnippet(port)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板不可用时静默失败，用户可手动选中复制
    }
  }, [snippet])

  return (
    <section className="mb-6 space-y-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3">
      <div>
        <h3 className="text-sm font-medium text-blue-200/90">Cursor MCP 手动配置</h3>
        <p className="mt-1 text-xs leading-relaxed text-blue-200/60">
          产品不再自动写入 mcp.json。请将下方片段合并到 Cursor 用户级或项目级 mcp.json，
          使 Cursor IDE 可连接本应用 Daemon（默认端口 {port}，Daemon 未运行时亦可先复制保存）。
        </p>
      </div>

      <pre className="max-h-32 overflow-auto rounded bg-gray-900/80 p-2.5 font-mono text-[10px] text-gray-400">
        {snippet}
      </pre>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1.5 rounded bg-blue-600/80 px-2.5 py-1 text-xs text-white hover:bg-blue-500"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "已复制" : "复制片段"}
        </button>
        <p className="text-[10px] text-gray-600">
          MCP 开关与健康探测请经 IM <span className="font-mono">/mcp</span> 或
          <span className="font-mono"> POST /api/mcp</span> 管理（不含已废弃的 /mcp-admin）。
        </p>
      </div>
    </section>
  )
}
