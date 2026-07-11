# src 源码约定（根索引）

> 守护进程入口 `daemon-entry.ts`；业务按语义子目录组织。规矩详情见各子目录 `AGENTS.md`。

## 子目录索引

| 子目录 | 职责 | 规矩 |
|--------|------|------|
| [daemon/](daemon/AGENTS.md) | HTTP/MCP 枢纽、orchestrator、MergeBatch、Presentation | `daemon.ts` 薄组装 + `daemon-*` 子模块；批1 已拆 HTTP/orchestrator/presentation；queue/channel/logging 仍驻 `daemon.ts`（批2） |
| [bridge/](bridge/AGENTS.md) | 文件队列、飞书 Lark、微信客户端 | `git mv` 迁移，无 barrel |
| [workflow/](workflow/AGENTS.md) | 工作流引擎、定义存储、MCP 工具 | 经 daemon 注册 MCP |
| [shared/](shared/AGENTS.md) | 跨域类型、presentation gate、常量 | 通道字段三端同步 |

## 全局约束

- **import**：跨域用 `../<域>/<file>.js`（Node16 ESM）；**禁止** barrel `index.ts` 与 re-export shim。
- **单文件行数**：≤300 行；超限须拆分，不为此任务扩 scope。
- **渲染端 UI**：组件规矩见 [renderer/components/AGENTS.md](renderer/components/AGENTS.md)；`env.d.ts` 类型与 `electron/preload.ts` 同步。
- **IM 调度 SSOT**：`POST /api/agent/launch|dispatch` 在 Daemon 暴露并转发 Electron；编排细节见 [daemon/AGENTS.md](daemon/AGENTS.md)。
