# SDK idle 超时延长至 30 分钟 - 变更总结

## 实际变更

| 文件 | 说明 |
|------|------|
| `electron/agent/cursor-sdk/sdk-run-watchdog.ts` | 新增 `DEFAULT_SDK_IDLE_TIMEOUT_MS`（30min）；idle 默认与 `PLATFORM_RUN_LIMIT_MS` 解耦；`SDK_IDLE_TIMEOUT_MS` 可覆盖 |
| `electron/agent/cursor-sdk/AGENTS.md` | watchdog 段落同步 idle 默认 30min、absolute 7min 解耦说明 |
| `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` | watchdog 关键约束与非功能段同步 idle 30min / absolute 7min；变更记录追加 |
| `package.json` | version → 1.13.15 |
| `changelog/1.13.15.json` | 用户可见变更条目 |

**用户可见**：长任务在无 SDK 事件输出时不再约 7 分钟被 watchdog 误杀，默认 idle 容忍延长至 30 分钟。

## 知识库更新清单

- [x] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md`
- [ ] 总索引无需更新（未增删领域入口）

## 两级索引

未新增/删除/重命名目录入口，无需更新 `knowledge/知识索引.md`。

## 版本

- patch bump：`1.13.14` → `1.13.15`

## 影响范围

| 范围 | 说明 |
|------|------|
| **Electron 主进程 SDK** | `sdk-run-watchdog.ts` idle 阈值默认值 |
| **用户可见** | **是** — 长 idle 运行不再约 7min 被误杀 |
| **不涉及** | Daemon、飞书呈现、MCP、其他执行引擎 |

### 3.1 Ponytail 技术债

无。
