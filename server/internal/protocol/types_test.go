package protocol

import (
	"encoding/json"
	"testing"
)

func TestEnvelopeRoundTrip(t *testing.T) {
	env, err := NewEnvelope(TypeAgentHello, "sess-1", AgentHelloPayload{
		ServerToken:     "tok",
		SessionID:       "sess-1",
		Host:            "workstation",
		Cwd:             "/tmp/proj",
		State:           "idle",
		RequirePairing:  true,
		ProtocolVersion: ProtocolVersion,
	})
	if err != nil {
		t.Fatalf("NewEnvelope failed: %v", err)
	}

	raw, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}

	var decoded Envelope
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}
	if decoded.Type != TypeAgentHello || decoded.SessionID != "sess-1" {
		t.Fatalf("unexpected envelope header: %#v", decoded)
	}

	hello, err := DecodePayload[AgentHelloPayload](decoded.Payload)
	if err != nil {
		t.Fatalf("DecodePayload failed: %v", err)
	}
	if hello.Host != "workstation" || !hello.RequirePairing || hello.ProtocolVersion != 1 {
		t.Fatalf("unexpected hello payload: %#v", hello)
	}
}

func TestDecodePayloadRejectsEmpty(t *testing.T) {
	if _, err := DecodePayload[ClientHelloPayload](nil); err == nil {
		t.Fatal("expected error for empty payload")
	}
}
