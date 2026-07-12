import { useState } from "react"
import { FolderOpen, ChevronDown, ChevronRight } from "lucide-react"

interface Props {
  draft: ChannelConfig
  set: (p: Partial<ChannelConfig>) => void
}

/** 通道编辑弹窗 — 其他人使用与高级设置 */
export default function ChannelEditAccess({ draft, set }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  const selectOthersWorkDir = async () => {
    const d = await window.electronAPI.selectDirectory()
    if (d) set({ othersWorkspaceDir: d })
  }

  const selectWorkDir = async () => {
    const d = await window.electronAPI.selectDirectory()
    if (d) set({ workspaceDir: d })
  }

  return (
    <>
          {/* ── 其他人使用 ── */}
          <div className="space-y-3 rounded-lg border border-gray-800 p-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-medium text-gray-400">允许其他人使用</h4>
                <p className="text-xs text-gray-600">
                  {draft.allowOthers
                    ? draft.othersWorkspaceMode === "specified"
                      ? "开启后该通道响应其他人私聊及群聊 @消息（使用下方指定目录；留空则与主会话目录一致）"
                      : "开启后该通道响应其他人私聊及群聊 @消息（每个私聊/群聊在独立临时目录中运行）"
                    : "开启后该通道响应其他人私聊及群聊 @消息"}
                </p>
              </div>
              <button onClick={() => set({ allowOthers: !draft.allowOthers })}
                className={`relative h-5 w-9 shrink-0 rounded-full transition ${draft.allowOthers ? "bg-blue-600" : "bg-gray-600"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${draft.allowOthers ? "left-[18px]" : "left-0.5"}`} />
              </button>
            </div>
            {draft.allowOthers && (
              <>
                <div>
                  <label className="mb-1.5 block text-xs text-gray-500">工作目录模式</label>
                  <div className="flex gap-2">
                    <button type="button"
                      onClick={() => set({ othersWorkspaceMode: "isolated", othersWorkspaceDir: "" })}
                      className={`flex-1 rounded-lg border px-2 py-1.5 text-xs transition ${draft.othersWorkspaceMode !== "specified" ? "border-blue-500 bg-blue-900/30 text-blue-300" : "border-gray-700 text-gray-400 hover:border-gray-600"}`}>
                      临时目录
                    </button>
                    <button type="button"
                      onClick={() => set({ othersWorkspaceMode: "specified" })}
                      className={`flex-1 rounded-lg border px-2 py-1.5 text-xs transition ${draft.othersWorkspaceMode === "specified" ? "border-blue-500 bg-blue-900/30 text-blue-300" : "border-gray-700 text-gray-400 hover:border-gray-600"}`}>
                      指定目录
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-600">
                    {draft.othersWorkspaceMode === "specified"
                      ? "使用下方路径；留空则与主会话目录一致（通道工作目录或全局默认）"
                      : "按会话隔离，每个私聊/群聊使用独立临时目录"}
                  </p>
                </div>
                {draft.othersWorkspaceMode === "specified" && (
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">指定目录路径</label>
                    <div className="flex items-center gap-2">
                      <div onClick={() => void selectOthersWorkDir()} className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 transition hover:border-blue-500">
                        <FolderOpen size={14} className="text-blue-400" />
                        <span className="truncate text-xs">{draft.othersWorkspaceDir || "（与主会话目录一致）"}</span>
                      </div>
                      {draft.othersWorkspaceDir && <button onClick={() => set({ othersWorkspaceDir: "" })} className="text-xs text-gray-500 hover:text-red-400">清除</button>}
                    </div>
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs text-gray-500">对外身份规则</label>
                  <textarea value={draft.digitalIdentity} onChange={(e) => set({ digitalIdentity: e.target.value })} rows={5} placeholder="定义 Agent 面向该通道其他用户时的角色、职责与行为规范...&#10;留空则不注入" className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none" />
                  <p className="mt-1 text-xs text-gray-600">该通道其他人触发的会话启动时，将此内容作为 Agent 身份规则注入</p>
                </div>
              </>
            )}
          </div>

          {/* ── 高级设置 ── */}
          <div className="rounded-lg border border-gray-800">
            <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-gray-400 hover:text-gray-200">
              <span>高级设置</span>
              {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            {showAdvanced && (
              <div className="space-y-3 border-t border-gray-800 px-3 py-3">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">通道工作目录 <span className="text-gray-600">— 留空使用全局主工作目录</span></label>
                  <div className="flex items-center gap-2">
                    <div onClick={() => void selectWorkDir()} className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 transition hover:border-blue-500">
                      <FolderOpen size={14} className="text-blue-400" />
                      <span className="truncate text-xs">{draft.workspaceDir || "（全局默认）"}</span>
                    </div>
                    {draft.workspaceDir && <button onClick={() => set({ workspaceDir: "" })} className="text-xs text-gray-500 hover:text-red-400">清除</button>}
                  </div>
                  <p className="mt-1 text-xs text-gray-600">主用户私聊、临时会话默认目录及他人「指定目录」留空时的回退来源</p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-400">主用户每次新会话</p>
                    <p className="text-xs text-gray-600">开启后每次拉起 Agent 都创建新会话，不延续上下文</p>
                  </div>
                  <button onClick={() => set({ mainUserNewSession: !draft.mainUserNewSession })}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition ${draft.mainUserNewSession ? "bg-green-500" : "bg-gray-600"}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${draft.mainUserNewSession ? "left-[18px]" : "left-0.5"}`} />
                  </button>
                </div>
              </div>
            )}
          </div>

    </>
  )
}
