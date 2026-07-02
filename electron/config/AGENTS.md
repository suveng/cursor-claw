# config/ — 配置与更新

## 通道配置字段

- `MessageChannel` 增删字段须同步：`src/shared/channel-types.ts`、`electron/preload.ts`、`src/renderer/env.d.ts`（`ChannelConfig`）。
- `AgentResource.type` 三处同步（`channel-types` / `preload` / `env.d.ts`）；`engineType` 两处同步（`preload` / `env.d.ts`）。新增引擎类型时同步扩展 `findFirstRunnableResource` 兜底链与 `config-store` 侧 `new*ResourceId()`；已删除 Codex 绑定（`isCodexResourceId`）时 `getAgentResource` **不** fallback 其他 Profile。
- 旧通道读时兜底写在 `config-store.getChannels`，与 `ChannelPanel` reload / `emptyChannel` 保持一致。

## 模块边界

- `config-store.ts`：`AppConfig` SSOT；`getConfig` / `saveConfig` / 通道与 Agent 资源池。
- `updater.ts`：应用内更新检查；`initAppUpdater` 由 `main.ts` 调用。

## 编码规矩

- 共享类型从 `../../src/shared/channel-types` import；**禁止**在本目录重复定义 IPC 契约类型。
- SDK error 可观测性与保活文案规矩见 [agent/cursor-sdk/AGENTS.md](../agent/cursor-sdk/AGENTS.md)。
