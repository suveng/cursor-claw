# 修复 Anthropic 协议 API Key 验证忽略自定义 BaseURL - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）

## 1、执行计划

### 1.1 依赖图

```
T1 ──→ T2 ──→ T3
```

### 1.2 分组调度

- **第一轮**: T1（主进程核心函数）
- **第二轮**: T2（IPC 桥接签名，依赖 T1 的函数契约）
- **第三轮**: T3（UI 调用层，依赖 T2 的类型声明）

## 2、任务清单

---

## T1: 修改 checkClaudeCodeApiKey 支持自定义 BaseURL

### 背景
`checkClaudeCodeApiKey` 是 API Key 验证的核心函数，当前硬编码 `https://api.anthropic.com` 作为验证地址，导致配置了自定义 BaseURL（代理）的用户验证失败。本任务为函数增加可选 `baseUrl` 参数，修复核心逻辑。

### 上下文文件
- 必读: `electron/agent-cc-http.ts` — 待修改的目标函数（第 49-110 行），重点看第 54-55 行的硬编码 URL 和第 64-66 行的 https.request 构造
- 参考: `electron/agent-claude-sdk.ts` — `buildSpawnEnv(apiKey, baseUrl?)` 约第 257 行，已有相同可选 baseUrl 参数模式可对照

### 实现范围
- 修改: `electron/agent-cc-http.ts`
  - 函数签名第 49 行：`checkClaudeCodeApiKey(apiKey: string)` → `checkClaudeCodeApiKey(apiKey: string, baseUrl?: string)`
  - 函数体第 54 行：将 `const baseUrl = "https://api.anthropic.com"` 改为 `const effectiveBaseUrl = baseUrl?.trim() || "https://api.anthropic.com"`
  - 第 55 行：`const url = \`${baseUrl}/v1/messages\`` → `const url = \`${effectiveBaseUrl}/v1/messages\``
  - 第 65 行 https.request 的 `port: 443` → `port: urlObj.port ? parseInt(urlObj.port) : 443`（兼容自定义端口）

### 接口契约
- `export async function checkClaudeCodeApiKey(apiKey: string, baseUrl?: string): Promise<{ ok: boolean; error?: string }>` — T2 的 IPC handler 将调用此签名

### 验收标准
- [ ] 函数签名增加 `baseUrl?: string` 可选参数
- [ ] 有 baseUrl 时请求打向 `${baseUrl}/v1/messages`；无 baseUrl 时行为与修复前一致（打 `https://api.anthropic.com/v1/messages`）
- [ ] `https.request` 的 `port` 使用 `urlObj.port ? parseInt(urlObj.port) : 443`（不再硬编码 443）
- [ ] TypeScript 编译无新增错误（函数内部无 `baseUrl` 命名冲突）
- [ ] 无新增抽象层、新文件或未批准依赖（Ponytail 口径）

### 依赖
- 前置任务: 无
- 后续任务: T2

---

## T2: 更新 IPC 桥接链路透传 baseUrl

### 背景
`checkClaudeCodeApiKey` 在 T1 中增加了 `baseUrl?` 参数，需同步更新三个位置的 IPC 桥接链路：`main.ts` handler、`preload.ts` 封装函数、`env.d.ts` 类型声明。三个文件均为纯签名改动，不含逻辑，可同轮完成。

### 上下文文件
- 必读: `electron/main.ts` — 第 373 行 `ipcMain.handle("cc:check-api-key", ...)` handler
- 必读: `electron/preload.ts` — 第 252 行 `checkCcApiKey` 封装
- 必读: `src/renderer/env.d.ts` — 第 223 行 `checkCcApiKey` 类型声明
- 参考: `electron/main.ts` 第 371 行 `sdk:check-api-key` — 单参数 handler 对照

### 实现范围
- 修改: `electron/main.ts` 第 373 行
  - `ipcMain.handle("cc:check-api-key", (_, apiKey: string) => checkClaudeCodeApiKey(apiKey))`
  - 改为：`ipcMain.handle("cc:check-api-key", (_, apiKey: string, baseUrl?: string) => checkClaudeCodeApiKey(apiKey, baseUrl))`
- 修改: `electron/preload.ts` 第 252 行
  - `checkCcApiKey: (apiKey: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("cc:check-api-key", apiKey)`
  - 改为：`checkCcApiKey: (apiKey: string, baseUrl?: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("cc:check-api-key", apiKey, baseUrl)`
- 修改: `src/renderer/env.d.ts` 第 223 行
  - `checkCcApiKey(apiKey: string): Promise<{ ok: boolean; error?: string }>`
  - 改为：`checkCcApiKey(apiKey: string, baseUrl?: string): Promise<{ ok: boolean; error?: string }>`

### 接口契约
- `checkCcApiKey(apiKey: string, baseUrl?: string): Promise<{ ok: boolean; error?: string }>` — T3 的 UI 调用方将使用此类型

### 验收标准
- [ ] `main.ts` handler 签名含 `baseUrl?: string` 并透传给 `checkClaudeCodeApiKey`
- [ ] `preload.ts` `checkCcApiKey` 接受并透传 `baseUrl?`
- [ ] `env.d.ts` 类型声明与 `preload.ts` 实现一致
- [ ] 未传 `baseUrl` 时（如旧调用方）IPC 行为不变（向后兼容）
- [ ] TypeScript 编译无新增错误
- [ ] 无新增抽象层或新文件（Ponytail 口径）

### 依赖
- 前置任务: T1
- 后续任务: T3

---

## T3: AgentPanel 验证时传入 baseUrl

### 背景
UI 层的「验证」按钮触发 `handleCcVerify`，当前只传 `apiKey`，需同步传入 `editingCc.baseUrl`，使验证请求与实际 Agent 启动使用相同的网络路径，彻底修复用户可见的 bug。

### 上下文文件
- 必读: `src/renderer/components/AgentPanel.tsx` — 第 180-190 行 `handleCcVerify` 函数，第 185 行为待修改目标
- 参考: `src/renderer/env.d.ts` 第 223 行 — 确认 `checkCcApiKey` 已接受 `baseUrl?`（T2 产出）

### 实现范围
- 修改: `src/renderer/components/AgentPanel.tsx` 第 185 行
  - `window.electronAPI.checkCcApiKey(editingCc.apiKey.trim())`
  - 改为：`window.electronAPI.checkCcApiKey(editingCc.apiKey.trim(), editingCc.baseUrl?.trim() || undefined)`

### 接口契约
- 无对外暴露的新接口（终端调用方）

### 验收标准
- [ ] `handleCcVerify` 调用 `checkCcApiKey` 时传入 `editingCc.baseUrl?.trim() || undefined`
- [ ] 配置了自定义 BaseURL 时，验证请求经由代理地址，不再返回 "Request not allowed"（对应 01 §验收标准 AC-1）
- [ ] 未配置 BaseURL 时，`baseUrl` 参数为 `undefined`，行为与修复前一致（AC-2）
- [ ] TypeScript 编译无新增错误（AC-4）
- [ ] 无新增抽象层或组件（Ponytail 口径）

### 依赖
- 前置任务: T2
- 后续任务: 无
