# 飞书私聊去前缀与 Markdown 渲染 - 变更总结

## 实际变更

| 文件 | 说明 |
|------|------|
| `src/daemon/daemon.ts` | `extractWorkspaceTitle` 私聊（p2p）返回 undefined，不再注入工作区名前缀 |
| `src/bridge/lark-core.ts` | `buildOutboundPayload` 默认 `msg_type: post` + `md` 标签；含 @ 标签降级 text |
| `src/bridge/AGENTS.md` | 出站能力说明同步 |
| `knowledge/业务域/消息桥接/02-飞书通道.md` | 出站契约与变更记录同步 |
| `package.json` | version → 1.13.14 |
| `changelog/1.13.14.json` | 用户可见变更条目 |

**用户可见**：飞书私聊回复不再带工作区目录名前缀；Agent 回复默认 Markdown 渲染（代码块、列表等）。

## 知识库更新清单

- [x] `knowledge/业务域/消息桥接/02-飞书通道.md`
- [ ] 总索引无需更新（未增删领域入口）

## 两级索引

未新增/删除/重命名目录入口，无需更新 `knowledge/知识索引.md`。

## 版本

- patch bump：`1.13.13` → `1.13.14`
