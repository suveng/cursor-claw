#!/usr/bin/env bash
# D3 契约冒烟：终态 notify / RunLifecycle / guard busy（mock httpPost，无需 daemon）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../.." && pwd)"
HOOK="${ROOT}/knowledge/变更/进行中/20260711232258-四引擎 Engine Port 与 RunLifecycle 抽象/auto_test/electron-import-hook.mjs"
SCRIPT="${ROOT}/knowledge/变更/进行中/20260711232258-四引擎 Engine Port 与 RunLifecycle 抽象/auto_test/run-notify-contract.mts"
cd "$ROOT"
exec node --import "$HOOK" --import tsx "$SCRIPT"
