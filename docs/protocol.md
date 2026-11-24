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
- Session control is additionally gated by a 6-digit pairing code shown **only** in the local pi terminal (`requirePairing: true` by default).

## Message Types
### Agent -> Server
- `agent.hello`: `{ serverToken, sessionId, sessionName?, host, cwd, branch?, model?, state, requirePairing, protocolVersion: 1 }`
- `session.state`: `{ state, sessionName?, branch?, model?, runningTool? }`
- `history.snapshot`: `{ items: [{ role, text, ts? }], paired? }`. 개인 응답에는 최상위 `clientId`가 포함되며, 기존 이벤트의 마지막 위치를 `seq`로 전달합니다.
- `stream.start`: `{}`
- `stream.delta`: `{ kind: "text"|"thinking", delta }`
- `stream.end`: `{ text }`
- `tool.start`: `{ toolCallId, toolName }`
- `tool.end`: `{ toolCallId, toolName, isError, durationMs }`
- `approval.request`: `{ requestId, toolCallId, toolName, timeoutMs }`
- `digest.snapshot`: `{ markdown }`
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
- `prompt.send`: `{ sessionId, text, deliverAs?: "steer"|"followUp", images?: [{ mediaType, data }] }`
- `turn.abort`: `{ sessionId }`
- `approval.response`: `{ sessionId, requestId, approved }`
- `digest.request`: `{ sessionId }`
- `ping`
