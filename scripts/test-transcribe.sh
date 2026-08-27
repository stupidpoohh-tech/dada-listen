#!/usr/bin/env bash
# 전사 파이프라인 종단 테스트.
# fake-neon(인증) + fake-deepgram(전사) + wrangler dev(로컬 R2) 를 띄우고 돌린다.
set -euo pipefail

cleanup() { kill ${NEON_PID:-} ${DG_PID:-} ${WRANGLER_PID:-} 2>/dev/null || true; }
trap cleanup EXIT

npm run build >/dev/null

node worker/tests/fake-neon.mjs >/dev/null 2>&1 &
NEON_PID=$!
node worker/tests/fake-deepgram.mjs >/dev/null 2>&1 &
DG_PID=$!

npx wrangler dev --local --port 8790 \
  --var MEDIA_TOKEN_SECRET:testsecret123 \
  --var NEON_DATA_API_URL:http://127.0.0.1:8999 \
  --var DEEPGRAM_URL:http://127.0.0.1:8998/v1/listen \
  --var DEEPGRAM_API_KEY:fake-key >/dev/null 2>&1 &
WRANGLER_PID=$!

for i in $(seq 1 40); do
  if curl -sf --noproxy '*' -o /dev/null http://127.0.0.1:8790/api/health; then break; fi
  sleep 1
done

node worker/tests/transcribe.test.mjs
