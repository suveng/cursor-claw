#!/usr/bin/env bash
# HTTP dispatch 失败重入队对齐 — 静态契约 + retry 模块 mock 冒烟
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../../../../.." && pwd)"
HOOK="${ROOT}/knowledge/变更/归档/20260711232258-四引擎 Engine Port 与 RunLifecycle 抽象/auto_test/electron-import-hook.mjs"
cd "$ROOT"
if [[ ! -f "$HOOK" ]]; then
  HOOK="${ROOT}/knowledge/变更/进行中/20260711232258-四引擎 Engine Port 与 RunLifecycle 抽象/auto_test/electron-import-hook.mjs"
fi
exec node --import "$HOOK" --import tsx "${SCRIPT_DIR}/run-http-dispatch-retry-contract.mts"
