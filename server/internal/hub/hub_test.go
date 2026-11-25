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

	// A new client restores history without replaying the old stream first.
	client2 := &fakePeer{}
	c2Gen, _ := h.RegisterClient("c2", client2.send)
	defer h.UnregisterClient("c2", c2Gen)
	h.Subscribe("c2", "s1", 0)
	request := expectHistoryRequest(t, agentPeer, "c2")
	if request.PairStatusOnly || len(client2.list()) != 0 {
		t.Fatalf("expected fresh history request, got %#v and %#v", request, client2.list())
	}
	snapshot, _ := protocol.NewEnvelope(protocol.TypeHistorySnapshot, "s1", map[string]bool{"paired": true})
	snapshot.ClientID = "c2"
	h.HandleAgentEvent("s1", snapshot)
	if msgs := client2.list(); len(msgs) != 1 || msgs[0].Type != protocol.TypeHistorySnapshot || msgs[0].Seq != 1 {
		t.Fatalf("expected snapshot with replay baseline 1, got %#v", msgs)
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

func TestHubResumeAndPrivatePairing(t *testing.T) {
	h := New(2)
	agent := &fakePeer{}
	h.RegisterAgent(protocol.AgentHelloPayload{SessionID: "s1", RequirePairing: true}, agent.send)
	resuming, other := &fakePeer{}, &fakePeer{}
	h.RegisterClient("resume", resuming.send)
	h.RegisterClient("other", other.send)
	h.Subscribe("other", "s1", 0)

	for _, target := range []string{"", "other", "resume"} {
		challenge, _ := protocol.NewEnvelope(protocol.TypePairRequired, "s1", nil)
		challenge.ClientID = target
		h.HandleAgentEvent("s1", challenge)
	}
	if msgs := other.list(); len(msgs) != 1 || msgs[0].Type != protocol.TypePairRequired || msgs[0].ClientID != "other" || msgs[0].Seq != 0 {
		t.Fatalf("expected only the targeted challenge without a sequence, got %#v", msgs)
	}
	if len(resuming.list()) != 0 || h.ListSessions()[0].LastSeq != 0 {
		t.Fatal("pairing messages must stay outside the broadcast and replay ring")
	}

	delta, _ := protocol.NewEnvelope(protocol.TypeStreamDelta, "s1", nil)
	h.HandleAgentEvent("s1", delta)
	h.HandleAgentEvent("s1", delta)
	h.HandleAgentEvent("s1", delta)
	h.Subscribe("resume", "s1", 1)
	if !expectHistoryRequest(t, agent, "resume").PairStatusOnly {
		t.Fatal("resume should request only fresh pairing status after replay")
	}
	if msgs := resuming.list(); len(msgs) != 2 || msgs[0].Seq != 2 || msgs[1].Seq != 3 {
		t.Fatalf("expected incremental replay from sequence 1, got %#v", msgs)
	}

	status, _ := protocol.NewEnvelope(protocol.TypePairStatus, "s1", map[string]bool{"paired": true})
	status.ClientID = "resume"
	h.HandleAgentEvent("s1", status)
	if msgs := resuming.list(); len(msgs) != 3 || msgs[2].Type != protocol.TypePairStatus || msgs[2].Seq != 0 {
		t.Fatalf("expected targeted pairing status, got %#v", msgs)
	}
	if msgs := other.list(); len(msgs) != 4 {
		t.Fatalf("pairing status leaked to another client: %#v", msgs)
	}

	h.HandleAgentEvent("s1", delta)
	for _, seq := range []uint64{1, 9} {
		h.Subscribe("resume", "s1", seq)
		if expectHistoryRequest(t, agent, "resume").PairStatusOnly {
			t.Fatalf("sequence %d should request a fresh snapshot", seq)
		}
	}
	if msgs := resuming.list(); len(msgs) != 4 {
		t.Fatalf("unexpected replay with an unusable cursor: %#v", msgs)
	}
}

func expectHistoryRequest(t *testing.T, agent *fakePeer, target string) protocol.HistoryRequestPayload {
	t.Helper()
	msgs := agent.list()
	if len(msgs) == 0 {
		t.Fatal("agent did not receive a history request")
	}
	env := msgs[len(msgs)-1]
	payload, err := protocol.DecodePayload[protocol.HistoryRequestPayload](env.Payload)
	if err != nil || env.Type != protocol.TypeHistoryRequest || env.ClientID != target || payload.ClientID != target {
		t.Fatalf("expected history request for %q, got %#v and %v", target, env, err)
	}
	return payload
}

func TestSessionStatePropagatesAutoApprove(t *testing.T) {
	h := New(8)
	off, on := false, true
	h.RegisterAgent(protocol.AgentHelloPayload{SessionID: "s1", AutoApprove: &off}, func(protocol.Envelope) bool { return true })
	if got := h.ListSessions()[0].AutoApprove; got == nil || *got {
		t.Fatalf("expected autoApprove=false from hello, got %v", got)
	}

	env, err := protocol.NewEnvelope(protocol.TypeSessionState, "s1", protocol.SessionStatePayload{State: "busy", AutoApprove: &on})
	if err != nil {
		t.Fatal(err)
	}
	h.HandleAgentEvent("s1", env)
	if got := h.ListSessions()[0].AutoApprove; got == nil || !*got {
		t.Fatalf("expected autoApprove=true after session.state, got %v", got)
	}
}

func TestCommandCatalogReachesOnlyTheRequester(t *testing.T) {
	h := New(8)
	h.RegisterAgent(protocol.AgentHelloPayload{SessionID: "s1"}, func(protocol.Envelope) bool { return true })
	received := map[string]int{}
	for _, id := range []string{"a", "b"} {
		h.RegisterClient(id, func(env protocol.Envelope) bool {
			if env.Type == protocol.TypeCommandsSnapshot {
				received[id]++
			}
			return true
		})
		h.Subscribe(id, "s1", 0)
	}

	env, err := protocol.NewEnvelope(protocol.TypeCommandsSnapshot, "s1", map[string]any{"commands": []string{}})
	if err != nil {
		t.Fatal(err)
	}
	env.ClientID = "a"
	h.HandleAgentEvent("s1", env)

	if received["a"] != 1 || received["b"] != 0 {
		t.Fatalf("unexpected delivery: %v", received)
	}
	if got := h.ListSessions()[0].LastSeq; got != 0 {
		t.Fatalf("catalog must not enter the replay buffer, lastSeq=%d", got)
	}
}
