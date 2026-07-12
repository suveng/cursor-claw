#!/usr/bin/env bash
# 多引擎 MCP 设置实质化契约冒烟（静态 + mock + 临时 Daemon HTTP）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../../../../.." && pwd)"
HOOK="${ROOT}/knowledge/变更/归档/20260711232258-四引擎 Engine Port 与 RunLifecycle 抽象/auto_test/electron-import-hook.mjs"
cd "$ROOT"
if [[ ! -f "$HOOK" ]]; then
  HOOK="${ROOT}/knowledge/变更/进行中/20260711232258-四引擎 Engine Port 与 RunLifecycle 抽象/auto_test/electron-import-hook.mjs"
fi
echo "tsc --noEmit …"
npx tsc --noEmit -p tsconfig.json
echo "tsc emit (build:mcp) …"
npm run build:mcp --silent 2>/dev/null || npm run build:mcp
echo "build:bundle …"
npm run build:bundle --silent 2>/dev/null || npm run build:bundle
exec node --import "$HOOK" --import tsx "${SCRIPT_DIR}/run-mcp-settings-contract.mts"
