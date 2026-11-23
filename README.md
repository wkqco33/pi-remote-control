# pi-remote-control

Go 릴레이 서버(내장 웹 UI 포함)와 TypeScript `pi` 확장을 통해 여러 `pi` 코딩 에이전트 세션을 웹/모바일 브라우저에서 원격 제어할 수 있는 프로젝트입니다.

## 아키텍처

```text
[로컬/원격 머신들]                    [Go 릴레이 서버]                  [브라우저 / 모바일]
pi 세션 A (+ 확장) ──(아웃바운드 WSS)──▶ Hub / RingBuffer               ◀──(WSS + REST)── 내장 Web UI
pi 세션 B (+ 확장) ──(아웃바운드 WSS)──▶ (첫 프레임 인증, 리플레이)                        (세션 목록, 스트리밍,
                                                                                         웹 도구 승인, 다이제스트)
```

- **`server/`**: Go 단일 바이너리 릴레이 서버 (`go:embed` 정적 웹 UI, `/ws/agent`, `/ws/client`, `/api/sessions`, `/healthz`, `/readyz`).
- **`extension/`**: 런타임 npm 의존성 제로의 TypeScript `pi` 확장 (Node 22+ 내장 `WebSocket`, `WsClient` + `RemoteBridge` + `/remote` 명령).

## 빠른 시작

### 1. 릴레이 서버 실행

```bash
export PI_REMOTE_SERVER_TOKEN="change-me-strong-token"
cd server
go run ./cmd/pi-remote-server --addr :8787
```

개발 환경에서 토큰 없이 테스트할 때만 `--dev-no-auth` 플래그를 사용하세요.

#### Docker Compose로 실행

```bash
export PI_REMOTE_SERVER_TOKEN="change-me-strong-token"
docker compose up -d --build
```

### 2. `pi` 확장 설치 및 연결

```bash
export PI_REMOTE_SERVER_TOKEN="change-me-strong-token"
export PI_REMOTE_SERVER_URL="ws://127.0.0.1:8787/ws/agent"
pi install ./extension
```

또는 npm / GitHub 저장소에서 바로 설치할 수 있습니다.

```bash
pi install npm:@wkqco33/pi-remote-control
# 또는
pi install git:github.com/wkqco33/pi-remote-control
```

설정 파일(`~/.pi/agent/remote-control.json` 또는 `<project>/.pi/remote-control.json`)에는 비밀값 대신 환경변수 이름(`tokenEnv`)만 지정합니다.

```json
{
  "serverUrl": "wss://remote.example.com/ws/agent",
  "tokenEnv": "PI_REMOTE_SERVER_TOKEN",
  "requirePairing": true,
  "remoteToolPolicy": "unrestricted",
  "remoteToolApproval": "web"
}
```

| 설정 키 | 기본값 | 설명 |
| --- | --- | --- |
| `serverUrl` | `ws://127.0.0.1:8787/ws/agent` | 릴레이 서버 Agent WebSocket URL (`PI_REMOTE_SERVER_URL`로 덮어쓰기 가능) |
| `tokenEnv` | `PI_REMOTE_SERVER_TOKEN` | 서버 인증 토큰을 읽을 환경변수 이름 |
| `requirePairing` | `true` | 웹 클라이언트별 6자리 터미널 페어링 필수 여부 |
| `remoteToolPolicy` | `unrestricted` | 원격 턴 도구 제한 (`unrestricted` \| `read-only` \| `no-tools`) |
| `remoteToolApproval` | `off` | 원격 턴 비읽기전용 도구 승인 (`off` \| `local` \| `web`) |
| `approvalTimeoutMs` | `60000` | 웹/로컬 도구 승인 대기 제한 시간 (ms) |

### 3. 웹 UI 접속 및 페어링

브라우저에서 `http://127.0.0.1:8787`로 접속해 `Token` 버튼으로 서버 토큰을 입력하고 세션을 선택하면 로컬 `pi` 터미널에 6자리 페어링 코드가 표시됩니다. 해당 코드를 웹 UI에 입력하면 원격 프롬프트(`followUp` / `steer`), 실시간 스트리밍, 웹 도구 승인, 이미지 첨부, 작업 다이제스트를 사용할 수 있습니다.

## 보안 모델

- **이중 인증:** 릴레이 서버 접속 시 첫 프레임 `serverToken` 검증 + 세션별 로컬 터미널 전용 6자리 페어링 코드 검증.
- **프롬프트 인젝션 방어:** 원격 턴에 `remoteToolPolicy` 및 `remoteToolApproval` 적용.
- **시크릿 보호:** 송신 스트림·히스토리·다이제스트에 `redactSecrets` 적용, 쿼리스트링 토큰 금지. 자세한 내용은 [SECURITY.md](SECURITY.md)를 참고하세요.

## 검증 및 문서

- 전체 검증: `task check`
- 와이어 프로토콜 명세: [docs/protocol.md](docs/protocol.md)
- 기여 안내: [CONTRIBUTING.md](CONTRIBUTING.md)
- 변경 이력: [CHANGELOG.md](CHANGELOG.md)
