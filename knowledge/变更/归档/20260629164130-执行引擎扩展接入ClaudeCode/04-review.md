# 执行引擎扩展接入ClaudeCode - 代码评审报告（复评）

## 1、审查范围
- **变更类型**: apply 产出的未提交变更（复评：T-FIX-01/02/03/04 修复后）
- **评审等级**: focused-review（主要 critical 问题已在首轮修复，本轮聚焦修复质量验证与新增问题扫描）
- **涉及文件**: 18 个文件（12 个修改 + 6 个新增 + package.json/lock）
- **设计文档**: 02-design.md（对照基准）、03-tasks.md（验收标准）
- **风险评估**: 中等——新 CC 执行引擎已完成拆分，主要 critical 问题已修复，本轮重点为 guard 泄漏路径复核与 Ponytail 警告状态

---

## 2、严重（必须处理）

无

---

## 3、警告（建议处理）

1. **CC_MODELS 与 CLAUDE_CODE_MODEL_LIST 不同步：聊天命令模型列表少 2 项**
   - 位置: `electron/command-handler.ts:31-35`
   - 说明: `CC_MODELS` 硬编码 3 个模型（`claude-opus-4-8`、`claude-sonnet-4-6`、`claude-haiku-4-5`），而 `electron/agent-cc-types.ts` 的 `CLAUDE_CODE_MODEL_LIST` 有 5 项（含 `claude-opus-4-7`、`claude-opus-4-6`）。用户在聊天窗口用 `/model ls` 切换模型时只看到 3 项，设置面板展示 5 项，体验不一致。
   - 修复方向: 将 `CC_MODELS` 替换为 `import { CLAUDE_CODE_MODEL_LIST } from "./agent-cc-types"` 直接复用，消除重复维护。

---

## 4、设计偏差

1. **`ensureClaudeCodeHttpServer` 创建独立 HTTP server，未复用现有实例**（延续首轮 §4.1，已知偏差）
   - 设计预期: 设计 §4.2 说"共用同一 HTTP 服务器实例（不同路径前缀）"
   - 实际实现: `listen(0)` 分配独立随机端口，写入 `cc-agent-api-port.json`
   - 影响: 功能正常，与 agent-sdk.ts 独立端口模式一致，无实际风险。建议归档时在 02-design.md §4.2 补充说明。

2. **设计 §4.2/§4.3 伪代码与实现存在残留描述差异**（延续首轮 §4.2，已知偏差）
   - 设计预期: §4.2/§4.3 伪代码含 `api_key: resource.apiKey, base_url: resource.baseUrl`
   - 实际实现: `launchBody` 不含这两字段；`launchCcAgentFromHttp` 从 `channel_id` 解析，更安全
   - 影响: 实现正确，设计文档存在残留错误描述，建议归档时更正。

---

## 5、验收标准检查

| 任务 | 验收条件 | 状态 |
|------|---------|------|
| T1 | AgentResource.type 包含 "claude-code"，编译无报错 | ✅ |
| T1 | AgentResource 含 baseUrl? 和 model? | ✅ |
| T1 | newClaudeCodeResourceId() 返回 cc_ 开头 12 位字符串 | ✅ |
| T1 | 现有 cli/sdk 逻辑不受影响 | ✅ |
| T2 | claude-sonnet-4-6 时不调用 Cursor.models.list | ✅ |
| T2 | cursor-small 等非 Claude 模型行为不变 | ✅ |
| T3 | TypeScript 编译无报错 | ✅（env.d.ts 已补全声明，T-FIX-01 修复）|
| T3 | isClaudeCodeSessionRunning 无活跃 session 时返回 false | ✅ |
| T3 | ensureClaudeCodeHttpServer() 幂等 | ✅ |
| T3 | launchCcAgentFromHttp 从 channel_id 解析 apiKey/baseUrl | ✅ |
| T3 | checkClaudeCodeApiKey 对无效 key 返回 {ok:false, error} | ✅ |
| T3 | 无 @cursor/sdk import | ✅ |
| T4 | claude-code 类型返回非空模型列表 | ✅ |
| T4 | sdk 原有分支不受影响 | ✅ |
| T5 | Renderer 调用 checkCcApiKey 返回正确结构 | ✅（T-FIX-01 修复）|
| T5 | Renderer 调用 listCcModels 返回非空数组 | ✅（T-FIX-01 修复）|
| T5 | 现有 sdk handlers 不受影响 | ✅ |
| T6 | claude-code 路由 POST 到 /api/cc/agent/launch | ✅ |
| T6 | sdk 原路径行为不变 | ✅ |
| T6 | stopAllSessionAgents() 停止两引擎 | ✅ |
| T-FIX-01 | env.d.ts 补全 AgentResource.type "claude-code" 及新字段 | ✅ 确认 |
| T-FIX-01 | ElectronAPI 声明 checkCcApiKey / listCcModels | ✅ 确认 |
| T-FIX-02 | broadcastCcSessionStatus 传 "claude-code" 分区键 | ✅ 确认 |
| T-FIX-02 | SessionSource 扩展含 "claude-code" | ✅ 确认 |
| T-FIX-04 | guard 失败时 pendingDispatch 立即重置 | ✅ 确认 |
| T-FIX-04 | finally 块释放 runGuard（异常路径）| ✅ 确认 |
| T-FIX-04 | baseUrl 为空时显式 delete ANTHROPIC_BASE_URL | ✅ 确认 |
| T-FIX-03 | 全部 6 个文件 ≤300 行 | ✅ 确认（最大 293 行）|
| T-FIX-03 | 对外接口通过 re-export 保持兼容 | ✅ 确认 |
| T-FIX-03 | 无循环依赖 | ✅ 确认 |

---

## 6、调用链与回归风险

```
session-dispatcher.ts
  └─► launchCcAgentFromHttp (agent-cc-http.ts)
        └─► launchClaudeCodeAgent (agent-claude-sdk.ts)
              ├─► buildSpawnEnv / buildSpawnArgs (agent-cc-utils.ts)
              ├─► armCcWatchdog → completeCcRun (agent-cc-stream.ts)
              └─► streamCcEvents → appendStreamDelta / postPresentationEvent (agent-cc-events.ts)
```

拆分后依赖方向单向（无循环），`agent-cc-http.ts` 通过依赖注入避免 http→sdk 反向依赖，调用链结构健康。

---

## 7、遗留债务

（50-74 分，不阻断 archive；按需在后续迭代处理）

1. **R-W3 (shrink: abortController 是死代码)**
   - 位置: `agent-cc-types.ts:59`（字段声明）、`agent-claude-sdk.ts:99,216`（初始化/abort）、`agent-cc-utils.ts:114`（重置）
   - `.signal` 从未传给 spawn/fetch/Promise，abort() 等同空操作
   - 可删：字段声明 + 初始化 + 重置 + abort 调用共约 4 行

2. **R-W4 (stdlib: checkClaudeCodeApiKey 手写 65 行 https.request)**
   - 位置: `electron/agent-cc-http.ts:49-113`
   - Electron + Node 18+ 具备 global fetch()，可压缩至约 15 行（节省约 50 行）

3. **R-W5 (shrink: launch/dispatch 重复 spawn 逻辑)**
   - 位置: `electron/agent-claude-sdk.ts:136-155`（launch）vs `183-198`（dispatch）
   - 差异仅 log 文字，可提取 spawnCcChild 公共函数合并（节省约 12-14 行）

---

## 8、修复任务建议

| 问题 ID | 建议动作 | 关联任务 |
|---------|----------|----------|
| R-N3 | 在 `electron/command-handler.ts` 删除 `CC_MODELS` 硬编码，改为 `import { CLAUDE_CODE_MODEL_LIST } from "./agent-cc-types"` | T-FIX-05 |

---

## 9、结论

**未通过，R-N3 需修复后再归档。**

1 个警告（R-N3, 75 分）：`command-handler.ts` 硬编码 3 项模型列表与 `agent-cc-types.ts` 的 5 项不同步，导致聊天命令与设置面板模型选项不一致。修复方式简单（import 替换硬编码），建议作为 T-FIX-05 执行后重新归档。

遗留债务 R-W3/R-W4/R-W5（Ponytail，50-74 分）不阻断归档，可在后续迭代处理。
