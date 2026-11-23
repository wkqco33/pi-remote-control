# pi-remote-control

Go 릴레이 서버(내장 웹 UI 포함)와 TypeScript `pi` 확장을 통해 여러 `pi` 코딩 에이전트 세션을 웹/모바일 브라우저에서 원격 제어할 수 있는 프로젝트입니다.

## 구성
- `server/`: Go 단일 바이너리 릴레이 서버 (`go:embed` 웹 UI, `/ws/agent`, `/ws/client`, `/api/sessions`, `/healthz`)
- `extension/`: 런타임 의존성 제로의 TypeScript `pi` 확장 (`WsClient` + `RemoteBridge` + `/remote`)

## 빠른 시작

### 1. 릴레이 서버 실행
```bash
export PI_REMOTE_SERVER_TOKEN="change-me-strong-token"
cd server
go run ./cmd/pi-remote-server --addr :8787
```
개발 환경에서 토큰 없이 테스트하려면 `--dev-no-auth` 플래그를 사용합니다.

### 2. pi 확장 설치 및 연결
```bash
export PI_REMOTE_SERVER_TOKEN="change-me-strong-token"
export PI_REMOTE_SERVER_URL="ws://127.0.0.1:8787/ws/agent"
pi install ./extension
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

### 3. 웹 UI 접속 및 페어링
브라우저에서 `http://127.0.0.1:8787`로 접속해 토큰을 입력하고 세션을 선택하면 로컬 `pi` 터미널에 6자리 페어링 코드가 표시됩니다. 해당 코드를 웹 UI에 입력하면 원격 프롬프트, 실시간 스트리밍, 도구 승인, 작업 다이제스트를 사용할 수 있습니다.

## 검증
```bash
task check
```
