# Daemon 守护进程

本机消息桥接守护进程：飞书 WebSocket、微信 iLink、文件队列、HTTP/MCP API。

## 文件清单

| 文件 | 职责 |
|---|---|
| [01-概览.md](./01-概览.md) | 进程定位、架构、主流程 |
| [02-HTTP与MCP服务.md](./02-HTTP与MCP服务.md) | REST API、MCP 工具、管理接口 |
| [03-进程模型与部署.md](./03-进程模型与部署.md) | spawn、端口、日志、与 Electron 通信 |

## 职责边界

- **负责**：多通道消息收发、会话路由、文件队列、IM 编排 dispatch、Presentation 路由、StreamableHTTP MCP。
- **不负责**：桌面 UI、electron-store 配置编辑（由 Electron 主进程负责）。

## 源码入口

- `src/daemon-entry.ts` → `src/daemon/daemon.ts`（`daemonMain` 薄组装 ≤200）
- 批2 子模块：`daemon-logging` / `daemon-queue*` / `daemon-channel*` / `daemon-wire` / `daemon-bootstrap`（职责表见 `src/daemon/AGENTS.md`）
- 打包产物由 `scripts/bundle-daemon.cjs` 生成，Electron 以 `ELECTRON_RUN_AS_NODE` spawn

## 推荐阅读路径

1. 01-概览 → 2. 03-进程模型与部署 → 3. 02-HTTP 与 MCP 服务 → 4. `src/daemon/AGENTS.md`（模块边界）

## 变更记录

- 2026-07-12：批2 queue/channel/logging 拆分锚点（archive 20260712170438）
- 2026-07-12：`02-HTTP与MCP服务` 补 MCP 健康降级 SSOT 与 `src/daemon/AGENTS.md` 交叉引用（archive 20260712145827）
- 2026-07-12：`session-routing.json` 调度态路由持久化（archive 20260712113356）
- 2026-07-02：源码入口对齐 `src/daemon/daemon.ts`（archive 20260702120154）
- 2026-06-27：IM 唯一编排、poll 移除（archive 20260627162620）
- 2026-06-27：kb-sync 初始建立
