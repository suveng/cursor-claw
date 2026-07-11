# Cursor SDK 依赖升级 1.0.23 - 变更总结

## 实际变更

| 文件 | 说明 |
|------|------|
| `package.json` | `@cursor/sdk` ^1.0.22 → ^1.0.23；version 1.14.3 → 1.14.4 |
| `package-lock.json` | lock 解析 `@cursor/sdk@1.0.23` 及平台包 1.0.23 |
| `changelog/1.14.4.json` | 用户可见依赖升级条目 |
| `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` | 变更记录追加 1.0.23 升级说明 |

**用户可见**：长驻 Agent 空闲后失败与崩溃概率降低；SDK 错误日志更可诊断。

## 与 1.0.22 的差异（官方未提供逐版本 changelog，据社区与包说明归纳）

| 方面 | 1.0.23 |
|------|--------|
| 空闲后 host 崩溃 | 论坛确认 1.0.23 修复 ConnectRPC `unauthenticated` 导致的进程崩溃 |
| error 终态 | `status: "error"` 时错误详情更完整 |
| 依赖树 | 移除 sqlite3/node-gyp 链；ConnectRPC 直接声明 |
| 分发结构 | 仅 `dist/esm/357.js`（无 `dist/cjs/357.js`）；patch 脚本仍兼容 |

## 知识库更新清单

- [x] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md`
- [ ] 总索引无需更新（未增删领域入口）

## 版本

- patch bump：`1.14.3` → `1.14.4`

## 影响范围

| 范围 | 说明 |
|------|------|
| **Electron 主进程 SDK** | 底层 `@cursor/sdk` 运行时 |
| **postinstall patch** | `scripts/patch-cursor-sdk-third-party.cjs` 已验证 esm 锚点有效 |
| **用户可见** | **是** — 稳定性与错误可观测性改善 |
| **不涉及** | Claw 业务逻辑、Daemon、飞书呈现、其他执行引擎 |

### Ponytail 技术债

- 官方尚无 README 级逐版本 changelog；后续升级仍须对照论坛 / npm 发布时间人工核对。
- `run.wait()` 对 opaque ERROR 返回结构化 `error` 字段仍在 SDK 侧开发中，Claw 层 `opaque_retry` workaround 暂保留。
