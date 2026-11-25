package httpserver

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/wkqco33/pi-remote-control/server/internal/config"
	"github.com/wkqco33/pi-remote-control/server/internal/hub"
	"github.com/wkqco33/pi-remote-control/server/internal/protocol"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestServerHealthAuthAndRelayRoundTrip(t *testing.T) {
	cfg := config.Config{
		Addr:            ":0",
		ServerToken:     "top-secret",
		RingBufferSize:  64,
		MaxMessageBytes: 1024 * 1024,
		AuthTimeout:     2 * time.Second,
		PingInterval:    10 * time.Second,
	}
	h := hub.New(cfg.RingBufferSize)
	srv := New(cfg, h, testLogger())
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	// Healthcheck
	resp, err := http.Get(ts.URL + "/healthz")
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("healthz failed: resp=%v err=%v", resp, err)
	}
	_ = resp.Body.Close()

	// Embedded UI index
	uiResp, err := http.Get(ts.URL + "/")
	if err != nil || uiResp.StatusCode != http.StatusOK {
		t.Fatalf("GET / failed: resp=%v err=%v", uiResp, err)
	}
	_ = uiResp.Body.Close()

	// Unauthorized /api/sessions
	unauthResp, err := http.Get(ts.URL + "/api/sessions")
	if err != nil || unauthResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 on /api/sessions, got %v err=%v", unauthResp, err)
	}
	_ = unauthResp.Body.Close()

	wsBase := "ws" + strings.TrimPrefix(ts.URL, "http")

	// Reject bad token on agent WS
	badConn, _, err := websocket.DefaultDialer.Dial(wsBase+"/ws/agent", nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	helloBad, _ := protocol.NewEnvelope(protocol.TypeAgentHello, "s1", protocol.AgentHelloPayload{
		ServerToken:     "wrong",
		SessionID:       "s1",
		Host:            "h1",
		Cwd:             "/tmp",
		State:           "idle",
		ProtocolVersion: 1,
	})
	_ = badConn.WriteJSON(helloBad)
	var errEnv protocol.Envelope
	if err := badConn.ReadJSON(&errEnv); err != nil || errEnv.Type != protocol.TypeError {
		t.Fatalf("expected error frame for bad token, got %#v err=%v", errEnv, err)
	}
	_ = badConn.Close()

	// Connect valid agent
	agentConn, _, err := websocket.DefaultDialer.Dial(wsBase+"/ws/agent", nil)
	if err != nil {
		t.Fatalf("agent dial failed: %v", err)
	}
	defer agentConn.Close()

	helloAgent, _ := protocol.NewEnvelope(protocol.TypeAgentHello, "s1", protocol.AgentHelloPayload{
		ServerToken:     "top-secret",
		SessionID:       "s1",
		SessionName:     "demo",
		Host:            "workstation",
		Cwd:             "/repo",
		State:           "idle",
		RequirePairing:  false,
		ProtocolVersion: 1,
	})
	if err := agentConn.WriteJSON(helloAgent); err != nil {
		t.Fatalf("agent hello write failed: %v", err)
	}

	// Verify /api/sessions with Bearer token (poll briefly for async WS registration)
	var sessionsBody struct {
		Sessions []protocol.SessionSummary `json:"sessions"`
	}
	deadline := time.Now().Add(500 * time.Millisecond)
	for {
		req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/sessions", nil)
		req.Header.Set("Authorization", "Bearer top-secret")
		apiResp, err := http.DefaultClient.Do(req)
		if err != nil || apiResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 on /api/sessions, got %v err=%v", apiResp, err)
		}
		sessionsBody.Sessions = nil
		if err := json.NewDecoder(apiResp.Body).Decode(&sessionsBody); err != nil {
			_ = apiResp.Body.Close()
			t.Fatalf("decode sessions failed: %v", err)
		}
		_ = apiResp.Body.Close()
		if len(sessionsBody.Sessions) == 1 || time.Now().After(deadline) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(sessionsBody.Sessions) != 1 || sessionsBody.Sessions[0].SessionID != "s1" {
		t.Fatalf("unexpected sessions: %#v", sessionsBody.Sessions)
	}

	// Connect valid client
	clientConn, _, err := websocket.DefaultDialer.Dial(wsBase+"/ws/client", nil)
	if err != nil {
		t.Fatalf("client dial failed: %v", err)
	}
	defer clientConn.Close()

	helloClient, _ := protocol.NewEnvelope(protocol.TypeClientHello, "", protocol.ClientHelloPayload{
		ServerToken: "top-secret",
		ClientID:    "web-1",
	})
	_ = clientConn.WriteJSON(helloClient)

	var welcome protocol.Envelope
	if err := clientConn.ReadJSON(&welcome); err != nil || welcome.Type != protocol.TypeClientWelcome {
		t.Fatalf("expected client.welcome, got %#v err=%v", welcome, err)
	}

	// Subscribe and send prompt
	subEnv, _ := protocol.NewEnvelope(protocol.TypeSessionSubscribe, "s1", protocol.SessionSubscribePayload{SessionID: "s1"})
	_ = clientConn.WriteJSON(subEnv)

	var histReq protocol.Envelope
	if err := agentConn.ReadJSON(&histReq); err != nil || histReq.Type != protocol.TypeHistoryRequest {
		t.Fatalf("expected history.request on agent, got %#v err=%v", histReq, err)
	}

	promptEnv, _ := protocol.NewEnvelope(protocol.TypePromptSend, "s1", protocol.PromptSendPayload{Text: "run tests"})
	_ = clientConn.WriteJSON(promptEnv)

	var agentPrompt protocol.Envelope
	if err := agentConn.ReadJSON(&agentPrompt); err != nil || agentPrompt.Type != protocol.TypePromptSend {
		t.Fatalf("expected prompt.send on agent, got %#v err=%v", agentPrompt, err)
	}

	// Agent streams delta back
	deltaEnv, _ := protocol.NewEnvelope(protocol.TypeStreamDelta, "s1", map[string]string{"kind": "text", "delta": "ok"})
	_ = agentConn.WriteJSON(deltaEnv)

	var clientDelta protocol.Envelope
	if err := clientConn.ReadJSON(&clientDelta); err != nil || clientDelta.Type != protocol.TypeStreamDelta || clientDelta.Seq != 1 {
		t.Fatalf("expected stream.delta seq 1 on client, got %#v err=%v", clientDelta, err)
	}
}

func TestPeerOverflowClosesOnlyWhenRequested(t *testing.T) {
	serverConns := make(chan *websocket.Conn, 2)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err == nil {
			serverConns <- conn
		}
	}))
	defer ts.Close()

	for _, closeOnOverflow := range []bool{false, true} {
		remote, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http"), nil)
		if err != nil {
			t.Fatalf("dial failed: %v", err)
		}
		defer remote.Close()
		conn := <-serverConns
		defer conn.Close()

		peer := newWSPeer(conn, time.Minute, 1)
		peer.closeOnOverflow = closeOnOverflow
		if !peer.enqueue(protocol.Envelope{Type: "a"}) || peer.enqueue(protocol.Envelope{Type: "b"}) {
			t.Fatal("expected only the first enqueue to succeed")
		}

		_ = remote.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
		_, _, readErr := remote.ReadMessage()
		var netErr net.Error
		timedOut := errors.As(readErr, &netErr) && netErr.Timeout()
		if timedOut == closeOnOverflow {
			t.Fatalf("closeOnOverflow=%v: unexpected read result: %v", closeOnOverflow, readErr)
		}
	}
}
