# Daemon批二拆分 - 变更总结

## 1、实际变更

- `src/daemon/daemon.ts`：薄组装入口（≤200）；`daemonMain` 冷启动顺序组装工厂。
- 新建：`daemon-logging.ts`、`daemon-queue.ts`、`daemon-queue-types.ts`、`daemon-queue-merge.ts`、`daemon-queue-merge-card.ts`、`daemon-queue-merge-action.ts`、`daemon-channel.ts`、`daemon-channel-feishu.ts`、`daemon-channel-wechat.ts`、`daemon-slash-command-router.ts`、`daemon-http-utils.ts`、`daemon-session-maps.ts`、`daemon-wire.ts`、`daemon-bootstrap.ts`。
- `src/daemon/AGENTS.md`、`src/AGENTS.md`：批2 模块职责表与根索引勾销「仍驻枢纽」注记。
- 知识库：Daemon 工程平台概览/README/进程模型；消息桥接 README/微信/队列；Agent 调度 README。

## 2、与设计的差异

无行为偏差。落点命名相对批1 设计草稿：`daemon-feishu-channel` → `daemon-channel` + `daemon-channel-feishu`/`-wechat`；`wireDaemonSubmodules` 迁至 `daemon-wire.ts`，`daemonMain` 后半段迁至 `daemon-bootstrap.ts`（符合枢纽 ≤200，04 已确认）。

## 3、影响范围

- 模块：Daemon 枢纽结构；queue / MergeBatch / channel / logging / slash 路由壳 / wire / bootstrap。
- 接口：对外 HTTP/IM/SSE 契约不变。
- 数据：file-queue 磁盘格式未改。

### 3.1 Ponytail 技术债

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| `src/daemon/daemon-queue-merge-action.ts:63` | 单条顺序 dispatch；取消合并后由 orchestrator 按未合并路径领取 | 若改为并行 dispatch 另立变更 |

## 4、知识库影响清单

- [x] `knowledge/工程平台/Daemon守护进程/01-概览.md` — queue/channel/logging 架构落点
- [x] `knowledge/工程平台/Daemon守护进程/00-README.md` — 源码入口与阅读路径
- [x] `knowledge/工程平台/Daemon守护进程/03-进程模型与部署.md` — `createDaemonLogger` 落点
- [x] `knowledge/业务域/消息桥接/00-README.md` — 勾销批2「仍驻 daemon.ts」注记
- [x] `knowledge/业务域/消息桥接/03-微信通道.md` — 绑定锚点 → `daemon-channel-wechat.ts`
- [x] `knowledge/业务域/消息桥接/04-消息队列与路由.md` — MergeBatch 落点 → `daemon-queue*`
- [x] `knowledge/业务域/Agent调度/00-README.md` — 薄组装锚点；压缩关键源码表至 ≤3000
- [x] `src/daemon/AGENTS.md` — apply 已同步；archive 核对通过
- [x] `knowledge/知识索引.md` — 总入口未变，无需更新

### 4.1 批1 R1 勾销

批1 归档（`20260711203953-巨型单体拆分`）登记的 **accepted_debt R1 / deferred T8～T11（queue/channel/logging 仍驻枢纽）** 已由本变更清偿：`daemon.ts`=200 行；queue/channel/logging 独立模块；**无 open/debt review**；最终走向 `archived`（非 `archived_with_debt`）。

## 5、归档前置说明

- 本文件由 kb-librarian 在步骤 6–7 写入；`manifest.stage` 保持 `reviewed`，目录 mv / stage=`archived` / commit+push 交 **kb-release**。
- `external_sync`: SKIP（无 integrations）。
