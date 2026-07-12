import { memo, useEffect, useRef } from "react"

const LOG_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[(\w+)\] (\w+) (.*)$/

/** 与主进程 escapeLogContentSingleLine 对应：展示时把 ⏎ 标记还原为换行 */
function displayLogMessageBody(msg: string): string {
  return msg.replace(/⏎/g, "\n")
}

const LEVEL_COLORS: Record<string, string> = {
  ERROR: "text-red-400",
  WARN: "text-yellow-400",
  INFO: "text-blue-400",
  DEBUG: "text-gray-500",
}

const PROCESS_COLORS: Record<string, string> = {
  Daemon: "text-purple-400",
  Agent: "text-cyan-400",
  Electron: "text-orange-400",
  Scheduler: "text-teal-400",
}

const LogLine = memo(function LogLine({ line }: { line: string }) {
  const m = LOG_RE.exec(line)
  if (!m) {
    return <div className="whitespace-pre-wrap break-all text-gray-400">{displayLogMessageBody(line)}</div>
  }
  const [, ts, proc, level, msg] = m
  const body = displayLogMessageBody(msg)
  return (
    <div className="whitespace-pre-wrap break-all">
      <span className="text-gray-600">{ts}</span>
      {" "}
      <span className={PROCESS_COLORS[proc] ?? "text-gray-400"}>[{proc}]</span>
      {" "}
      <span className={LEVEL_COLORS[level] ?? "text-gray-400"}>{level}</span>
      {" "}
      <span className={level === "ERROR" ? "text-red-300" : level === "WARN" ? "text-yellow-300" : "text-gray-300"}>{body}</span>
    </div>
  )
})

interface Props {
  logLines: string[]
  onCopy: () => void
  onClear: () => void
}

/** Dashboard 日志面板：解析着色与复制/清空 */
export default function DashboardLogPanel({ logLines, onCopy, onClear }: Props) {
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logLines])

  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
          <span>日志</span>
        </div>
        <div className="flex items-center gap-1">
          {logLines.length > 0 && (
            <button onClick={onCopy} className="rounded px-2 py-0.5 text-xs text-gray-500 transition hover:bg-gray-800 hover:text-gray-300">
              复制
            </button>
          )}
          {logLines.length > 0 && (
            <button onClick={onClear} className="rounded px-2 py-0.5 text-xs text-gray-500 transition hover:bg-gray-800 hover:text-gray-300">
              清空
            </button>
          )}
        </div>
      </div>
      <div
        ref={logRef}
        className="flex-1 overflow-auto rounded-lg border border-gray-800 bg-gray-900/50 p-3 font-mono text-xs leading-5"
      >
        {logLines.length > 0 ? logLines.map((line, i) => <LogLine key={i} line={line} />) : <span className="text-gray-600">暂无日志</span>}
      </div>
    </div>
  )
}
