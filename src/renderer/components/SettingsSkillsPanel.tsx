import { useState, useEffect, useCallback } from "react"
import SkillEditModals from "./SkillEditModals"
import SettingsPluginInventory from "./SettingsPluginInventory"
import SkillTreeBlock from "./SkillTreeBlock"
import useInlineModal from "./useInlineModal"

interface Props {
  /** 主工作区路径（项目级 Skills 绑定） */
  workspaceDir: string
}

interface SkillFile {
  name: string
  content: string
}

/** Settings Skills Tab：上项目级、下用户级双区块，CRUD 透传 scope */
export default function SettingsSkillsPanel({ workspaceDir }: Props) {
  const { showAlert, ModalPortal } = useInlineModal()
  const [activeScope, setActiveScope] = useState<SkillScope>("user")
  const [projectSkills, setProjectSkills] = useState<SkillFile[]>([])
  const [projectTree, setProjectTree] = useState<SkillTreeNode[]>([])
  const [userSkills, setUserSkills] = useState<SkillFile[]>([])
  const [userTree, setUserTree] = useState<SkillTreeNode[]>([])
  const [projectSaveHint, setProjectSaveHint] = useState<string | null>(null)
  const [userSaveHint, setUserSaveHint] = useState<string | null>(null)
  const [skillExpanded, setSkillExpanded] = useState<Set<string>>(new Set())
  const [skillEditing, setSkillEditing] = useState<SkillFile | null>(null)
  const [skillEditOriginalName, setSkillEditOriginalName] = useState<string | null>(null)
  const [skillFileEditing, setSkillFileEditing] = useState<{ skillName: string; relativePath: string; content: string } | null>(null)
  const [skillPrompt, setSkillPrompt] = useState<{ skillName: string; parentPath: string; kind: "file" | "folder"; value: string } | null>(null)
  const [skillDeleteConfirm, setSkillDeleteConfirm] = useState<{ skillName: string; relativePath: string } | null>(null)

  const projectDisabled = !workspaceDir.trim()

  const refreshScope = useCallback((scope: SkillScope) => {
    void window.electronAPI.getSkills(scope).then(scope === "project" ? setProjectSkills : setUserSkills)
    void window.electronAPI.getSkillTree(scope).then(scope === "project" ? setProjectTree : setUserTree)
  }, [])

  const refreshAll = useCallback(() => {
    refreshScope("project")
    refreshScope("user")
  }, [refreshScope])

  // 面板挂载时双区块分别 refresh
  useEffect(() => { refreshAll() }, [refreshAll])

  // workspaceDir 变化时刷新项目级列表；未配置时清空避免残留
  useEffect(() => {
    refreshScope("project")
    if (!workspaceDir.trim()) {
      setProjectSkills([])
      setProjectTree([])
    }
  }, [workspaceDir, refreshScope])

  const showSaveHint = (scope: SkillScope) => {
    const hint = scope === "project"
      ? `已保存至项目级 ${workspaceDir.trim()}/.cursor/skills，下轮 SDK 会话自动加载`
      : "已保存至用户级 ~/.cursor/skills，下轮 SDK 会话自动加载"
    const setter = scope === "project" ? setProjectSaveHint : setUserSaveHint
    setter(hint)
    setTimeout(() => setter(null), 4000)
  }

  const toggleSkillExpand = (key: string) => {
    setSkillExpanded((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const withScope = (scope: SkillScope) => {
    setActiveScope(scope)
    return scope
  }

  const openSkillAdd = (scope: SkillScope) => {
    withScope(scope)
    setSkillEditOriginalName(null)
    setSkillEditing({ name: "", content: "" })
  }

  const openSkillEdit = (scope: SkillScope, s: SkillFile) => {
    withScope(scope)
    setSkillEditOriginalName(s.name)
    setSkillEditing({ ...s })
  }

  const handleSkillDelete = async (scope: SkillScope, name: string) => {
    withScope(scope)
    const res = await window.electronAPI.deleteSkill(name, scope)
    if (!res.ok) {
      void showAlert("错误", res.error ?? "删除失败")
      return
    }
    refreshScope(scope)
  }

  const handleSkillSave = async () => {
    if (!skillEditing || !skillEditing.name.trim()) return
    const scope = activeScope
    const newName = skillEditing.name.trim()
    if (skillEditOriginalName && skillEditOriginalName !== newName) {
      const renameRes = await window.electronAPI.renameSkill(skillEditOriginalName, newName, scope)
      if (!renameRes.ok) {
        void showAlert("错误", renameRes.error ?? "重命名失败")
        return
      }
    }
    const saveRes = await window.electronAPI.saveSkill(newName, skillEditing.content, scope)
    if (!saveRes.ok) {
      void showAlert("错误", saveRes.error ?? "保存失败")
      return
    }
    setSkillEditing(null)
    refreshScope(scope)
    showSaveHint(scope)
  }

  const openSkillFile = async (scope: SkillScope, skillName: string, relativePath: string) => {
    withScope(scope)
    const res = await window.electronAPI.readSkillFile(skillName, relativePath, scope)
    if (res.ok) setSkillFileEditing({ skillName, relativePath, content: res.content ?? "" })
  }

  const handleSkillFileSave = async () => {
    if (!skillFileEditing) return
    const res = await window.electronAPI.saveSkillFile(
      skillFileEditing.skillName,
      skillFileEditing.relativePath,
      skillFileEditing.content,
      activeScope,
    )
    if (!res.ok) {
      void showAlert("错误", res.error ?? "保存失败")
      return
    }
    setSkillFileEditing(null)
    refreshScope(activeScope)
  }

  const handleCreateFile = (scope: SkillScope, skillName: string, parentPath: string) => {
    withScope(scope)
    setSkillPrompt({ skillName, parentPath, kind: "file", value: "" })
  }

  const handleCreateFolder = (scope: SkillScope, skillName: string, parentPath: string) => {
    withScope(scope)
    setSkillPrompt({ skillName, parentPath, kind: "folder", value: "" })
  }

  const handleSkillPromptConfirm = async () => {
    if (!skillPrompt || !skillPrompt.value.trim()) return
    const name = skillPrompt.value.trim()
    const { skillName, parentPath, kind } = skillPrompt
    const scope = activeScope
    const rel = parentPath ? `${parentPath}/${name}` : name
    if (kind === "file") {
      const res = await window.electronAPI.saveSkillFile(skillName, rel, "", scope)
      if (!res.ok) {
        void showAlert("错误", res.error ?? "创建失败")
        return
      }
      refreshScope(scope)
      setSkillPrompt(null)
      void openSkillFile(scope, skillName, rel)
    } else {
      const res = await window.electronAPI.createSkillDir(skillName, rel, scope)
      if (!res.ok) {
        void showAlert("错误", res.error ?? "创建失败")
        return
      }
      refreshScope(scope)
      setSkillPrompt(null)
    }
  }

  const handleDeleteFile = (scope: SkillScope, skillName: string, relativePath: string) => {
    withScope(scope)
    setSkillDeleteConfirm({ skillName, relativePath })
  }

  const handleDeleteFileConfirm = async () => {
    if (!skillDeleteConfirm) return
    const res = await window.electronAPI.deleteSkillFile(
      skillDeleteConfirm.skillName,
      skillDeleteConfirm.relativePath,
      activeScope,
    )
    if (!res.ok) {
      void showAlert("错误", res.error ?? "删除失败")
      return
    }
    setSkillDeleteConfirm(null)
    refreshScope(activeScope)
  }

  return (
    <div className="space-y-6">
      <SettingsPluginInventory workspaceDir={workspaceDir} highlight="skills" />

      {/* 项目级区块 */}
      <div className="space-y-3">
        <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 text-xs">
          <p className="font-medium text-gray-300">项目级 Skills · 主工作区</p>
          {workspaceDir.trim() ? (
            <>
              <p className="mt-1 font-mono text-[11px] text-gray-500 break-all">{workspaceDir}</p>
              <p className="mt-1.5 text-gray-600 leading-relaxed">
                Skills 写入主工作区 <span className="text-gray-500">.cursor/skills/</span>（项目级）。
                插件层 skills 由上方清单展示，经 <span className="font-mono text-gray-500">settingSources: plugins</span> 加载。
                会话 cwd 与主工作区不同时，此处修改可能不作用于该会话。
              </p>
            </>
          ) : (
            <p className="mt-1 text-amber-500/90">请先在「通用」中配置主工作区后才能编辑项目级 Skills。</p>
          )}
        </div>
        <SkillTreeBlock
          scope="project"
          title="项目级 Agent Skills"
          hint={`管理主工作区 ${workspaceDir.trim() ? `${workspaceDir}/.cursor/skills/` : ".cursor/skills/"} 下的技能（每个技能为一个文件夹 + SKILL.md）`}
          skills={projectSkills}
          skillTree={projectTree}
          skillExpanded={skillExpanded}
          saveHint={projectSaveHint}
          disabled={projectDisabled}
          onRefresh={() => refreshScope("project")}
          onToggleExpand={toggleSkillExpand}
          onOpenAdd={() => openSkillAdd("project")}
          onOpenEdit={(s) => openSkillEdit("project", s)}
          onDeleteSkill={(name) => void handleSkillDelete("project", name)}
          onCreateFile={(sn, pp) => handleCreateFile("project", sn, pp)}
          onCreateFolder={(sn, pp) => handleCreateFolder("project", sn, pp)}
          onOpenFile={(sn, rp) => void openSkillFile("project", sn, rp)}
          onDeleteFile={(sn, rp) => handleDeleteFile("project", sn, rp)}
        />
      </div>

      {/* 用户级区块 */}
      <div className="space-y-3">
        <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 text-xs">
          <p className="font-medium text-gray-300">用户级 · 全工作区生效</p>
          <p className="mt-1 text-gray-600">
            Skills 保存在 <span className="font-mono text-gray-500">~/.cursor/skills</span>，经 SDK{" "}
            <span className="font-mono text-gray-500">settingSources: project, user, plugins</span>{" "}
            自动加载；插件层 skills 见上方清单，无需写入工作区。
          </p>
        </div>
        <SkillTreeBlock
          scope="user"
          title="用户级 Agent Skills"
          hint="管理用户级 ~/.cursor/skills/ 下的技能（每个技能为一个文件夹 + SKILL.md）"
          skills={userSkills}
          skillTree={userTree}
          skillExpanded={skillExpanded}
          saveHint={userSaveHint}
          disabled={false}
          onRefresh={() => refreshScope("user")}
          onToggleExpand={toggleSkillExpand}
          onOpenAdd={() => openSkillAdd("user")}
          onOpenEdit={(s) => openSkillEdit("user", s)}
          onDeleteSkill={(name) => void handleSkillDelete("user", name)}
          onCreateFile={(sn, pp) => handleCreateFile("user", sn, pp)}
          onCreateFolder={(sn, pp) => handleCreateFolder("user", sn, pp)}
          onOpenFile={(sn, rp) => void openSkillFile("user", sn, rp)}
          onDeleteFile={(sn, rp) => handleDeleteFile("user", sn, rp)}
        />
      </div>

      <SkillEditModals
        skillEditing={skillEditing}
        skillEditOriginalName={skillEditOriginalName}
        skillFileEditing={skillFileEditing}
        skillPrompt={skillPrompt}
        skillDeleteConfirm={skillDeleteConfirm}
        onCloseSkillEdit={() => setSkillEditing(null)}
        onSkillEditChange={setSkillEditing}
        onSkillSave={() => void handleSkillSave()}
        onCloseSkillFileEdit={() => setSkillFileEditing(null)}
        onSkillFileEditChange={(content) => skillFileEditing && setSkillFileEditing({ ...skillFileEditing, content })}
        onSkillFileSave={() => void handleSkillFileSave()}
        onCloseSkillPrompt={() => setSkillPrompt(null)}
        onSkillPromptChange={(value) => skillPrompt && setSkillPrompt({ ...skillPrompt, value })}
        onSkillPromptConfirm={() => void handleSkillPromptConfirm()}
        onCloseSkillDeleteConfirm={() => setSkillDeleteConfirm(null)}
        onSkillDeleteConfirm={() => void handleDeleteFileConfirm()}
      />
      {ModalPortal}
    </div>
  )
}
