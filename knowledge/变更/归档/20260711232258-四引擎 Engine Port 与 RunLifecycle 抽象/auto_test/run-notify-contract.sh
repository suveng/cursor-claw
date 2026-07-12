#!/usr/bin/env bash
# D3 契约冒烟：终态 notify / RunLifecycle / guard busy（mock httpPost，无需 daemon）
set -euo pipefail
# 相对本脚本目录解析，归档/进行中迁移后路径仍有效
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../../../../.." && pwd)"
HOOK="${SCRIPT_DIR}/electron-import-hook.mjs"
SCRIPT="${SCRIPT_DIR}/run-notify-contract.mts"
cd "$ROOT"
exec node --import "$HOOK" --import tsx "$SCRIPT"
