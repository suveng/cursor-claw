import { FolderOpen } from "lucide-react"

const inputCls = "w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none transition focus:border-blue-500"

/** Profile 编辑弹窗：daemon.log 路径（留空走默认规则） */
export function ProfileDaemonLogField(props: {
  value: string
  onChange: (path: string) => void
}) {
  const { value, onChange } = props

  const selectPath = async () => {
    const dir = await window.electronAPI.selectDirectory()
    if (dir) onChange(`${dir.replace(/[/\\]$/, "")}/daemon.log`)
  }

  return (
    <div>
      <label className="mb-1 block text-xs text-gray-500">Daemon 日志文件（选填）</label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void selectPath()}
          className="flex flex-1 items-center gap-3 rounded-lg border border-gray-700 px-3 py-2 text-left text-sm transition hover:border-blue-500"
        >
          <FolderOpen size={16} className="shrink-0 text-blue-400" />
          <span className="truncate">{value || "未配置（使用默认路径）"}</span>
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="shrink-0 rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-400 transition hover:border-gray-500 hover:text-gray-200"
          >
            清除
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-600">本 Profile 独立配置；留空时写入工作目录 .cursor/daemon.log 或 userData/logs/daemon.log</p>
    </div>
  )
}
