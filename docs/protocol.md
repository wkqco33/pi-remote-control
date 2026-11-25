# `pi-remote-control` Wire Protocol (v1)

All WebSocket messages are UTF-8 JSON frames using a shared `Envelope`:

```json
{
  "type": "stream.delta",
  "sessionId": "sess-123",
  "seq": 42,
  "ts": 1795428000000,
  "clientId": "web-abc",
  "payload": {}
}
```

## Authentication
- Query-string tokens are forbidden.
- `/ws/agent` must send `agent.hello` as the first frame within `authTimeout` (default `5s`).
- `/ws/client` must send `client.hello` as the first frame within `authTimeout`.
- Web UI는 같은 출처의 `POST /api/browser-auth`에 `Authorization: Bearer <serverToken>`을 보내고, 발급된 쿠키로 `/ws/client`에 연결합니다. `DELETE /api/browser-auth`는 브라우저 쿠키를 지웁니다.
- HTTP `/api/sessions` requires `Authorization: Bearer <serverToken>`.
- 기본값인 `requirePairing: false`에서는 릴레이에 인증한 클라이언트가 세션을 제어할 수 있습니다. `requirePairing: true`인 세션은 로컬 `pi` 터미널에 표시되는 6자리 페어링 코드도 요구합니다.

## Message Types
### Agent -> Server
- `agent.hello`: `{ serverToken, sessionId, sessionName?, host, cwd, branch?, model?, state, requirePairing, protocolVersion: 1, autoApprove?, extensionVersion? }`
- `session.state`: `{ state, sessionName?, branch?, model?, runningTool?, autoApprove? }`. `autoApprove`는 `sessions.update`의 세션 요약에도 반영됩니다. 필드가 없으면 에이전트 측 자동 승인을 지원하지 않는 확장입니다.
- `history.snapshot`: `{ items: [{ role, text, ts? }], paired? }`. 도구 호출 항목은 `{ role: "tool", text: <toolName>, toolCallId, status: "running"|"done"|"failed"|"interrupted", durationMs?, ts? }`이며 도구 인자와 결과는 담지 않습니다. 메시지는 최근 40개, 도구 호출은 최근 100개까지 보냅니다. 개인 응답에는 최상위 `clientId`가 포함되며, 기존 이벤트의 마지막 위치를 `seq`로 전달합니다.
- `stream.start`: `{}`
- `stream.delta`: `{ kind: "text"|"thinking", delta }`. 확장은 약 50ms 동안 받은 조각을 묶어 보내며, 다른 프레임을 보내기 전에는 남은 조각을 먼저 보냅니다.
- `stream.end`: `{ text }`
- `tool.start`: `{ toolCallId, toolName }`
- `tool.end`: `{ toolCallId, toolName, isError, durationMs }`
- `approval.request`: `{ requestId, toolCallId, toolName, timeoutMs }`. 대기 중인 요청은 `history.request`를 받을 때 남은 시간과 함께 같은 `requestId`로 다시 보냅니다.
- `approval.resolved`: `{ requestId, approved, reason: "user"|"auto"|"timeout"|"cancelled" }`
- `digest.snapshot`: `{ markdown }`
- `commands.snapshot`: `{ commands: [{ name, description?, source: "builtin"|"prompt"|"skill" }], models: ["provider/id"], thinkingLevels }`. 최상위 `clientId`로 지정된 구독자에게만 전달하며 리플레이 버퍼에 저장하지 않습니다.
- `command.result`: `{ command, ok, message }`. 기본 명령의 결과나 명령을 거절한 이유입니다.
- `pair.required`: `{ challengeId, digits, expiresAt, reason }`
- `pair.status`: `{ paired }`
- `pair.result`: `{ ok, clientId, error? }`
- 페어링 이벤트는 최상위 `clientId`로 지정된 구독자에게만 전달되며 리플레이 버퍼에 저장하지 않습니다.
- `pong`

### Client -> Server -> Agent
- `client.hello`: `{ serverToken?, clientId }`. 쿠키로 인증하는 웹 클라이언트는 `serverToken`을 생략합니다. 서버는 `client.welcome`으로 응답하며, 쿠키 인증에서는 쿠키와 탭 식별자에 연결된 `clientId`를 반환합니다.
- `session.subscribe`: `{ sessionId, lastSeq? }`. 여러 세션에 구독할 수 있습니다. 릴레이는 `lastSeq` 이후 이벤트를 복구할 수 있으면 리플레이하고, 에이전트에 `history.request`의 `pairStatusOnly: true`로 페어링 상태만 요청합니다. 최초 구독이나 전체 리플레이가 불가능할 때는 히스토리 스냅샷을 요청합니다.
- `session.unsubscribe`: `{ sessionId }`
- `pair.submit`: `{ sessionId, code }`
- `prompt.send`: `{ sessionId, text, deliverAs?: "steer"|"followUp", images?: [{ mediaType, data }] }`. `/`로 시작하는 `text`는 확장이 명령으로 해석합니다. 프롬프트 템플릿과 스킬은 확장하고, `/compact`, `/model`, `/thinking`은 확장 API로 실행합니다. `/update`와 `/reload`는 `remoteUpdate`를 켠 경우에만 실행합니다. 확장 명령과 알 수 없는 명령은 거절합니다. `//`로 시작하면 `/` 하나를 제거한 일반 텍스트이며, 첫 단어에 `/`가 더 있으면 파일 경로로 보고 그대로 전달합니다.
- `turn.abort`: `{ sessionId }`
- `approval.response`: `{ sessionId, requestId, approved }`
- `approval.mode`: `{ sessionId, autoApprove }`. 에이전트의 자동 승인 모드를 변경합니다. 페어링을 요구하는 세션은 페어링한 클라이언트만 변경할 수 있습니다.
- `digest.request`: `{ sessionId }`
- `commands.request`: `{ sessionId }`. 페어링을 요구하는 세션은 페어링한 클라이언트에만 목록을 보냅니다.
- `ping`
