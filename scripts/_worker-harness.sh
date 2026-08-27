#!/usr/bin/env bash
# Worker 종단 테스트용 공통 준비.
#
# 스테일 프로세스가 남아 있으면 테스트가 옛 Worker 를 때린다. 그러면 엉뚱한
# 이유로 통과하거나(예: 권한 검사 대신 설정 누락으로 거부) 지난 실행의 R2
# 결과가 남아 실패한다. 실제로 그 일이 있었으므로 여기서 못 하게 막는다.

PORT_WORKER=8790
PORT_NEON=8999
PORT_DEEPGRAM=8998

harness_require_free_ports() {
  for p in "$@"; do
    if curl -sf --noproxy '*' -o /dev/null -m 2 "http://127.0.0.1:$p/" 2>/dev/null; then
      echo "포트 $p 를 이미 누가 쓰고 있습니다." >&2
      echo "이전 테스트의 wrangler/스텁이 남아 있을 수 있습니다. 정리한 뒤 다시 돌리세요:" >&2
      echo "  ps aux | grep -E 'wrangler|workerd|fake-' " >&2
      exit 1
    fi
  done
}

# 실행마다 새 상태 디렉터리를 쓴다. 지난 실행의 R2 오브젝트가 새어들지 않게.
harness_state_dir() {
  mktemp -d "${TMPDIR:-/tmp}/dada-wrangler-XXXXXX"
}

harness_wait_ready() {
  for _ in $(seq 1 60); do
    if curl -sf --noproxy '*' -o /dev/null "http://127.0.0.1:$PORT_WORKER/api/health"; then return 0; fi
    sleep 1
  done
  echo "Worker 가 뜨지 않았습니다. wrangler 로그를 확인하세요." >&2
  return 1
}
