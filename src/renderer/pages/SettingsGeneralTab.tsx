import { FolderOpen } from "lucide-react"

type CloseWindowAction = "ask" | "minimize" | "quit"

interface Props {
  workspaceDir: string
  crashAnalysisDir: string
  autoLaunch: boolean
  closeWindowAction: CloseWindowAction
  onSelectDir: () => void
  onSelectCrashAnalysisDir: () => void
  onClearCrashAnalysisDir: () => void
  onAutoLaunchToggle: () => void
  onCloseWindowAction: (v: CloseWindowAction) => void
}

/** Settings 通用 Tab：工作目录 / 开机自启 / 关闭窗口行为 */
export default function SettingsGeneralTab({
  workspaceDir,
  crashAnalysisDir,
  autoLaunch,
  closeWindowAction,
  onSelectDir,
  onSelectCrashAnalysisDir,
  onClearCrashAnalysisDir,
  onAutoLaunchToggle,
  onCloseWindowAction,
}: Props) {
  return (
    <>
      <section className="space-y-4">
        <div>
          <label className="mb-1 block text-xs text-gray-500">主工作目录</label>
          <div onClick={onSelectDir} className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-700 px-4 py-3 transition hover:border-blue-500">
            <FolderOpen size={18} className="text-blue-400" /><span className="truncate text-sm">{workspaceDir || "点击选择..."}</span>
          </div>
          <p className="mt-1 text-xs text-gray-600">主用户私聊时使用此目录，群聊和其他用户使用自动创建的临时目录</p>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">崩溃分析目录</label>
          <div className="flex items-center gap-2">
            <div onClick={onSelectCrashAnalysisDir} className="flex flex-1 cursor-pointer items-center gap-3 rounded-lg border border-gray-700 px-4 py-3 transition hover:border-blue-500">
              <FolderOpen size={18} className="text-blue-400" /><span className="truncate text-sm">{crashAnalysisDir || "未配置（跳过归档）"}</span>
            </div>
            {crashAnalysisDir && (
              <button type="button" onClick={onClearCrashAnalysisDir} className="shrink-0 rounded-lg border border-gray-700 px-3 py-3 text-xs text-gray-400 transition hover:border-gray-500 hover:text-gray-200">清除</button>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-600">Agent 处理失败时将相关日志片段导出到此目录；留空则跳过归档</p>
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-gray-300">启动</h3>
        <div className="flex items-center justify-between rounded-lg border border-gray-700 px-4 py-3">
          <div className="min-w-0 pr-3">
            <p className="text-sm font-medium">开机自启</p>
            <p className="text-xs text-gray-500">系统登录后自动启动 Cursor Claw；应用启动后自动拉起 Daemon 并连接消息通道</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoLaunch}
            onClick={onAutoLaunchToggle}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${autoLaunch ? "bg-green-500" : "bg-gray-600"}`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${autoLaunch ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
          </button>
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-gray-300">关闭主窗口</h3>
        <p className="text-xs text-gray-600">点击窗口右上角关闭时的行为（可从系统托盘再次打开窗口）。</p>
        <div className="space-y-2">
          {([
            { v: "ask" as const, t: "每次询问", d: "弹窗选择最小化到托盘或退出应用" },
            { v: "minimize" as const, t: "总是最小化到托盘", d: "直接隐藏窗口，不弹窗" },
            { v: "quit" as const, t: "总是退出应用", d: "关闭窗口并退出（含 Daemon、托盘）" },
          ]).map((opt) => (
            <label
              key={opt.v}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition ${closeWindowAction === opt.v ? "border-blue-500 bg-blue-500/10" : "border-gray-700 hover:border-gray-600"}`}
            >
              <input
                type="radio"
                name="closeWindowAction"
                checked={closeWindowAction === opt.v}
                onChange={() => onCloseWindowAction(opt.v)}
                className="mt-1 rounded-full border-gray-600"
              />
              <div>
                <p className="text-sm font-medium">{opt.t}</p>
                <p className="text-xs text-gray-500">{opt.d}</p>
              </div>
            </label>
          ))}
        </div>
      </section>
      <p className="text-xs text-gray-500">关闭窗口相关选项保存后立即生效。其余设置自动保存，部分项需重启 Daemon 后生效。</p>
    </>
  )
}
