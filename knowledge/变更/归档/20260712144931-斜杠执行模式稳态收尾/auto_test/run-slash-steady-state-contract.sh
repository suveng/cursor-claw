#!/usr/bin/env bash
# 斜杠执行模式稳态收尾契约冒烟（静态 + mock + 临时 Daemon HTTP）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../../../../.." && pwd)"
HOOK="${ROOT}/knowledge/变更/归档/20260711232258-四引擎 Engine Port 与 RunLifecycle 抽象/auto_test/electron-import-hook.mjs"
cd "$ROOT"
if [[ ! -f "$HOOK" ]]; then
  HOOK="${ROOT}/knowledge/变更/进行中/20260711232258-四引擎 Engine Port 与 RunLifecycle 抽象/auto_test/electron-import-hook.mjs"
fi
# ST-S6：TypeScript 编译检查 + 产出 dist（bundle 入口依赖 dist/）
echo "tsc --noEmit …"
npx tsc --noEmit -p tsconfig.json
echo "tsc emit (build:mcp) …"
npm run build:mcp --silent 2>/dev/null || npm run build:mcp
# 契约脚本（含 ST-S1～S7 可自动化项）；bundle 须含本变更默认 daemon
echo "build:bundle …"
npm run build:bundle --silent 2>/dev/null || npm run build:bundle
exec node --import "$HOOK" --import tsx "${SCRIPT_DIR}/run-slash-steady-state-contract.mts"
