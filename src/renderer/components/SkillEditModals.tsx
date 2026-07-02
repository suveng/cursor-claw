import { X } from "lucide-react"

/** 技能文件元数据（与 IPC list 返回一致） */
interface SkillFile {
  name: string
  content: string
}

/** 弹窗共用输入框样式 */
const INPUT_CLS =
  "w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none transition focus:border-blue-500"

interface Props {
  skillEditing: SkillFile | null
  skillEditOriginalName: string | null
  skillFileEditing: { skillName: string; relativePath: string; content: string } | null
  skillPrompt: { skillName: string; parentPath: string; kind: "file" | "folder"; value: string } | null
  skillDeleteConfirm: { skillName: string; relativePath: string } | null
  onCloseSkillEdit: () => void
  onSkillEditChange: (next: SkillFile) => void
  onSkillSave: () => void
  onCloseSkillFileEdit: () => void
  onSkillFileEditChange: (content: string) => void
  onSkillFileSave: () => void
  onCloseSkillPrompt: () => void
  onSkillPromptChange: (value: string) => void
  onSkillPromptConfirm: () => void
  onCloseSkillDeleteConfirm: () => void
  onSkillDeleteConfirm: () => void
}

/** Skills 编辑/新建/删除确认弹窗（自 Settings 迁入，供双 scope 面板复用） */
export default function SkillEditModals({
  skillEditing,
  skillEditOriginalName,
  skillFileEditing,
  skillPrompt,
  skillDeleteConfirm,
  onCloseSkillEdit,
  onSkillEditChange,
  onSkillSave,
  onCloseSkillFileEdit,
  onSkillFileEditChange,
  onSkillFileSave,
  onCloseSkillPrompt,
  onSkillPromptChange,
  onSkillPromptConfirm,
  onCloseSkillDeleteConfirm,
  onSkillDeleteConfirm,
}: Props) {
  return (
    <>
      {skillEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex w-full max-w-lg flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl" style={{ maxHeight: "80vh" }}>
            <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
              <h3 className="text-sm font-semibold text-gray-200">{skillEditOriginalName ? "编辑 Skill" : "新增 Skill"}</h3>
              <button onClick={onCloseSkillEdit} className="text-gray-500 hover:text-white"><X size={16} /></button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
              <div>
                <label className="mb-1 block text-xs text-gray-500">名称（文件夹名）</label>
                <input
                  type="text"
                  value={skillEditing.name}
                  onChange={(e) => onSkillEditChange({ ...skillEditing, name: e.target.value })}
                  className={INPUT_CLS}
                  placeholder="my-skill"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">SKILL.md 内容</label>
                <textarea
                  value={skillEditing.content}
                  onChange={(e) => onSkillEditChange({ ...skillEditing, content: e.target.value })}
                  rows={16}
                  className={INPUT_CLS + " font-mono text-xs leading-relaxed"}
                  placeholder="# My Skill\n\nDescription of what this skill does..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-800 px-6 py-4">
              <button onClick={onCloseSkillEdit} className="rounded-md px-4 py-1.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white">取消</button>
              <button onClick={onSkillSave} disabled={!skillEditing.name.trim()} className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40">保存</button>
            </div>
          </div>
        </div>
      )}

      {skillFileEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex w-full max-w-2xl flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl" style={{ maxHeight: "85vh" }}>
            <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-gray-200">编辑文件</h3>
                <p className="truncate text-xs text-gray-500 mt-0.5">{skillFileEditing.skillName}/{skillFileEditing.relativePath}</p>
              </div>
              <button onClick={onCloseSkillFileEdit} className="text-gray-500 hover:text-white"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <textarea
                value={skillFileEditing.content}
                onChange={(e) => onSkillFileEditChange(e.target.value)}
                rows={24}
                spellCheck={false}
                className={INPUT_CLS + " font-mono text-xs leading-relaxed"}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-800 px-6 py-4">
              <button onClick={onCloseSkillFileEdit} className="rounded-md px-4 py-1.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white">取消</button>
              <button onClick={onSkillFileSave} className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500">保存</button>
            </div>
          </div>
        </div>
      )}

      {skillPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-xs rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
            <div className="border-b border-gray-800 px-5 py-3">
              <h3 className="text-sm font-semibold text-gray-200">新建{skillPrompt.kind === "file" ? "文件" : "文件夹"}</h3>
            </div>
            <div className="px-5 py-4">
              <input
                autoFocus
                type="text"
                value={skillPrompt.value}
                onChange={(e) => onSkillPromptChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void onSkillPromptConfirm() }}
                placeholder={skillPrompt.kind === "file" ? "例如 utils.py" : "例如 scripts"}
                className={INPUT_CLS}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-800 px-5 py-3">
              <button onClick={onCloseSkillPrompt} className="rounded-md px-3 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-white">取消</button>
              <button onClick={() => void onSkillPromptConfirm()} disabled={!skillPrompt.value.trim()} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40">确定</button>
            </div>
          </div>
        </div>
      )}

      {skillDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-xs rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
            <div className="px-5 py-4">
              <p className="text-sm text-gray-300">确定删除 <code className="text-red-300">{skillDeleteConfirm.relativePath}</code> ？</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-800 px-5 py-3">
              <button onClick={onCloseSkillDeleteConfirm} className="rounded-md px-3 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-white">取消</button>
              <button onClick={() => void onSkillDeleteConfirm()} className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500">删除</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
