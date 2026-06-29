# 修复Anthropic协议APIKey验证忽略自定义BaseURL - 变更总结

## 1、实际变更

| 文件 | 改动 |
|------|------|
| `electron/agent-cc-http.ts` | `checkClaudeCodeApiKey` 增加 `baseUrl?` 参数；内部改用 `effectiveBaseUrl`；`port` 改从 URL 解析而非硬编码 443 |
| `electron/main.ts` | IPC handler `cc:check-api-key` 增加 `baseUrl?: string` 并透传 |
| `electron/preload.ts` | `checkCcApiKey` 函数签名与 invoke 调用增加 `baseUrl?` |
| `src/renderer/env.d.ts` | `checkCcApiKey` 类型声明同步增加 `baseUrl?` |
| `src/renderer/components/AgentPanel.tsx` | `handleCcVerify` 调用 `checkCcApiKey` 时传入 `editingCc.baseUrl?.trim() \|\| undefined` |

## 2、与设计的差异

设计未明确提及 `port` 解析的变化（从硬编码 443 改为 `urlObj.port ? parseInt(urlObj.port) : 443`）。该改动为隐含必要项：自定义 BaseURL 可能使用非标准端口，正确解析端口是功能正确性的前提。行为完全兼容——官方地址无端口时回退 443。

## 3、影响范围

- **模块**：主进程 API Key 验证逻辑、IPC 桥接层（preload + main）、Renderer AgentPanel 配置面板
- **接口变更**：IPC Channel `cc:check-api-key` 新增可选第二参数 `baseUrl?`（向后兼容）
- **数据结构**：无新增；`baseUrl` 已存在于 `AgentResource`
- **兼容性**：旧调用不传 `baseUrl` 时行为与修改前完全一致

### 3.1 Ponytail 技术债

无

## 4、知识库影响清单

- [x] `knowledge/业务域/Agent调度/`（已确认）— 无 API Key 验证专页，现有文件不含 `checkClaudeCodeApiKey` 行为描述，无需更新
- [x] `knowledge/知识索引.md` — 无结构变更，无需更新
- [x] `knowledge/工程平台/` — 纯内部 IPC 链路修复，非跨域能力，无需更新
