# Electron 主进程约定（根索引）

> `main.ts`、`preload.ts` 留根目录；业务模块按语义子目录组织。规矩详情见各子目录 `AGENTS.md`。

## 子目录索引

| 子目录 | 职责 | 规矩 |
|--------|------|------|
| [app/](app/AGENTS.md) | 窗口、托盘、UI 日志、代理 | 读配置走 `config/` |
| [config/](config/AGENTS.md) | 配置存储与应用更新 | 通道字段三处同步 |
| [daemon/](daemon/AGENTS.md) | Daemon 桥接、IM notify | 不拆分 daemon-manager |
| [session/](session/AGENTS.md) | 多会话调度、Session MCP | 统一 `getSessionMcpStatus` |
| [scheduling/](scheduling/AGENTS.md) | 定时任务、飞书远程指令 | 不 spawn Agent |
| [workflow/](workflow/AGENTS.md) | 工作流定义与执行 | 经 session-dispatcher 启动 |
| [agent/shared/](agent/shared/AGENTS.md) | 跨引擎共享（launcher/guard/归档） | 无 CLI spawn |
| [agent/cursor-sdk/](agent/cursor-sdk/AGENTS.md) | Cursor SDK Run 链 | sdk-run-* 拆分 |
| [agent/claude-code/](agent/claude-code/AGENTS.md) | Claude Code query 引擎 | cc-mcp-loader |
| [agent/codex/](agent/codex/AGENTS.md) | Codex SDK 引擎 | config.toml MCP |
| [agent/opencode/](agent/opencode/AGENTS.md) | OpenCode 引擎 | 内嵌 server |
| [mcp/](mcp/AGENTS.md) | MCP CRUD 与四引擎 loader | loaders/ 子目录 |

## 跨模块规矩

- **import**：使用相对子目录路径（如 `./agent/cursor-sdk/agent-sdk`）；**禁止** barrel `index.ts` 与 `@electron/*` 别名。
- **单文件行数**：≤300 行（`daemon/daemon-manager.ts` 历史超限不拆分）。
- **IPC**：通道名与 handler 行为不因目录迁移而变更；`preload.ts` 不 import 主进程内部模块。
- **IM 调度**：Daemon `POST /api/agent/launch|dispatch` 经四引擎 HTTP 路由；无 CLI spawn。
- **通道配置**：`MessageChannel` / `AgentResource` 变更须同步 `src/shared/channel-types.ts`、`preload.ts`、`env.d.ts`（详见 [config/AGENTS.md](config/AGENTS.md)）。
- **SDK 可观测**：`handleSdkEvent` 写 `lastTool`；超时类 `isRunTimeoutFailure` 优先于 CANCELLED 文案（详见 [agent/cursor-sdk/AGENTS.md](agent/cursor-sdk/AGENTS.md)）。

## Skills IPC 模块边界

- **入口**：`skills-ipc.ts` 导出 `SkillScope`、`SkillTreeNode`、`resolveSkillsDir`、`buildSkillTree`、`registerSkillsIpcHandlers`；`main.ts` 在 `registerIpcHandlers` 内调用注册，**禁止**内联 `skills:*` handler。
- **路径单点**：所有 handler 经 `resolveSkillsDir(scope)` 解析根目录；`user` → `~/.cursor/skills`，`project` → `{workspaceDir}/.cursor/skills`（读 `config-store.getConfig().workspaceDir`）。
- **scope 契约**：各 channel 末位可选 `scope?: SkillScope`，省略默认 `"user"`；project 写操作无工作区返回统一中文错误；project 读 `list`/`tree` 无工作区返回 `[]`。
- **对齐 rules**：工作区缺失错误文案与 `rules:save`/`rules:delete` 模式一致，仅 skills 专用措辞不同。
