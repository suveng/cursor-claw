#!/usr/bin/env bash
# 工作流恢复入口与信号接口 — 轻量契约冒烟（静态 grep/行数 + 可选 Daemon HTTP）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../../../../.." && pwd)"
HOOK="${ROOT}/knowledge/变更/归档/20260711232258-四引擎 Engine Port 与 RunLifecycle 抽象/auto_test/electron-import-hook.mjs"
cd "$ROOT"
if [[ ! -f "$HOOK" ]]; then
  HOOK="${ROOT}/knowledge/变更/进行中/20260711232258-四引擎 Engine Port 与 RunLifecycle 抽象/auto_test/electron-import-hook.mjs"
fi
exec node --import "$HOOK" --import tsx "${SCRIPT_DIR}/run-workflow-resume-contract.mts"
