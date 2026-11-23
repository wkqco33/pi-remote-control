package hub

import (
	"sync"
	"testing"

	"github.com/wkqco33/pi-remote-control/server/internal/protocol"
)

type fakePeer struct {
	mu   sync.Mutex
	envs []protocol.Envelope
}

func (f *fakePeer) send(env protocol.Envelope) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.envs = append(f.envs, env)
	return true
}

func (f *fakePeer) list() []protocol.Envelope {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]protocol.Envelope, len(f.envs))
	copy(out, f.envs)
	return out
}

func TestHubRoutingAndReplay(t *testing.T) {
	h := New(16)
	agentPeer := &fakePeer{}
	clientPeer := &fakePeer{}

	gen := h.RegisterAgent(protocol.AgentHelloPayload{
		SessionID: "s1",
		Host:      "host1",
		Cwd:       "/repo",
		State:     "idle",
	}, agentPeer.send)

	cGen, welcome := h.RegisterClient("c1", clientPeer.send)
	defer h.UnregisterClient("c1", cGen)

	if len(welcome.Sessions) != 1 || welcome.Sessions[0].SessionID != "s1" {
		t.Fatalf("unexpected welcome sessions: %#v", welcome.Sessions)
	}

	h.Subscribe("c1", "s1", 0)
	// Initial subscribe triggers history.request to agent.
	if len(agentPeer.list()) != 1 || agentPeer.list()[0].Type != protocol.TypeHistoryRequest {
		t.Fatalf("expected history.request to agent, got %#v", agentPeer.list())
	}

	// Agent emits stream.delta
	deltaEnv, _ := protocol.NewEnvelope(protocol.TypeStreamDelta, "s1", map[string]string{"kind": "text", "delta": "hi"})
	h.HandleAgentEvent("s1", deltaEnv)

	if len(clientPeer.list()) != 1 || clientPeer.list()[0].Seq != 1 {
		t.Fatalf("expected client to receive seq 1 delta, got %#v", clientPeer.list())
	}

	// Client sends prompt.send
	promptEnv, _ := protocol.NewEnvelope(protocol.TypePromptSend, "s1", protocol.PromptSendPayload{Text: "hello"})
	h.HandleClientCommand("c1", promptEnv)

	agentMsgs := agentPeer.list()
	if len(agentMsgs) != 2 || agentMsgs[1].Type != protocol.TypePromptSend || agentMsgs[1].ClientID != "c1" {
		t.Fatalf("expected prompt.send routed to agent with clientId, got %#v", agentMsgs)
	}

	// Second client subscribes from seq 0 and receives replay
	client2 := &fakePeer{}
	c2Gen, _ := h.RegisterClient("c2", client2.send)
	defer h.UnregisterClient("c2", c2Gen)
	h.Subscribe("c2", "s1", 0)
	if len(client2.list()) != 1 || client2.list()[0].Type != protocol.TypeStreamDelta {
		t.Fatalf("expected replay of stream.delta to c2, got %#v", client2.list())
	}

	// Stale unregister does not remove active agent
	h.UnregisterAgent("s1", gen+999, "stale")
	if len(h.ListSessions()) != 1 {
		t.Fatal("stale unregister should not remove active session")
	}

	// Real unregister notifies subscribers
	h.UnregisterAgent("s1", gen, "closed")
	if len(h.ListSessions()) != 0 {
		t.Fatal("expected 0 sessions after unregister")
	}
	foundOffline := false
	for _, e := range clientPeer.list() {
		if e.Type == protocol.TypeSessionOffline {
			foundOffline = true
		}
	}
	if !foundOffline {
		t.Fatal("expected session.offline sent to subscribed client")
	}
}
