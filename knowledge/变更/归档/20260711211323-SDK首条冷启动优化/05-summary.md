# SDK 首条冷启动优化 - 变更总结

> **变更 ID**：`20260711211323-SDK首条冷启动优化`  
> **来源**：kb-propose · standard flow  
> **阶段**：`tested`（本文件为 archive 步骤 5；kb-release 负责目录迁移与 `archived`）  
> **用户可见性**：**是** — 飞书私聊首条冷启动 RUNNING 感知提前、启动进度文案细化；`agent.send` ~12s 外部下限不变（C1）

---

## 背景

飞书私聊首条消息经 Daemon 入队后，用户感知 Agent **RUNNING** 约需 **25s**（基线 `daemon.log` 2026-07-11 19:58 段）。根因是 Electron Cursor SDK launch 冷路径在 send 前**串行**执行 `Agent.create`（~5s）→ `Cursor.models.list`（~5s）→ 二次 `bootstrapSdkPluginWorkspace`（~5s 级）→ `agent.send`（~12s，外部依赖）。Daemon 调度 ~1.3s 非瓶颈。

本期通过 **A1～A3** 并行化与 bootstrap 复用消除 send 前串行阻塞，通过 **B1** bind 后 fire-and-forget 预热缩短下次首条冷启动，通过 **B2** 将单一「正在启动」拆为两阶段可区分文案，目标 composer 首条较基线减少 **≥8s**（仍受 C1 `agent.send` 下限约束）。

---

## 1、实际变更（实现摘要）

### 代码（与 manifest.files code 一致）

| 文件 | 关键改动 |
|------|----------|
| `electron/agent/cursor-sdk/context-usage-model-limit.ts` | **新建**（120 行）：A1 启发式 `MODEL_LIMIT_HEURISTICS` 同步写 `modelLimitCache`；`refreshModelLimitFromList` 后台 fire-and-forget；`refreshInflight` 去重 |
| `electron/agent/cursor-sdk/context-usage.ts` | A1 拆分后 re-export；主文件 199 行 |
| `electron/agent/cursor-sdk/agent-sdk.ts` | A2：`launchSdkAgent` 内 `Agent.create` ∥ `resolveContextLimitForSession`，`Promise.all` 后才 `sdkSessions.set` / send；B2 send 前 `notifySessionChat`「正在准备模型…」；`dispatchToSdkAgent` 保持串行 limit（注释说明热路径不并行） |
| `electron/agent/cursor-sdk/sdk-run-dispatch.ts` | A3：`canReuseBootstrapSnapshot` 有 `lastInjectedMcpServers` 时跳过 `logSdkConfigSources` 二次 detailed bootstrap |
| `electron/agent/cursor-sdk/sdk-session-types.ts` | T2：可选 `launchBootstrapDone?: boolean` 标记 launch 已 detailed bootstrap |
| `electron/agent/cursor-sdk/sdk-warmup.ts` | **新建**（50 行）：`warmupSdkAfterBind` fire-and-forget；非 detailed bootstrap + composer-2 limit 预热；`[sdk_warmup] source=` 日志 |
| `electron/agent/cursor-sdk/agent-sdk-http.ts` | B1：新增 `POST /api/sdk-warmup` 供 Daemon 跨进程触发预热 |
| `electron/daemon/daemon-manager.ts` | B1a `initDaemonManager`、B1b `resolveBindWaiter` 直接 `void warmupSdkAfterBind` |
| `src/daemon/daemon.ts` | B1c `completeBind` → `postSdkWarmupRequest` 经 HTTP 代理预热 |
| `src/daemon/daemon-orchestrator.ts` | B2 S4a：launch 前 `notifySessionUser`「正在连接 Agent…」 |
| `src/daemon/daemon-presentation-handlers.ts` | B2 S2：`buildEnqueueStatusText` starting 文案「已收到。正在连接 Agent，你的消息已排队」 |

**静态验收**：`npm run build` 通过；T1–T7 `done`（见 `06-automation-test.md` §4.2）。

### 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `00-manifest.json`（stage=`tested`；T1–T7 done；reviews R1–R3 `accepted_debt`）
- `05-summary.md`（本文件）

---

## 2、与设计的差异

1. **B1c 预热调用方式**（04-review §4·1）：设计写 `completeBind` 侧直接 `void warmupSdkAfterBind(...)`；实现为 Daemon `completeBind` → `POST /api/sdk-warmup` → Electron `warmupSdkAfterBind`。跨进程架构必要适配；`init` / `bind-electron` 仍直接 import 调用。无功能回归。
2. **A1 模块拆分**：`context-usage-model-limit.ts` 自 `context-usage.ts` 拆出——由 AGENTS ≤300 行与 A1 职责分离驱动；04-review Ponytail 判定 **保留**，非未授权抽象。
3. **其余与 02-design S1–S13、B1a–d、B2 阶段表一致**；C1 `agent.send` 未越界。

---

## 3、影响范围

- **Cursor SDK 冷启动**：composer 等命中启发式时 send 前不再 await `models.list`；create 与 limit 并行；同次 launch 仅一条 detailed bootstrap。
- **bind 后预热**：三挂点（`init` / `bind-electron` / `bind-daemon`）fire-and-forget；失败仅 WARN，不阻断 bind / launch。
- **Daemon 呈现**：B2 两阶段文案（连接 Agent → 准备模型 → 处理中）；不改飞书卡片布局与 orchestrator debounce。
- **热 session**：`dispatchToSdkAgent` 串行 limit（cache 命中 no-op）；pre-send 阻断与 context footer 语义不变。
- **接口**：内部新增 `POST /api/sdk-warmup`（Electron HTTP 网关）；无 proto/DB 变更。
- **非目标未做**：`agent.send` 本体优化（C1）；历史超限文件（`daemon-manager.ts` 等）结构性拆分。

### 3.1 Ponytail 技术债

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| — | 本次 diff **无** 新增 `ponytail:` 注释 | — |
| `src/daemon/daemon.ts:713` | **既有** `ponytail: T7 单条顺序 dispatch…` | 非本变更新增 |
| 04-review §3·4 | Ponytail 精简轴：**Lean already. Ship.** | `context-usage-model-limit.ts` 拆分已批准；`/api/sdk-warmup` 为跨进程必要，非 yagni |

---

## 4、知识库影响清单

> 来源：`02-design.md` §十；按实现修正，供 archive 步骤 6（kb-librarian）消费。manifest 当前标记 `planned`。

### （一）必须更新

- [x] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — 冷启动并行时序（create ∥ limit）；A1 启发式 cache + 后台 `models.list`；A3 `buildSendOptions` bootstrap 复用与 `launchBootstrapDone`；B1 `warmupSdkAfterBind` 三挂点与 `[sdk_warmup]` 日志；**补充** `POST /api/sdk-warmup` 跨进程端点（R3）

### （二）可能更新（视 kb-librarian 细化）

- [x] `knowledge/业务域/Agent调度/03-启动与自动重连.md` — B2 三态进度文案（连接 / 准备 / 处理中）与 orchestrator 段落；B1 bind 后预热一句
- [x] `knowledge/业务域/Agent调度/00-README.md` — 若 06 结构性变更导致阅读路径变化则补一句摘要

### （三）不需要更新

- [x] `knowledge/知识索引.md` — 总入口未变化
- 飞书通道、消息桥接域（无卡片/layout 变更）
- `knowledge/工程平台/**`（无构建/部署变更）
- `10-SDK上下文保护与失败归因.md`（pre-send 逻辑不变）

---

## 5、评审债务（归档可接受）

| ID | 严重度 | 摘要 | 处置 |
|----|--------|------|------|
| R1 | warning | `daemon-presentation-handlers.ts` 338 行超 AGENTS ≤300 | `accepted_debt`；归属 `20260711203953-巨型单体拆分`；本期仅改一行文案 |
| R2 | warning | 冷门 model 首条 `contextLimitTokens` 可能暂缺直至后台 list 完成 | `accepted_debt`；02 §八·（一）已披露；composer 主路径不受影响 |
| R3 | info | `completeBind` 经 `POST /api/sdk-warmup` 间接预热，设计未显式列端点 | `accepted_debt`；archive 步骤 6 在 06 文档补端点说明 |

04-review 结论：**通过**，可进入 `/kb-archive`。

---

## 6、待验证项（发布 checklist）

> 静态/构建已由 `06-automation-test.md` 本轮执行；以下须运行态或 IM 点验，**不阻断 archive 文档步骤**，归发布前执行。

| 场景 ID | 要点 | 状态 |
|---------|------|------|
| **E1** | composer 新 session 首条：入队→RUNNING 较基线 ~25s 减少 ≥8s | 📋 待发布点验 |
| **E2** | `models.list` 与 `create` 并行；不出现 create 后同步阻塞 ~5s 再 send | 📋 待发布点验 |
| **E3** | 同次 launch 仅一条 `bootstrapSdkPluginWorkspace` detailed config | 📋 待发布点验 |
| **E4** | bind 后日志 `[sdk_warmup] source=init\|bind-electron\|bind-daemon`；失败不阻断 bind | 📋 待发布点验 |
| **E5** | 飞书 IM 先后可见「正在连接 Agent…」「正在准备模型…」 | 📋 待发布点验 |
| **E6** | 热 session 二次发信、context footer、`context_blocked` spot check | 📋 待发布点验 |

**观测指引**：`daemon/daemon.log` 或 UI `[SDK]` 日志；关键词见 `06-automation-test.md` §4.4。基线对照 01 §一 19:58 时间戳段。
