#!/usr/bin/env bash
# 消息队列模块拆分 — ST-Q1～Q7 契约冒烟 + tsc
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../../../../.." && pwd)"
HOOK="${ROOT}/knowledge/变更/归档/20260711232258-四引擎 Engine Port 与 RunLifecycle 抽象/auto_test/electron-import-hook.mjs"
cd "$ROOT"
if [[ ! -f "$HOOK" ]]; then
  HOOK="${ROOT}/knowledge/变更/进行中/20260711232258-四引擎 Engine Port 与 RunLifecycle 抽象/auto_test/electron-import-hook.mjs"
fi
exec node --import "$HOOK" --import tsx "${SCRIPT_DIR}/run-file-queue-split-contract.mts"
