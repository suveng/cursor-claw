# config/ — 配置与更新

## 通道配置字段

- `MessageChannel` 增删字段须同步：`src/shared/channel-types.ts`、`electron/preload.ts`、`src/renderer/env.d.ts`（`ChannelConfig`）。
- `AgentResource.type` 三处同步（`channel-types` / `preload` / `env.d.ts`）；`engineType` 两处同步（`preload` / `env.d.ts`）。新增引擎类型时同步扩展 `findFirstRunnableResource` 兜底链与 `config-store` 侧 `new*ResourceId()`；已删除 Codex 绑定（`isCodexResourceId`）时 `getAgentResource` **不** fallback 其他 Profile。
- 旧通道读时兜底写在 `config-store.getChannels`，与 `ChannelPanel` reload / `emptyChannel` 保持一致。

## 模块边界

- `config-store.ts`：`AppConfig` SSOT；`getConfig` / `saveConfig` / 通道与 Agent 资源池。
- `updater.ts`：应用内更新**对外入口**（`initAppUpdater` / `registerUpdaterIpc` / `fetchLatestRelease`）；实现按职责拆到 `updater-*.ts`。

### updater 子文件

| 文件 | 职责 |
|------|------|
| `updater.ts` | 启动检查、IPC 组装、re-export 类型 |
| `updater-types.ts` | `LatestRelease` / `UpdaterCheckResult` / `UpdaterApplyResult` 等 |
| `updater-modal.ts` | 应用内模态队列、`promptInstallDownloaded` |
| `updater-release.ts` | GitHub release / changelog / `resolveReleaseNotes` |
| `updater-apply.ts` | brew/win 应用、`wireAutoUpdater`、缓存清理 |

域外仍 `import … from "./config/updater"`（如 `main.ts`），**禁止** barrel `index.ts`。

## 编码规矩

- 共享类型从 `../../src/shared/channel-types` import；**禁止**在本目录重复定义 IPC 契约类型。
- 单文件 ≤300 行；更新渠道默认值与 IPC channel 名勿随意改动。
- SDK error 可观测性与保活文案规矩见 [agent/cursor-sdk/AGENTS.md](../agent/cursor-sdk/AGENTS.md)。
