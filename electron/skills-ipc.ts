import { ipcMain } from "electron"
import * as path from "node:path"
import * as fs from "node:fs"
import * as os from "node:os"
import { getConfig } from "./config/config-store"

/** Skills 作用域：用户级 ~/.cursor/skills 或项目级 {workspace}/.cursor/skills */
export type SkillScope = "user" | "project"

/** 技能目录树节点（文件或子目录） */
export interface SkillTreeNode {
  name: string
  type: "file" | "directory"
  children?: SkillTreeNode[]
}

/** project 写操作未配置主工作区时的统一错误文案 */
const PROJECT_WRITE_NO_WORKSPACE =
  "未配置主工作区，无法保存技能。请先在「通用」中设置主工作区。"

/** 读取 trim 后的主工作区路径，空字符串表示未配置 */
function getWorkspaceDir(): string {
  return getConfig().workspaceDir?.trim() ?? ""
}

/** 末位 scope 省略时默认 user，与现网向后兼容 */
function normalizeScope(scope?: SkillScope): SkillScope {
  return scope ?? "user"
}

/**
 * 解析 skills 根目录（单点路径解析，禁止 handler 内散落 homedir 硬编码）。
 * user → ~/.cursor/skills；project → {workspaceDir}/.cursor/skills
 */
export function resolveSkillsDir(scope: SkillScope): string {
  if (scope === "user") {
    return path.join(os.homedir(), ".cursor", "skills")
  }
  return path.join(getWorkspaceDir(), ".cursor", "skills")
}

/** project 写操作校验：无工作区时返回错误对象 */
function projectWriteGuard(scope: SkillScope): { ok: false; error: string } | null {
  if (scope === "project" && !getWorkspaceDir()) {
    return { ok: false, error: PROJECT_WRITE_NO_WORKSPACE }
  }
  return null
}

const PATH_SEP_RE = /[/\\]/

/** 解析后的路径须在 skillsDir（或技能子目录）内；拒绝 skillName 含 .. 或分隔符 */
export function assertSkillPath(
  skillsDir: string,
  skillName: string,
  relativePath?: string,
): { ok: true; absPath: string } | { ok: false; error: string } {
  if (!skillName || skillName.includes("..") || PATH_SEP_RE.test(skillName)) {
    return { ok: false, error: "无效的技能名称" }
  }
  if (relativePath !== undefined) {
    if (!relativePath || relativePath.includes("..") || relativePath.includes("\\")) {
      return { ok: false, error: "无效的文件路径" }
    }
  }
  const root = path.resolve(skillsDir)
  const skillRoot = path.resolve(root, skillName)
  if (!skillRoot.startsWith(root + path.sep) && skillRoot !== root) {
    return { ok: false, error: "无效的技能路径" }
  }
  const absPath =
    relativePath !== undefined
      ? path.resolve(skillRoot, ...relativePath.split("/").filter(Boolean))
      : skillRoot
  const boundary = relativePath !== undefined ? skillRoot : root
  if (!absPath.startsWith(boundary + path.sep) && absPath !== boundary) {
    return { ok: false, error: "无效的文件路径" }
  }
  return { ok: true, absPath }
}

/** 递归构建技能目录内文件树，按目录优先、名称排序 */
export function buildSkillTree(dirPath: string): SkillTreeNode[] {
  if (!fs.existsSync(dirPath)) return []
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    .map((entry): SkillTreeNode => {
      if (entry.isDirectory()) {
        return {
          name: entry.name,
          type: "directory",
          children: buildSkillTree(path.join(dirPath, entry.name)),
        }
      }
      return { name: entry.name, type: "file" }
    })
}

/** 注册全部 skills:* IPC handler，各 channel 末位 scope 可选、默认 user */
export function registerSkillsIpcHandlers(): void {
  ipcMain.handle("skills:list", (_, scope?: SkillScope) => {
    const s = normalizeScope(scope)
    if (s === "project" && !getWorkspaceDir()) return []
    const skillsDir = resolveSkillsDir(s)
    if (!fs.existsSync(skillsDir)) return []
    return fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const skillFile = path.join(skillsDir, d.name, "SKILL.md")
        return {
          name: d.name,
          content: fs.existsSync(skillFile) ? fs.readFileSync(skillFile, "utf-8") : "",
        }
      })
  })

  ipcMain.handle("skills:tree", (_, scope?: SkillScope) => {
    const s = normalizeScope(scope)
    if (s === "project" && !getWorkspaceDir()) return []
    const skillsDir = resolveSkillsDir(s)
    if (!fs.existsSync(skillsDir)) return []
    return fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => ({
        name: d.name,
        type: "directory" as const,
        children: buildSkillTree(path.join(skillsDir, d.name)),
      }))
  })

  ipcMain.handle(
    "skills:read-file",
    (_, skillName: string, relativePath: string, scope?: SkillScope) => {
      const s = normalizeScope(scope)
      if (s === "project" && !getWorkspaceDir()) {
        return { ok: false, error: PROJECT_WRITE_NO_WORKSPACE }
      }
      const skillsDir = resolveSkillsDir(s)
      const checked = assertSkillPath(skillsDir, skillName, relativePath)
      if (!checked.ok) return checked
      if (!fs.existsSync(checked.absPath)) return { ok: false, error: "文件不存在" }
      return { ok: true, content: fs.readFileSync(checked.absPath, "utf-8") }
    },
  )

  ipcMain.handle(
    "skills:save-file",
    (_, skillName: string, relativePath: string, content: string, scope?: SkillScope) => {
      const s = normalizeScope(scope)
      const blocked = projectWriteGuard(s)
      if (blocked) return blocked
      const skillsDir = resolveSkillsDir(s)
      const checked = assertSkillPath(skillsDir, skillName, relativePath)
      if (!checked.ok) return checked
      const dir = path.dirname(checked.absPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(checked.absPath, content, "utf-8")
      return { ok: true }
    },
  )

  ipcMain.handle(
    "skills:create-dir",
    (_, skillName: string, relativePath: string, scope?: SkillScope) => {
      const s = normalizeScope(scope)
      const blocked = projectWriteGuard(s)
      if (blocked) return blocked
      const skillsDir = resolveSkillsDir(s)
      const checked = assertSkillPath(skillsDir, skillName, relativePath)
      if (!checked.ok) return checked
      if (!fs.existsSync(checked.absPath)) fs.mkdirSync(checked.absPath, { recursive: true })
      return { ok: true }
    },
  )

  ipcMain.handle(
    "skills:delete-file",
    (_, skillName: string, relativePath: string, scope?: SkillScope) => {
      const s = normalizeScope(scope)
      const blocked = projectWriteGuard(s)
      if (blocked) return blocked
      const skillsDir = resolveSkillsDir(s)
      const checked = assertSkillPath(skillsDir, skillName, relativePath)
      if (!checked.ok) return checked
      if (!fs.existsSync(checked.absPath)) return { ok: false, error: "文件不存在" }
      const stat = fs.statSync(checked.absPath)
      if (stat.isDirectory()) {
        fs.rmSync(checked.absPath, { recursive: true, force: true })
      } else {
        fs.unlinkSync(checked.absPath)
      }
      return { ok: true }
    },
  )

  ipcMain.handle("skills:save", (_, name: string, content: string, scope?: SkillScope) => {
    const s = normalizeScope(scope)
    const blocked = projectWriteGuard(s)
    if (blocked) return blocked
    const skillsDir = resolveSkillsDir(s)
    const checked = assertSkillPath(skillsDir, name)
    if (!checked.ok) return checked
    if (!fs.existsSync(checked.absPath)) fs.mkdirSync(checked.absPath, { recursive: true })
    fs.writeFileSync(path.join(checked.absPath, "SKILL.md"), content, "utf-8")
    return { ok: true, skillsDir }
  })

  ipcMain.handle(
    "skills:rename",
    (_, oldName: string, newName: string, scope?: SkillScope) => {
      const s = normalizeScope(scope)
      const blocked = projectWriteGuard(s)
      if (blocked) return blocked
      const skillsDir = resolveSkillsDir(s)
      const oldChecked = assertSkillPath(skillsDir, oldName)
      if (!oldChecked.ok) return oldChecked
      const newChecked = assertSkillPath(skillsDir, newName)
      if (!newChecked.ok) return newChecked
      if (!fs.existsSync(oldChecked.absPath)) return { ok: false, error: "原目录不存在" }
      if (fs.existsSync(newChecked.absPath)) return { ok: false, error: "目标目录已存在" }
      fs.renameSync(oldChecked.absPath, newChecked.absPath)
      return { ok: true }
    },
  )

  ipcMain.handle("skills:delete", (_, name: string, scope?: SkillScope) => {
    const s = normalizeScope(scope)
    const blocked = projectWriteGuard(s)
    if (blocked) return blocked
    const skillsDir = resolveSkillsDir(s)
    const checked = assertSkillPath(skillsDir, name)
    if (!checked.ok) return checked
    if (fs.existsSync(checked.absPath)) fs.rmSync(checked.absPath, { recursive: true, force: true })
    return { ok: true }
  })
}
