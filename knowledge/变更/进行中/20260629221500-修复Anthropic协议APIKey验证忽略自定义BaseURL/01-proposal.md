# 修复 Anthropic 协议 API Key 验证忽略自定义 BaseURL

> **变更 ID**：`20260629221500-修复Anthropic协议APIKey验证忽略自定义BaseURL`
> **来源**：kb-propose
> **类型**：bugfix
> **优先级**：high
> **外部 PRD**：无
> **Figma 设计图**：无
> **任务记录**：无

## 问题描述

用户在 Claude Code Profile 中配置了自定义 BaseURL（代理地址）和 Anthropic API Key 后，点击验证时报错：

> API Key 无效: Request not allowed

## 根因分析

`checkClaudeCodeApiKey`（`electron/agent-cc-http.ts`）函数签名为：

```ts
async function checkClaudeCodeApiKey(apiKey: string)
```

函数内部将 baseUrl **硬编码**为 `https://api.anthropic.com`，完全忽略用户在 Profile 中配置的自定义 BaseURL。

当用户通过代理地址访问 Anthropic API 时：

1. 实际 Agent 启动走 `buildSpawnEnv`，会正确设置 `ANTHROPIC_BASE_URL`，能正常工作。
2. 但 UI 的「验证 Key」操作只传 `apiKey`，验证请求绕开代理直接打到 `api.anthropic.com`。
3. `api.anthropic.com` 在某些网络环境下返回 `403 Request not allowed`，导致用户误以为 Key 无效。

## 影响范围

- 所有在 Claude Code Profile 中配置了自定义 BaseURL 的用户
- 验证逻辑与实际运行逻辑不一致，造成误报

## 期望行为

- 验证时应使用用户配置的 BaseURL（如有），与 Agent 实际运行保持一致。
- 若 BaseURL 为空，则沿用默认 `https://api.anthropic.com`。

## 变更范围

| 文件 | 改动说明 |
|------|---------|
| `electron/agent-cc-http.ts` | `checkClaudeCodeApiKey` 增加可选参数 `baseUrl?: string`，验证请求使用该地址 |
| `electron/main.ts` | IPC handler `cc:check-api-key` 透传 `baseUrl` 参数 |
| `src/renderer/env.d.ts` | 更新 `checkCcApiKey` 类型签名，增加 `baseUrl?: string` 参数 |
| `src/renderer/components/AgentPanel.tsx` | 调用 `checkCcApiKey` 时传入 `editingCc.baseUrl` |

## 验收标准

1. 配置了自定义 BaseURL 的用户，点击验证时请求走代理地址，不再报 "Request not allowed"。
2. 未配置 BaseURL 时，行为与修复前一致，默认访问 `https://api.anthropic.com`。
3. BaseURL 填写了无效地址时，验证返回合理的连接错误（不引入新的崩溃）。
4. TypeScript 编译无新增错误。
