import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // src 안의 단위 테스트만 vitest 가 맡는다.
    // worker/tests/*.mjs 는 wrangler 와 스텁을 띄워야 도는 종단 테스트라
    // scripts/test-media.sh · scripts/test-transcribe.sh 로만 실행한다.
    include: ['src/**/*.test.ts'],
  },
});
