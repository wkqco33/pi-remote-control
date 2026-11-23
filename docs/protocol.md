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
- HTTP `/api/sessions` requires `Authorization: Bearer <serverToken>`.
- Session control is additionally gated by a 6-digit pairing code shown **only** in the local pi terminal (`requirePairing: true` by default).

## Message Types
### Agent -> Server
- `agent.hello`: `{ serverToken, sessionId, sessionName?, host, cwd, branch?, model?, state, requirePairing, protocolVersion: 1 }`
- `session.state`: `{ state, sessionName?, branch?, model?, runningTool? }`
- `history.snapshot`: `{ items: [{ role, text, ts? }] }`
- `stream.start`: `{}`
- `stream.delta`: `{ kind: "text"|"thinking", delta }`
- `stream.end`: `{ text }`
- `tool.start`: `{ toolCallId, toolName }`
- `tool.end`: `{ toolCallId, toolName, isError, durationMs }`
- `approval.request`: `{ requestId, toolCallId, toolName, timeoutMs }`
- `digest.snapshot`: `{ markdown }`
- `pair.required`: `{ challengeId, digits, expiresAt, reason }`
- `pair.result`: `{ ok, clientId, error? }`
- `pong`

### Client -> Server -> Agent
- `client.hello`: `{ serverToken, clientId }` (Server replies with `client.welcome`)
- `session.subscribe`: `{ sessionId, lastSeq? }` (Server replays ring-buffer events > `lastSeq`, or requests `history.request`)
- `session.unsubscribe`: `{ sessionId }`
- `pair.submit`: `{ sessionId, code }`
- `prompt.send`: `{ sessionId, text, deliverAs?: "steer"|"followUp", images?: [{ mediaType, data }] }`
- `turn.abort`: `{ sessionId }`
- `approval.response`: `{ sessionId, requestId, approved }`
- `digest.request`: `{ sessionId }`
- `ping`
