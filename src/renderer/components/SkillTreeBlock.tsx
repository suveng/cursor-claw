import type { ReactNode } from "react"
import {
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FilePlus,
  FolderPlus,
  Sparkles,
} from "lucide-react"

interface SkillFile {
  name: string
  content: string
}

/** expand 状态 key：scope/skillName 或 scope/skillName/relativePath */
export function expandKey(scope: SkillScope, ...parts: string[]): string {
  return [scope, ...parts].join("/")
}

interface Props {
  scope: SkillScope
  title: string
  hint: string
  skills: SkillFile[]
  skillTree: SkillTreeNode[]
  skillExpanded: Set<string>
  saveHint: string | null
  disabled: boolean
  onRefresh: () => void
  onToggleExpand: (key: string) => void
  onOpenAdd: () => void
  onOpenEdit: (s: SkillFile) => void
  onDeleteSkill: (name: string) => void
  onCreateFile: (skillName: string, parentPath: string) => void
  onCreateFolder: (skillName: string, parentPath: string) => void
  onOpenFile: (skillName: string, relativePath: string) => void
  onDeleteFile: (skillName: string, relativePath: string) => void
}

/** 单 scope 技能树列表（项目级/用户级复用） */
export default function SkillTreeBlock({
  scope,
  title,
  hint,
  skills,
  skillTree,
  skillExpanded,
  saveHint,
  disabled,
  onRefresh,
  onToggleExpand,
  onOpenAdd,
  onOpenEdit,
  onDeleteSkill,
  onCreateFile,
  onCreateFolder,
  onOpenFile,
  onDeleteFile,
}: Props) {
  const renderNode = (skillName: string, node: SkillTreeNode, parentPath: string, depth: number): ReactNode => {
    const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name
    const nodeKey = expandKey(scope, skillName, fullPath)
    if (node.type === "directory") {
      const dirExpanded = skillExpanded.has(nodeKey)
      return (
        <div key={nodeKey}>
          <div className="group flex items-center" style={{ paddingLeft: `${(depth + 1) * 16 + 4}px` }}>
            <button
              onClick={() => onToggleExpand(nodeKey)}
              disabled={disabled}
              className="flex flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-xs text-gray-400 transition hover:bg-gray-800/50 hover:text-gray-200 disabled:opacity-40"
            >
              {dirExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Folder size={12} className="text-blue-400/70" />
              <span>{node.name}</span>
            </button>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
              <button disabled={disabled} onClick={() => onCreateFile(skillName, fullPath)} className="rounded p-0.5 text-gray-600 hover:text-gray-300 disabled:opacity-40" title="新建文件"><FilePlus size={12} /></button>
              <button disabled={disabled} onClick={() => onCreateFolder(skillName, fullPath)} className="rounded p-0.5 text-gray-600 hover:text-gray-300 disabled:opacity-40" title="新建文件夹"><FolderPlus size={12} /></button>
              <button disabled={disabled} onClick={() => onDeleteFile(skillName, fullPath)} className="rounded p-0.5 text-gray-600 hover:text-red-400 disabled:opacity-40" title="删除文件夹"><Trash2 size={12} /></button>
            </div>
          </div>
          {dirExpanded && node.children?.map((child) => renderNode(skillName, child, fullPath, depth + 1))}
        </div>
      )
    }
    return (
      <div key={nodeKey} className="group flex items-center" style={{ paddingLeft: `${(depth + 1) * 16 + 20}px` }}>
        <button
          onClick={() => onOpenFile(skillName, fullPath)}
          disabled={disabled}
          className="flex flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-xs text-gray-500 transition hover:bg-gray-800/50 hover:text-gray-200 disabled:opacity-40"
        >
          <File size={11} className="shrink-0 text-gray-600" />
          <span className="truncate">{node.name}</span>
        </button>
        <button disabled={disabled} onClick={() => onDeleteFile(skillName, fullPath)} className="shrink-0 rounded p-0.5 text-gray-600 opacity-0 transition hover:text-red-400 group-hover:opacity-100 disabled:opacity-40" title="删除文件"><Trash2 size={12} /></button>
      </div>
    )
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-gray-300">{title}</h3>
        <button onClick={onRefresh} disabled={disabled} className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white disabled:opacity-40">
          <RefreshCw size={12} />刷新
        </button>
        <div className="flex-1" />
        <button onClick={onOpenAdd} disabled={disabled} className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40">
          <Plus size={12} />新增
        </button>
      </div>
      <p className="text-xs text-gray-600">{hint}</p>
      {saveHint && <p className="text-xs text-green-400/90">{saveHint}</p>}
      <div className="space-y-1">
        {skillTree.map((skill) => {
          const topKey = expandKey(scope, skill.name)
          const isExpanded = skillExpanded.has(topKey)
          return (
            <div key={topKey} className="rounded-lg border border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2.5">
                <button onClick={() => onToggleExpand(topKey)} disabled={disabled} className="flex items-center gap-2 min-w-0 disabled:opacity-40">
                  {isExpanded ? <ChevronDown size={14} className="shrink-0 text-gray-500" /> : <ChevronRight size={14} className="shrink-0 text-gray-500" />}
                  <Sparkles size={14} className="shrink-0 text-amber-400/70" />
                  <span className="truncate text-sm font-medium">{skill.name}</span>
                </button>
                <div className="ml-3 flex shrink-0 items-center gap-1">
                  <button disabled={disabled} onClick={() => onCreateFile(skill.name, "")} className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-white disabled:opacity-40" title="新建文件"><FilePlus size={13} /></button>
                  <button disabled={disabled} onClick={() => onCreateFolder(skill.name, "")} className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-white disabled:opacity-40" title="新建文件夹"><FolderPlus size={13} /></button>
                  <button disabled={disabled} onClick={() => { const s = skills.find((x) => x.name === skill.name); if (s) onOpenEdit(s) }} className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-white disabled:opacity-40" title="编辑 SKILL.md"><Pencil size={13} /></button>
                  <button disabled={disabled} onClick={() => onDeleteSkill(skill.name)} className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-red-400 disabled:opacity-40" title="删除整个 Skill"><Trash2 size={13} /></button>
                </div>
              </div>
              {isExpanded && skill.children && skill.children.length > 0 && (
                <div className="border-t border-gray-700/50 bg-gray-900/30 px-1 py-1.5">
                  {skill.children.map((child) => renderNode(skill.name, child, "", 0))}
                </div>
              )}
            </div>
          )
        })}
        {skillTree.length === 0 && <p className="py-4 text-center text-xs text-gray-600">暂无 Skill</p>}
      </div>
    </section>
  )
}
