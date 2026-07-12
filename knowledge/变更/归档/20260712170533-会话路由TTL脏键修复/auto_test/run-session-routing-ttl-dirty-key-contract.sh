#!/usr/bin/env bash
# 会话路由 TTL 脏键修复 — 契约冒烟（静态 + persist 脏键/prune）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../../../../.." && pwd)"
HOOK="${ROOT}/knowledge/变更/归档/20260711232258-四引擎 Engine Port 与 RunLifecycle 抽象/auto_test/electron-import-hook.mjs"
cd "$ROOT"
exec node --import "$HOOK" --import tsx "${SCRIPT_DIR}/run-session-routing-ttl-dirty-key-contract.mts"
