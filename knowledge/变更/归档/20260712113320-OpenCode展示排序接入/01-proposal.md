# OpenCode展示排序接入产品需求文档

> **变更 ID**：`20260712113320-OpenCode展示排序接入`
> **来源**：kb-propose
> **类型**：建议「体验优化」（待闸门确认）
> **优先级**：建议 P2（待闸门确认）
> **外部 PRD**：无
> **Figma 设计图**：无
> **任务记录**：无

## 一、背景与问题

Presentation 展示时序编排已为 Cursor、Claude Code 等接入过程内 assistant 延迟与 thinking/tool 闩，避免工具执行中正文抢屏。OpenCode 已接四引擎 Port，但展示排序门控未接入流式路径，用户体感乱序推送。

## 二、用户可见症状

- 工具未结束正文已单独成卡
- thinking/tool 与 stream 交错
- 与同会话其他引擎排序不一致
- 关闭排序开关时 OpenCode 回滚行为未对齐

## 三、目标与非目标

**目标**：OpenCode 接入与其他引擎一致的展示排序；门控下 defer/release 可验收；关闭时直通；不改执行语义与终态契约。

**非目标**：不重做 Port/RunLifecycle、队列、合并卡、新 UI；不扩展 MVP 门控范围。

## 四、用户与场景

多轮 tool 中正文不抢首屏；idle 后释放 deferred 正文；与 Cursor 体感一致；排序关闭仍正常推送；终态 IM 符合统一契约。

## 五、功能需求

| 编号 | 需求 |
|------|------|
| R1 | OpenCode 流式出站接入展示排序门控 |
| R2 | 过程活跃 defer assistant，idle release |
| R3 | thinking/tool/task 参与闩语义 |
| R4 | 门控不满足时直通 |
| R5 | 不改变 Run 终态通知 |

## 六、验收标准

1. 门控范围内 tool 执行中无 assistant 抢首屏
2. idle 后 deferred 正文正确释放
3. 与 Cursor 同场景排序体感一致
4. 排序关闭无卡死、无丢终态
5. 四引擎 Port 归档项无回归

## 七、范围边界

**在范围**：OpenCode 排序门控与 Presentation 协同。**不在范围**：Port 重写、队列、合并卡。

## 八、风险与依赖

- **依赖**四引擎 Port 归档稳定
- **SSE 映射** 门控触发须对齐语义
- **死锁** 异常终态须 release

## 九、知识库影响初评

OpenCode 引擎 §九（高）；IM 顺序优化（中）；Cursor/CC 对照（低）。
