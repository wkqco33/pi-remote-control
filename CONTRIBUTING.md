# 기여 가이드

`pi-remote-control`에 기여해 주셔서 감사합니다.

## 개발 환경 요구사항

- **Go** `1.24+` (`server/`)
- **Node.js** `22.19+` (`extension/`, 내장 `WebSocket` 사용)
- **Task** (`Taskfile.yml` 실행용, 선택)

## 로컬 검증

변경 사항을 올리기 전에 전체 검증을 통과해야 합니다.

```bash
# 전체 검증 (Go 테스트/vet/빌드 + 확장 타입체크/테스트 + Cross-language E2E)
task check
```

`task`가 없다면 각 디렉터리에서 직접 실행할 수 있습니다.

```bash
# 1. Go 릴레이 서버
cd server && go test -race ./... && go vet ./... && go build -o ../bin/pi-remote-server ./cmd/pi-remote-server
cd .. && node --test server/webtest/*.test.js

# 2. TypeScript 확장
cd ../extension && npm ci && npm run check && npm run pack:check

# 3. Cross-language E2E
cd .. && ./extension/node_modules/.bin/jiti scripts/e2e.mjs
```

## Pull Request 기준

- **계층 분리 유지:** `extension/src/core/`는 순수 TypeScript로 유지하며 `node:*`나 `@earendil-works/pi-coding-agent`를 직접 import하지 않습니다.
- **런타임 의존성:** `extension/`은 런타임 npm 의존성 제로를 유지합니다.
- **보안 불변식:** 쿼리스트링 토큰, 페어링 코드 원격 전송, 설정 파일 내 원문 비밀값 저장을 금지합니다.
- **커밋 메시지:** 한국어 Conventional Commits 형식을 사용합니다 (예: `feat(server): 세션 목록 필터 추가`).
