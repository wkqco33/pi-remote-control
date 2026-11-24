# pi-remote-control

Go 릴레이 서버(내장 웹 UI 포함)와 TypeScript `pi` 확장을 통해 여러 `pi` 코딩 에이전트 세션을 웹/모바일 브라우저에서 원격 제어할 수 있는 프로젝트입니다.

## 아키텍처

```text
[로컬/원격 머신들]                    [Go 릴레이 서버]                  [브라우저 / 모바일]
pi 세션 A (+ 확장) ──(아웃바운드 WSS)──▶ Hub / RingBuffer               ◀──(WSS + REST)── 내장 Web UI
pi 세션 B (+ 확장) ──(아웃바운드 WSS)──▶ (첫 프레임 인증, 리플레이)                        (세션 목록, 스트리밍,
                                                                                         웹 도구 승인, 다이제스트)
```

- **`server/`**: 내장 웹 UI를 포함한 Go 단일 바이너리. UI는 Bootstrap Grid와 프로젝트 CSS를 함께 사용합니다.
- **`extension/`**: 런타임 npm 의존성 제로의 TypeScript `pi` 확장 (Node 22+ 내장 `WebSocket`, `WsClient` + `RemoteBridge` + `/remote` 명령).

## 빠른 시작

### 1. 릴레이 서버 실행

```bash
export PI_REMOTE_SERVER_TOKEN="$(openssl rand -hex 32)"
cd server
go run ./cmd/pi-remote-server
```

기본 수신 주소는 `127.0.0.1:8787`입니다. 루프백 개발 환경에서 토큰 없이 테스트할 때만 `--dev-no-auth` 플래그를 사용하세요.

#### Docker Compose로 실행

```bash
docker compose up -d --build
```

### 2. `pi` 확장 설치 및 연결

```bash
export PI_REMOTE_SERVER_URL="ws://127.0.0.1:8787/ws/agent"
pi install ./extension
```

다른 머신에서 확장을 실행할 때는 서버와 동일한 토큰을 안전한 방법으로 전달하고 `PI_REMOTE_SERVER_URL`에 공개 `wss://` 주소를 지정하세요. npm / GitHub 저장소에서도 설치할 수 있습니다.

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
| `tokenFile` | 없음 | 환경변수가 없을 때 읽을 토큰 파일 경로 (평문 또는 `{"token":"..."}` JSON, `0600` 권장, `PI_REMOTE_SERVER_TOKEN_FILE`로 덮어쓰기 가능) |
| `requirePairing` | `true` | 웹 클라이언트별 6자리 터미널 페어링 필수 여부 |
| `remoteToolPolicy` | `unrestricted` | 원격 턴 도구 제한 (`unrestricted` \| `read-only` \| `no-tools`) |
| `remoteToolApproval` | `off` | 원격 턴 비읽기전용 도구 승인 (`off` \| `local` \| `web`) |
| `approvalTimeoutMs` | `60000` | 웹/로컬 도구 승인 대기 제한 시간 (ms) |

### 3. 웹에서 세션 작업하기

브라우저에서 `http://127.0.0.1:8787`에 접속해 서버 토큰을 입력합니다. 브라우저는 30일 동안 로그인을 기억하며, `Connection → Sign out`에서 로그아웃할 수 있습니다.

신뢰하는 개인 릴레이에서 토큰만으로 작업하려면 각 `pi` 세션에 적용되는 `~/.pi/agent/remote-control.json` 또는 `<project>/.pi/remote-control.json`에 `"requirePairing": false`를 설정한 뒤 확장을 다시 시작하세요. 해당 세션은 릴레이에 인증한 모든 클라이언트가 제어할 수 있습니다. 기본 설정에서는 로컬 `pi` 터미널에 나온 코드를 웹에 입력합니다. 로그인은 브라우저 프로필에서 공유되며, 페어링은 현재 로그인 쿠키와 탭, 실행 중인 `pi` 세션 단위로 유지됩니다. 페어링을 사용하는 배포는 릴레이와 `pi` 확장을 함께 업데이트하세요.

사이드바에서 세션을 검색하고 전환할 수 있습니다. 같은 페이지에서 열어 본 세션은 대화 수신을 계속하고, 작성 중인 메시지와 첨부는 세션별로 유지됩니다. 바쁜 세션에는 `Follow up`이나 `Steer`로 메시지를 보낼 수 있습니다.

## 보안 모델

- **외부 접속:** 리버스 프록시에서 HTTPS/WSS를 제공하고, 브라우저가 보낸 공개 `Host`를 업스트림에 전달하세요. 원본 릴레이 포트는 루프백이나 프록시 전용 네트워크에서만 접근할 수 있게 구성하세요. 외부 공개 세션에서는 기본값 `requirePairing: true`를 권장합니다.
- **릴레이 인증:** 웹은 서명된 HttpOnly 쿠키로 접속하고, 에이전트와 기타 클라이언트는 첫 프레임으로 릴레이 토큰을 전달합니다. 기본 설정에서는 세션별 터미널 페어링도 적용됩니다.
- **프롬프트 인젝션 방어:** 원격 턴에 `remoteToolPolicy` 및 `remoteToolApproval` 적용.
- **시크릿 보호:** 송신 스트림·히스토리·다이제스트에 `redactSecrets` 적용, 쿼리스트링 토큰 금지. 자세한 내용은 [SECURITY.md](SECURITY.md)를 참고하세요.

## 검증 및 문서

- 전체 검증: `task check`
- 와이어 프로토콜 명세: [docs/protocol.md](docs/protocol.md)
- 기여 안내: [CONTRIBUTING.md](CONTRIBUTING.md)
- 변경 이력: [CHANGELOG.md](CHANGELOG.md)
