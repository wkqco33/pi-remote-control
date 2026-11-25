# @wkqco33/pi-remote-control (pi extension)

`pi` 코딩 에이전트 세션을 Go 릴레이 서버(`pi-remote-server`)와 연결해 웹/모바일 브라우저에서 원격 제어할 수 있도록 해주는 `pi` 확장 패키지입니다.

```bash
pi install npm:@wkqco33/pi-remote-control
```

- 런타임 npm 의존성 제로 (Node 22.19+ 내장 `WebSocket` 사용)
- `pi` 1.6.0 이상 필요
- 기본 릴레이 토큰 인증 및 선택 가능한 로컬 터미널 6자리 페어링(`requirePairing: true`)
- 실시간 `text` / `thinking` 델타 스트리밍 및 `steer` / `followUp` / `abort`
- 원격 턴 도구 정책(`unrestricted` / `read-only` / `no-tools`) 및 웹/로컬 도구 승인
- 시크릿 리댁션, 이미지 첨부, 작업 다이제스트(`/remote digest`)

자세한 서버 설정과 아키텍처는 [루트 README](../README.md)를 참고하세요.
