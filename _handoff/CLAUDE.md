# dada-listening

영어 듣기 연습 웹앱. 관리자(강사)가 음원/영상 + 스크립트를 올리고, 학생은 로그인 없이 링크로 들어와 구간반복·배속·빈칸채우기로 연습한다.

## 스택
- Vite + React 18 + TypeScript
- Supabase (Postgres + Storage + Auth, RLS로 권한 제어)
- 배포: GitHub push → 자동배포 (main = 프로덕션, PR = 프리뷰)

## 이관 프로젝트
`_handoff/dada-listening-deploy.html` 은 **현재 프로덕션에서 돌아가는 단일 HTML 앱**이다.
React + Babel standalone + Firebase compat SDK, 빌드 스텝 없음.
이 레포의 목표는 그 앱을 위 스택으로 이관하는 것이며, **해당 파일이 디자인과 동작의 정답지**다.
UI를 새로 디자인하지 말고, 그 파일의 색·타입·간격·문구·인터랙션을 그대로 재현할 것.
이관 계획과 알려진 제약은 `_handoff/README.md`에 있다. 작업 전에 읽을 것.

## 규칙
- 스키마 변경은 **반드시** `supabase/migrations/` 안의 SQL 파일로. 대시보드에서 직접 고치지 않는다.
- `store.ts`는 기존 `window.LDB`와 같은 함수 시그니처를 유지한다. 백엔드 교체가 UI에 새지 않게 하는 경계다.
- Storage에 저장한 미디어는 `<audio>`가 Range 요청으로 **스트리밍**하게 한다. 전체를 받아 Blob URL을 만들지 않는다 (기존 앱의 실수).
- `gapfill.ts`의 빈칸 선택은 **결정론적**이어야 한다. 같은 입력 → 같은 출력. 수정 시 테스트를 함께 갱신한다.
- iOS Safari는 `captureStream()`을 지원하지 않는다. 클라이언트 오디오 추출에 의존하는 코드를 넣지 말 것. 원본 저장 + 오디오 트랙만 재생이 현재 폴백이다.
- `service_role` 키는 절대 클라이언트 코드나 `VITE_` 환경변수에 넣지 않는다. anon key만 사용.
- UI 문구는 한국어. 기존 앱의 어투를 따른다.

## 하지 말 것
- 요청 없이 UI를 "개선"하지 말 것. 이관은 동등성이 목표다.
- Firestore 관련 코드를 새로 추가하지 말 것. 데이터 이관 스크립트에서만 읽기용으로 쓴다.
- 라이브러리를 늘리지 말 것. 필요하면 먼저 물어볼 것.
