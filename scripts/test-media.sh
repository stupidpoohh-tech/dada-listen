#!/usr/bin/env bash
# 미디어 엔드포인트 종단 테스트.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_worker-harness.sh

STATE=""
cleanup() {
  kill ${NEON_PID:-} ${WRANGLER_PID:-} 2>/dev/null || true
  [ -n "$STATE" ] && rm -rf "$STATE"
  true
}
trap cleanup EXIT

harness_require_free_ports $PORT_WORKER $PORT_NEON
STATE=$(harness_state_dir)

npm run build >/dev/null

node worker/tests/fake-neon.mjs >/dev/null 2>&1 &
NEON_PID=$!

npx wrangler dev --local --port $PORT_WORKER --persist-to "$STATE" \
  --var MEDIA_TOKEN_SECRET:testsecret123 \
  --var NEON_DATA_API_URL:http://127.0.0.1:$PORT_NEON >/dev/null 2>&1 &
WRANGLER_PID=$!

harness_wait_ready
node worker/tests/media.test.mjs
