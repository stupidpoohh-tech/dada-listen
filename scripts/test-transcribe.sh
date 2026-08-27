#!/usr/bin/env bash
# 전사 파이프라인 종단 테스트 (Deepgram 스텁).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_worker-harness.sh

STATE=""
trap harness_cleanup EXIT

harness_require_free_ports "$PORT_WORKER" "$PORT_NEON" "$PORT_DEEPGRAM"
STATE=$(harness_state_dir)

npm run build >/dev/null

node worker/tests/fake-neon.mjs >/dev/null 2>&1 &
node worker/tests/fake-deepgram.mjs >/dev/null 2>&1 &

npx wrangler dev --local --port "$PORT_WORKER" --persist-to "$STATE" \
  --var MEDIA_TOKEN_SECRET:testsecret123 \
  --var NEON_DATA_API_URL:"http://127.0.0.1:$PORT_NEON" \
  --var DEEPGRAM_URL:"http://127.0.0.1:$PORT_DEEPGRAM/v1/listen" \
  --var DEEPGRAM_API_KEY:fake-key >"$STATE/wrangler.log" 2>&1 &

harness_wait_ready || { cat "$STATE/wrangler.log" >&2; exit 1; }
node worker/tests/transcribe.test.mjs
