#!/usr/bin/env bash
set -euo pipefail
PORT="${SKILL_FLOW_PORT:-8788}"
if command -v npx >/dev/null 2>&1 && [ -f package.json ]; then
  npx skill-flow doctor
else
  curl -fsS "http://127.0.0.1:${PORT}/health"
  echo
fi
