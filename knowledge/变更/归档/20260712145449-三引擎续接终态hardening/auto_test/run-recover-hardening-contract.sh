#!/usr/bin/env bash
# 三引擎续接终态 hardening — ST-R1～ST-R6 契约冒烟 + tsc
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
exec node --import "$HOOK" --import tsx "${SCRIPT_DIR}/run-recover-hardening-contract.mts"
