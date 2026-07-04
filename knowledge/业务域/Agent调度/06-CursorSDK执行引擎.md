# Cursor SDK 执行引擎

## 一、能力范围

`@cursor/sdk` 在 Electron 主进程执行 IM/任务/工作流：`Agent.create`、`agent.send`、Presentation、MCP inline+`settingSources`、`agent-api` HTTP。`sdk-run-stream` 消费事件流；`sdk-run-recover` 重启续接。出站：`presentation-event`+`stream-text`。

**不负责**：Daemon 队列、其他引擎（07–09）；Settings 见 [Electron §五](../../工程平台/Electron桌面应用/02-主进程与IPC.md)。

## 二、设计决策与取舍

- **API**：长驻+二次 send；**事件流 SSOT**：`for await (run.stream())` 驱动呈现，`run.wait()` 仅收尾 usage。
- **MCP**：inline HTTP/sse/OAuth；stdio `settingSources`；`Agent.resume` 重传 inline。
- **续接**：`sdk-active-runs.json`；`userStopped` 不再续接。
- **Presentation**：thinking/task 始终 post；tool 分级 notify→mark+post、silent 仅日志；assistant→stream-text（400ms）。飞书抑制→daemon 里程碑；Electron 仍 POST+置闩。
- **PRESENTATION_ORDERING**（p2p+f41）：thinking/notify-tool/task 经 mark 置 defer 闩；抑制≠defer；Daemon `sendMilestoneText` sent 时亦置 `presentationProcessActive`；过程 idle 或闩释放时 flush assistant。

## 三、服务端规则

1. `type:"sdk"`+API Key；模型空→`composer-2`；非超时 error→`failedCooldowns` 30s。
2. **watchdog**：`tool_running`/`awaiting_user`/`lastTool.running` 豁免 idle 取消。
3. **handleSdkEvent**：thinking→mark+post；task→`mapTaskMilestoneText`→**mark**→post（task 只置闩、不单独 release）。**tool_call**：notify→`markProcessEventSeen`+`postPresentationEvent`；silent 仅日志/`lastTool`/runPhase。非 running 时 `maybeReleaseDeferredAssistant`。
4. **markProcessEventSeen**：仅 ordering 门控；thinking/tool/task 均置 defer 闩（不因飞书抑制早退）。Daemon：`sendMilestoneText` sent 时置 `presentationProcessActive`（task 仅该字段）。
5. **maybeReleaseDeferredAssistant**：闩已置时 flush assistant。

## 四、客户端流程

`launchSdkAgent`/`dispatchToSdkAgent`→`startSdkRun`→`streamRunEvents`→`completeSdkRun`；init `recoverSdkActiveRuns`。Settings 四 Tab；Skills project/user 双区块。

```mermaid
flowchart LR
  stream[streamRunEvents] --> pres[presentation-event/stream-text]
  pres --> done[completeSdkRun]
```

## 五、接口

`launchSdkAgent`/`dispatchToSdkAgent`；`POST /api/agent/launch|dispatch`。出站 `presentation-event`（含 `task`）、`stream-text`。

## 六、数据

`SdkSessionAgent`：`runPhase`、`seenProcessEvent`、`presentationDeferStream`、呈现游标。`PresentationEvent` 含 `task_status`/`task_text`。磁盘 `sdk-active-runs.json`。

## 七、非功能与可观测

RunGuard+watchdog；`[tool]`/`[task]` 日志全量；400ms 节流；Run 收尾强制 flush。

## 八、推送

`presentation-event`+`stream-text` 出站。thinking/task 始终 presentation；assistant 仅 stream-text；notify tool 仍 presentation-event；silent 不出站。飞书抑制→`sendMilestoneText`（3s、≤4/Run）。

## 九、已知限制与 TODO

续接依赖 SDK Run；持久化含 apiKey；飞书过程为文本里程碑非 CardKit。

## 十、变更记录

- 2026-07-04：ordering 闩统一（task/飞书里程碑参与 defer；抑制≠defer）（archive 20260704190748）。
- 2026-07-04：SDK 工具调用通知分级；read/glob 等静默；shell/write/delete/Task 仍通知（archive 20260704183752）。
- 2026-07-04：SDK think/task 实时通知；task 独立分支、飞书 daemon 降级（archive 20260704174846）。
- 2026-07-02：Skills、事件流 SSOT、watchdog 续接、MCP 分层（archive 20260701212732–120631）。
- 2026-06-30：十段式；移除 CLI（archive 20260629232914）。
