package protocol

import (
	"encoding/json"
	"fmt"
	"time"
)

const ProtocolVersion = 1

// Message types shared across Go relay, TypeScript extension, and Web UI.
const (
	TypeAgentHello       = "agent.hello"
	TypeClientHello      = "client.hello"
	TypeClientWelcome    = "client.welcome"
	TypeSessionsUpdate   = "sessions.update"
	TypeSessionSubscribe = "session.subscribe"
	TypeSessionUnsub     = "session.unsubscribe"
	TypeSessionState     = "session.state"
	TypeSessionOffline   = "session.offline"
	TypeHistoryRequest   = "history.request"
	TypeHistorySnapshot  = "history.snapshot"
	TypeStreamStart      = "stream.start"
	TypeStreamDelta      = "stream.delta"
	TypeStreamEnd        = "stream.end"
	TypeToolStart        = "tool.start"
	TypeToolEnd          = "tool.end"
	TypeApprovalRequest  = "approval.request"
	TypeApprovalResponse = "approval.response"
	TypeApprovalMode     = "approval.mode"
	TypeApprovalResolved = "approval.resolved"
	TypeDigestRequest    = "digest.request"
	TypeDigestSnapshot   = "digest.snapshot"
	TypePairRequired     = "pair.required"
	TypePairStatus       = "pair.status"
	TypePairSubmit       = "pair.submit"
	TypePairResult       = "pair.result"
	TypePromptSend       = "prompt.send"
	TypeTurnAbort        = "turn.abort"
	TypeError            = "error"
	TypePing             = "ping"
	TypePong             = "pong"
)

// Envelope is the wire frame for all WebSocket messages.
type Envelope struct {
	Type      string          `json:"type"`
	SessionID string          `json:"sessionId,omitempty"`
	Seq       uint64          `json:"seq,omitempty"`
	TS        int64           `json:"ts,omitempty"`
	ClientID  string          `json:"clientId,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

type AgentHelloPayload struct {
	ServerToken     string `json:"serverToken"`
	SessionID       string `json:"sessionId"`
	SessionName     string `json:"sessionName,omitempty"`
	Host            string `json:"host"`
	Cwd             string `json:"cwd"`
	Branch          string `json:"branch,omitempty"`
	Model           string `json:"model,omitempty"`
	State           string `json:"state"`
	RequirePairing  bool   `json:"requirePairing"`
	AutoApprove     *bool  `json:"autoApprove,omitempty"`
	ProtocolVersion int    `json:"protocolVersion"`
}

type ClientHelloPayload struct {
	ServerToken string `json:"serverToken"`
	ClientID    string `json:"clientId"`
}

type SessionSummary struct {
	SessionID      string `json:"sessionId"`
	SessionName    string `json:"sessionName,omitempty"`
	Host           string `json:"host"`
	Cwd            string `json:"cwd"`
	Branch         string `json:"branch,omitempty"`
	Model          string `json:"model,omitempty"`
	State          string `json:"state"`
	RunningTool    string `json:"runningTool,omitempty"`
	RequirePairing bool   `json:"requirePairing"`
	ConnectedAt    int64  `json:"connectedAt"`
	LastSeq        uint64 `json:"lastSeq"`
	// AutoApprove is nil for agents that predate agent-side auto-approve.
	AutoApprove *bool `json:"autoApprove,omitempty"`
}

type ClientWelcomePayload struct {
	ClientID string           `json:"clientId"`
	Sessions []SessionSummary `json:"sessions"`
}

type SessionsUpdatePayload struct {
	Sessions []SessionSummary `json:"sessions"`
}

type SessionSubscribePayload struct {
	SessionID string `json:"sessionId"`
	LastSeq   uint64 `json:"lastSeq,omitempty"`
}

type SessionStatePayload struct {
	State       string `json:"state"`
	SessionName string `json:"sessionName,omitempty"`
	Branch      string `json:"branch,omitempty"`
	Model       string `json:"model,omitempty"`
	RunningTool string `json:"runningTool,omitempty"`
	AutoApprove *bool  `json:"autoApprove,omitempty"`
}

type SessionOfflinePayload struct {
	SessionID string `json:"sessionId"`
	Reason    string `json:"reason,omitempty"`
}

type HistoryRequestPayload struct {
	ClientID       string `json:"clientId,omitempty"`
	PairStatusOnly bool   `json:"pairStatusOnly,omitempty"`
}

type PromptImage struct {
	MediaType string `json:"mediaType"`
	Data      string `json:"data"`
}

type PromptSendPayload struct {
	SessionID string        `json:"sessionId,omitempty"`
	Text      string        `json:"text"`
	DeliverAs string        `json:"deliverAs,omitempty"`
	Images    []PromptImage `json:"images,omitempty"`
}

type PairSubmitPayload struct {
	SessionID string `json:"sessionId,omitempty"`
	Code      string `json:"code"`
}

type ApprovalResponsePayload struct {
	SessionID string `json:"sessionId,omitempty"`
	RequestID string `json:"requestId"`
	Approved  bool   `json:"approved"`
}

type ErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// NewEnvelope encodes a typed payload into a wire Envelope.
func NewEnvelope(msgType string, sessionID string, payload any) (Envelope, error) {
	var raw json.RawMessage
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return Envelope{}, fmt.Errorf("marshal %s payload: %w", msgType, err)
		}
		raw = b
	}
	return Envelope{
		Type:      msgType,
		SessionID: sessionID,
		TS:        time.Now().UnixMilli(),
		Payload:   raw,
	}, nil
}

// DecodePayload unmarshals an Envelope's raw JSON payload into T.
func DecodePayload[T any](raw json.RawMessage) (T, error) {
	var out T
	if len(raw) == 0 {
		return out, fmt.Errorf("empty payload")
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, err
	}
	return out, nil
}
