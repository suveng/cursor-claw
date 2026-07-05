# Profile 可配置 Daemon 日志 — 变更总结

> **变更 ID**：`20260705141336-Profile可配置Daemon日志`
> **来源**：kb-lite
> **lite 类型**：知识同步型
> **阶段**：`applied`（归档由 kb-release 执行）

---

## 1、实际变更

| 文件 | 关键改动 |
|------|----------|
| `electron/config/daemon-log-path.ts` | **新建**：`resolveDaemonLogPath` / `resolveActiveDaemonLogPath`；按首个启用通道绑定 Profile 的 `daemonLogPath` 解析共用日志路径 |
| `src/shared/channel-types.ts` | `AgentResource` 增可选 `daemonLogPath`（Profile 级绝对路径） |
| `electron/preload.ts` / `src/renderer/env.d.ts` | `AgentResource` 类型同步 `daemonLogPath?` |
| `electron/app/ui-logger.ts` | 写盘路径改经 `resolveActiveDaemonLogPath` |
| `electron/daemon/daemon-manager.ts` | 启动 Daemon 注入 `DAEMON_LOG_PATH`；`agentResources` 日志路径变更时重启 Daemon |
| `src/daemon/daemon.ts` | 读 `DAEMON_LOG_PATH` 环境变量，兜底 `{APP_DATA_DIR}/daemon.log` |
| `src/renderer/components/ProfileDaemonLogField.tsx` | **新建**：四引擎 Profile 编辑弹窗共用日志路径选择器 |
| `src/renderer/components/AgentResourceModals.tsx` | SDK/CC/Codex/OpenCode 编辑弹窗挂载 `ProfileDaemonLogField` |
| `package.json` | `1.13.11` → `1.13.12`（patch） |
| `changelog/1.13.12.json` | **新建** |

**用户可见行为**：Settings → Agent 各 Profile 编辑弹窗可配置独立 `daemon.log` 路径；Electron UI 日志与 Daemon 子进程写入同一文件；留空时沿用工作目录 `.cursor/daemon.log` 或 `userData/logs/daemon.log`。

---

## 2、与设计的差异

无（lite 无 `02-design.md`）。

---

## 3、影响范围

| 范围 | 说明 |
|------|------|
| **配置模型** | `AgentResource.daemonLogPath` 持久化于 electron-store |
| **运行时** | 活跃路径 = 首个启用通道绑定 Profile 的自定义路径，否则默认规则 |
| **Daemon** | 经 `DAEMON_LOG_PATH` 与 Electron 对齐；2MB 轮转不变 |
| **用户可见** | **是** — Settings Agent Profile 编辑新增日志路径项 |

### 3.1 Ponytail 技术债

无。

---

## 4、知识库影响清单

- [x] `knowledge/工程平台/Electron桌面应用/04-配置与更新.md` — `AgentResource.daemonLogPath` 与路径解析
- [x] `knowledge/工程平台/Electron桌面应用/03-渲染端界面.md` — Profile 编辑弹窗日志字段
- [x] `knowledge/工程平台/Daemon守护进程/01-概览.md` — 可配置日志路径说明
- [x] `knowledge/工程平台/Daemon守护进程/03-进程模型与部署.md` — `DAEMON_LOG_PATH` 环境变量
- [x] `knowledge/知识索引.md` — 总入口未变化，无需更新
