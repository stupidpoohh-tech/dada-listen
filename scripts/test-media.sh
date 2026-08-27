#!/usr/bin/env bash
# 미디어 엔드포인트 종단 테스트.
# fake-neon 스텁과 wrangler dev(로컬 R2)를 띄우고 worker/tests/media.test.mjs 를 돌린다.
set -euo pipefail

cleanup() { kill ${NEON_PID:-} ${WRANGLER_PID:-} 2>/dev/null || true; }
trap cleanup EXIT

npm run build >/dev/null

node worker/tests/fake-neon.mjs >/dev/null 2>&1 &
NEON_PID=$!

npx wrangler dev --local --port 8790 \
  --var MEDIA_TOKEN_SECRET:testsecret123 \
  --var NEON_DATA_API_URL:http://127.0.0.1:8999 >/dev/null 2>&1 &
WRANGLER_PID=$!

# Worker 가 뜰 때까지 기다린다
for i in $(seq 1 40); do
  if curl -sf --noproxy '*' -o /dev/null http://127.0.0.1:8790/api/health; then break; fi
  sleep 1
done

node worker/tests/media.test.mjs
