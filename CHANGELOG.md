# Changelog

## 0.1.2 - 2026-11-23
- `pi` 확장 설정에 `tokenFile` 및 `PI_REMOTE_SERVER_TOKEN_FILE` 지원 추가 (환경변수 우선, 평문 및 `{"token": "..."}` JSON 지원, `0600` 권한 점검)

## 0.1.1 - 2026-11-23
- npm 스코프 패키지명(`@wkqco33/pi-remote-control`) 적용 및 CI/Trusted Publishing 배포 파이프라인 정비

## 0.1.0 - 2026-11-23
- Go 릴레이 서버 (`pi-remote-server`) 및 내장 웹 UI (`go:embed`) 초기 구현
- TypeScript `pi` 확장 (`pi-remote-control`) 초기 구현: 6자리 터미널 페어링, 실시간 토큰 스트리밍, 웹 도구 승인, 이미지 첨부, 작업 다이제스트, 재접속 시퀀스 리플레이
