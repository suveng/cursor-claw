# 通道编辑 Agent 资源与模型联动产品需求文档

> **变更 ID**：`20260629231225-通道编辑Agent资源模型按类型联动`
> **来源**：kb-propose
> **类型**：缺陷修复
> **优先级**：P2
> **外部 PRD**：无
> **Figma 设计图**：无
> **任务记录**：无

## 背景

cursor-claw 在接入 Claude Code SDK 后，IM 通道（飞书、微信等）可绑定三类 Agent 资源：Cursor CLI、Cursor SDK、Claude Code Profile。Claude Code 的模型与鉴权在 Profile 层统一配置，通道仅需选择要绑定的 Profile。

当前设置页「通道编辑」弹窗中，「Agent 资源与模型」区块未随所选资源类型区分模型配置方式。管理员为通道绑定 Claude Code Profile 时，界面仍提供与 Cursor 相关的「获取模型列表」能力，并展示 Cursor 侧模型选项，与 Profile 已配置模型的实际执行方式不一致，易造成误配与困惑。

同类场景在「任务编辑」中已按 Claude Code 类型单独处理模型来源，通道编辑尚未对齐。

## 目标

1. 通道编辑时，「Agent 资源与模型」区块随所选 Agent 资源类型即时联动，展示与操作符合该类型的模型配置规则。
2. 绑定 Claude Code Profile 时，不在通道级提供「获取模型列表」；执行所用模型以 Profile 的默认模型为准（Profile 未填写默认模型时，由 Claude Code SDK 使用其内置默认）。
3. 切换 Agent 资源类型时，模型相关展示与可执行操作即时更新，不残留上一类型的选项或误导性入口。

## 非目标

- 不改动 Claude Code Profile 的新建、编辑、删除及 Profile 内「默认模型」字段的管理方式。
- 不改动 Agent 执行引擎的路由与 Run 生命周期逻辑。
- 不改动 IM 通道连接层（飞书/微信 WebSocket、消息收发等）。

## 用户故事

**管理员视角**：

- 作为管理员，我在编辑通道并选择 Cursor CLI 或 Cursor SDK 资源时，希望仍能像在以往一样在通道级配置主模型、其他人模型，并能获取可用模型列表，以便按通道差异化选型。
- 作为管理员，我在编辑通道并选择 Claude Code Profile 时，希望界面明确模型由 Profile 管理，不出现 Cursor 模型列表或「获取模型列表」入口，避免误以为需在通道层再选一次 Claude 模型。
- 作为管理员，我在同一编辑弹窗内切换 Agent 资源类型时，希望模型相关区域立即切换为对应类型的正确形态，不出现上一类型的残留选项或错误提示。

## 功能需求

### F1：Cursor CLI / Cursor SDK 保持通道级模型配置

- 通道绑定 Cursor CLI 或 Cursor SDK 资源时，保留现有通道级主模型、其他人模型配置能力。
- 保留「获取模型列表」能力，列表内容应对应 Cursor 侧可用模型，供管理员选择。
- 保存通道配置后，执行行为与变更前一致。

### F2：Claude Code Profile 不在通道级拉取模型列表

- 通道绑定 Claude Code Profile 时，通道编辑界面不展示「获取模型列表」入口或等价操作。
- 界面应说明或隐含：模型以所选 Profile 的默认模型为准；Profile 未配置默认模型时，执行时使用 Claude Code SDK 默认模型。
- 不在通道级提供与 Cursor 模型列表混用的下拉或选择器。

### F3：切换资源类型时模型区块即时联动

- 在通道编辑弹窗内切换 Agent 资源类型（Cursor CLI / Cursor SDK / Claude Code Profile）时，「Agent 资源与模型」相关展示与可操作项应立即切换，无需关闭弹窗或重新打开。
- 从 Cursor 类型切换到 Claude Code 时，应清除或隐藏不再适用的通道级模型选择与列表状态，避免展示误导性 Cursor 模型项。
- 从 Claude Code 切换回 Cursor 类型时，应恢复通道级模型配置与「获取模型列表」能力；若通道此前有已保存的 Cursor 模型配置，应正确回显。

### F4：Agent 资源选项清晰可辨

- Agent 资源下拉（或等价选择控件）应清晰区分 Cursor CLI、Cursor SDK、Claude Code Profile 三类资源，命名与分组便于管理员识别类型，降低误绑风险。

## 验收标准

1. 打开设置页通道编辑，选择 Cursor CLI 或 Cursor SDK 资源：可见通道级主模型、其他人模型配置项，且可使用「获取模型列表」；列表与保存后执行行为与变更前一致。
2. 同一弹窗选择 Claude Code Profile：不出现「获取模型列表」或 Cursor 模型列表下拉；界面体现模型由 Profile 管理（含 Profile 未填默认模型时的默认行为说明或合理留白）。
3. 在编辑弹窗内先后切换 Cursor SDK → Claude Code Profile → Cursor CLI：每次切换后模型相关区域形态正确，无上一类型残留选项、错误列表或失效按钮。
4. Agent 资源选择控件中，三类资源类型可被管理员明确区分（通过文案或分组等方式）。
5. 已保存且绑定 Claude Code Profile 的通道，重新打开编辑弹窗时：不自动触发 Cursor 模型列表获取，展示与 F2 一致。
6. 本变更不改变 Profile 管理页、任务执行、IM 消息收发与执行引擎路由的既有行为（回归：Profile 编辑、任务编辑、通道消息触发 Run 仍正常）。
