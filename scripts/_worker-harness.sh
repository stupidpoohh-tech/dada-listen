#!/usr/bin/env bash
# Worker 종단 테스트용 공통 준비.
#
# 스테일 프로세스가 남아 있으면 테스트가 옛 Worker 를 때린다. 그러면 엉뚱한
# 이유로 통과하거나(예: 권한 검사 대신 설정 누락으로 거부) 지난 실행의 R2
# 결과가 남아 실패한다. 실제로 그 일이 있었으므로 여기서 못 하게 막는다.

PORT_WORKER=8790
PORT_NEON=8999
PORT_DEEPGRAM=8998

# 포트가 비었는지는 HTTP 로 묻지 않는다. 옛 Worker 는 /api/health 에 200 을
# 돌려주므로 "살아 있다" 가 "우리가 띄운 것이다" 를 뜻하지 않는다. 실제로
# bind 를 시도해 보는 것만이 답이다.
harness_port_free() {
  node -e '
    const net = require("net");
    const s = net.createServer();
    s.once("error", () => process.exit(1));
    s.listen(Number(process.argv[1]), "127.0.0.1", () => s.close(() => process.exit(0)));
  ' "$1"
}

# 그 포트를 듣고 있는 프로세스를 지목한다. wrangler 가 띄우는 workerd 는
# 설정을 stdin 으로 받으므로 argv 에 상태 디렉터리도 워커 이름도 없다.
# 소켓만이 그것을 우리 것으로 식별할 수 있는 유일한 단서다.
harness_port_pids() {
  command -v lsof >/dev/null 2>&1 || return 0
  lsof -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null || true
}

harness_free_port() {
  local pids
  pids=$(harness_port_pids "$1")
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null
  true
}

# 직전 테스트가 방금 끝났다면 아직 정리 중일 수 있다. 잠깐 기다려 보고,
# 그래도 살아 있으면 그때 거부한다. 조용히 엉뚱한 대상을 때리지 않는다.
harness_require_free_ports() {
  local p waited
  for p in "$@"; do
    waited=0
    until harness_port_free "$p"; do
      waited=$((waited + 1))
      if [ "$waited" -gt 15 ]; then
        echo "포트 $p 를 이미 누가 쓰고 있습니다: $(harness_port_pids "$p" | tr '\n' ' ')" >&2
        echo "  kill -9 \$(lsof -t -iTCP:$p -sTCP:LISTEN)" >&2
        exit 1
      fi
      sleep 1
    done
  done
}

# 실행마다 새 상태 디렉터리를 쓴다. 지난 실행의 R2 오브젝트가 새어들지 않게.
harness_state_dir() {
  mktemp -d "${TMPDIR:-/tmp}/dada-wrangler-XXXXXX"
}

# 정리는 포트를 기준으로 한다.
#
# `kill $!` 도 `pkill -f wrangler` 도 부족하다. 둘 다 npx/node 래퍼만 죽이고
# 실제 서버(workerd)는 살아남아 다음 실행에서 포트를 물고 있었다. 그 탓에
# 테스트가 옛 Worker 를 때렸다. 프로세스 그룹(setsid)은 스크립트를 멈추게 했다.
# 포트를 듣는 놈을 직접 죽이는 것이 확실하다.
harness_cleanup() {
  pkill -f "wrangler dev --local --port $PORT_WORKER" 2>/dev/null || true
  harness_free_port "$PORT_WORKER"
  harness_free_port "$PORT_NEON"
  harness_free_port "$PORT_DEEPGRAM"
  [ -n "${STATE:-}" ] && rm -rf "$STATE"
  true
}

# wrangler 가 죽었는데 계속 기다리는 일이 없게, 매 초 살아 있는지도 본다.
harness_wait_ready() {
  local i
  for i in $(seq 1 60); do
    if curl -sf --noproxy '*' -m 2 -o /dev/null "http://127.0.0.1:$PORT_WORKER/api/health"; then return 0; fi
    sleep 1
  done
  echo "Worker 가 뜨지 않았습니다. wrangler 로그를 확인하세요." >&2
  return 1
}
