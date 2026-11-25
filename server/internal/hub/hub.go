package hub

import (
	"encoding/json"
	"sort"
	"sync"
	"time"

	"github.com/wkqco33/pi-remote-control/server/internal/protocol"
)

// SendFunc enqueues an envelope for delivery without blocking.
// Returning false signals that the peer's buffer is full or closed.
type SendFunc func(env protocol.Envelope) bool

type agentEntry struct {
	gen     uint64
	summary protocol.SessionSummary
	ring    *RingBuffer
	send    SendFunc
}

type clientEntry struct {
	gen           uint64
	id            string
	send          SendFunc
	subscriptions map[string]struct{}
}

// Hub routes messages between connected pi agents and web/mobile clients.
type Hub struct {
	mu             sync.RWMutex
	ringSize       int
	nextGen        uint64
	agents         map[string]*agentEntry
	clients        map[string]*clientEntry
	onAgentReplace func(sessionID string)
}

func New(ringSize int) *Hub {
	if ringSize < 1 {
		ringSize = 1
	}
	return &Hub{
		ringSize: ringSize,
		agents:   make(map[string]*agentEntry),
		clients:  make(map[string]*clientEntry),
	}
}

// RegisterAgent registers or replaces an active pi session.
// Returns the connection generation token used for safe unregistration.
func (h *Hub) RegisterAgent(hello protocol.AgentHelloPayload, send SendFunc) uint64 {
	h.mu.Lock()
	h.nextGen++
	gen := h.nextGen

	existing, exists := h.agents[hello.SessionID]
	var ring *RingBuffer
	if exists {
		ring = existing.ring
	} else {
		ring = NewRingBuffer(h.ringSize)
	}

	state := hello.State
	if state == "" {
		state = "idle"
	}

	h.agents[hello.SessionID] = &agentEntry{
		gen:  gen,
		ring: ring,
		send: send,
		summary: protocol.SessionSummary{
			SessionID:        hello.SessionID,
			SessionName:      hello.SessionName,
			Host:             hello.Host,
			Cwd:              hello.Cwd,
			Branch:           hello.Branch,
			Model:            hello.Model,
			State:            state,
			RequirePairing:   hello.RequirePairing,
			AutoApprove:      hello.AutoApprove,
			ExtensionVersion: hello.ExtensionVersion,
			ConnectedAt:      time.Now().UnixMilli(),
			LastSeq:          ring.LastSeq(),
		},
	}
	sessions := h.listSessionsLocked()
	clients := h.snapshotClientsLocked()
	h.broadcastSessionsUpdate(clients, sessions)
	h.mu.Unlock()
	return gen
}

// UnregisterAgent removes an agent if its generation matches the active one.
func (h *Hub) UnregisterAgent(sessionID string, gen uint64, reason string) {
	h.mu.Lock()
	agent, ok := h.agents[sessionID]
	if !ok || agent.gen != gen {
		h.mu.Unlock()
		return
	}
	delete(h.agents, sessionID)
	sessions := h.listSessionsLocked()
	subs := h.subscribedClientsLocked(sessionID)
	allClients := h.snapshotClientsLocked()

	if env, err := protocol.NewEnvelope(protocol.TypeSessionOffline, sessionID, protocol.SessionOfflinePayload{
		SessionID: sessionID,
		Reason:    reason,
	}); err == nil {
		for _, c := range subs {
			c.send(env)
		}
	}
	h.broadcastSessionsUpdate(allClients, sessions)
	h.mu.Unlock()
}

// RegisterClient registers a browser/API client and returns the initial welcome payload.
func (h *Hub) RegisterClient(clientID string, send SendFunc) (uint64, protocol.ClientWelcomePayload) {
	h.mu.Lock()
	h.nextGen++
	gen := h.nextGen
	h.clients[clientID] = &clientEntry{
		gen:           gen,
		id:            clientID,
		send:          send,
		subscriptions: make(map[string]struct{}),
	}
	sessions := h.listSessionsLocked()
	h.mu.Unlock()

	return gen, protocol.ClientWelcomePayload{
		ClientID: clientID,
		Sessions: sessions,
	}
}

// UnregisterClient removes a client if its generation matches.
func (h *Hub) UnregisterClient(clientID string, gen uint64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	c, ok := h.clients[clientID]
	if !ok || c.gen != gen {
		return
	}
	delete(h.clients, clientID)
}

// Subscribe attaches a client to a session and restores history and pairing state.
func (h *Hub) Subscribe(clientID string, sessionID string, lastSeq uint64) {
	h.mu.Lock()
	defer h.mu.Unlock()

	client, ok := h.clients[clientID]
	if !ok {
		return
	}
	client.subscriptions[sessionID] = struct{}{}
	agent := h.agents[sessionID]

	if agent == nil {
		if env, err := protocol.NewEnvelope(protocol.TypeSessionOffline, sessionID, protocol.SessionOfflinePayload{
			SessionID: sessionID,
			Reason:    "session not connected",
		}); err == nil {
			client.send(env)
		}
		return
	}

	request := protocol.HistoryRequestPayload{ClientID: clientID}
	if lastSeq > 0 && lastSeq <= agent.summary.LastSeq {
		replay, truncated := agent.ring.Since(lastSeq)
		if !truncated {
			request.PairStatusOnly = true
			for _, item := range replay {
				if !client.send(item) {
					request.PairStatusOnly = false
					break
				}
			}
		}
	}
	if req, err := protocol.NewEnvelope(protocol.TypeHistoryRequest, sessionID, request); err == nil {
		req.ClientID = clientID
		agent.send(req)
	}
}

// Unsubscribe detaches a client from a session.
func (h *Hub) Unsubscribe(clientID string, sessionID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if client, ok := h.clients[clientID]; ok {
		delete(client.subscriptions, sessionID)
	}
}

// HandleAgentEvent processes an inbound envelope from an authenticated agent.
func (h *Hub) HandleAgentEvent(sessionID string, env protocol.Envelope) {
	env.SessionID = sessionID
	if env.TS == 0 {
		env.TS = time.Now().UnixMilli()
	}

	h.mu.Lock()
	agent, ok := h.agents[sessionID]
	if !ok {
		h.mu.Unlock()
		return
	}

	var updateSessions []protocol.SessionSummary
	var allClients []*clientEntry
	if env.Type == protocol.TypeSessionState {
		if st, err := protocol.DecodePayload[protocol.SessionStatePayload](env.Payload); err == nil {
			if st.State != "" {
				agent.summary.State = st.State
			}
			if st.SessionName != "" {
				agent.summary.SessionName = st.SessionName
			}
			if st.Branch != "" {
				agent.summary.Branch = st.Branch
			}
			if st.Model != "" {
				agent.summary.Model = st.Model
			}
			agent.summary.RunningTool = st.RunningTool
			if st.AutoApprove != nil {
				agent.summary.AutoApprove = st.AutoApprove
			}
			updateSessions = h.listSessionsLocked()
			allClients = h.snapshotClientsLocked()
		}
	}

	// Pairing events and command catalogs are private to a subscribed client and have no replay sequence.
	switch env.Type {
	case protocol.TypePairRequired, protocol.TypePairStatus, protocol.TypePairResult, protocol.TypeCommandsSnapshot:
		target := h.clients[env.ClientID]
		if target != nil {
			if _, subscribed := target.subscriptions[sessionID]; subscribed {
				env.Seq = 0
				target.send(env)
			}
		}
		h.mu.Unlock()
		return
	case protocol.TypeHistorySnapshot:
		if env.ClientID == "" {
			break
		}
		if target := h.clients[env.ClientID]; target != nil {
			if _, subscribed := target.subscriptions[sessionID]; subscribed {
				// A fresh snapshot replaces any older timeline or replay cursor.
				env.Seq = agent.summary.LastSeq
				target.send(env)
			}
		}
		h.mu.Unlock()
		return
	}

	sequenced := agent.ring.Push(env)
	agent.summary.LastSeq = sequenced.Seq
	// Enqueue under the replay lock so a subscriber sees each event as
	// either replay or live delivery.
	for _, c := range h.subscribedClientsLocked(sessionID) {
		c.send(sequenced)
	}
	if updateSessions != nil {
		h.broadcastSessionsUpdate(allClients, updateSessions)
	}
	h.mu.Unlock()
}

// HandleClientCommand routes an inbound command from a client to the target agent.
func (h *Hub) HandleClientCommand(clientID string, env protocol.Envelope) {
	sessionID := env.SessionID
	if sessionID == "" {
		sessionID = extractSessionID(env.Payload)
	}
	if sessionID == "" {
		h.sendErrorToClient(clientID, "", "missing_session", "sessionId is required")
		return
	}

	h.mu.RLock()
	agent := h.agents[sessionID]
	h.mu.RUnlock()

	if agent == nil {
		h.sendErrorToClient(clientID, sessionID, "session_offline", "target pi session is not connected")
		return
	}

	env.SessionID = sessionID
	env.ClientID = clientID
	if env.TS == 0 {
		env.TS = time.Now().UnixMilli()
	}
	agent.send(env)
}

// ListSessions returns a sorted snapshot of active sessions.
func (h *Hub) ListSessions() []protocol.SessionSummary {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.listSessionsLocked()
}

func (h *Hub) listSessionsLocked() []protocol.SessionSummary {
	out := make([]protocol.SessionSummary, 0, len(h.agents))
	for _, a := range h.agents {
		out = append(out, a.summary)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ConnectedAt != out[j].ConnectedAt {
			return out[i].ConnectedAt < out[j].ConnectedAt
		}
		return out[i].SessionID < out[j].SessionID
	})
	return out
}

func (h *Hub) snapshotClientsLocked() []*clientEntry {
	out := make([]*clientEntry, 0, len(h.clients))
	for _, c := range h.clients {
		out = append(out, c)
	}
	return out
}

func (h *Hub) subscribedClientsLocked(sessionID string) []*clientEntry {
	out := make([]*clientEntry, 0)
	for _, c := range h.clients {
		if _, ok := c.subscriptions[sessionID]; ok {
			out = append(out, c)
		}
	}
	return out
}

func (h *Hub) broadcastSessionsUpdate(clients []*clientEntry, sessions []protocol.SessionSummary) {
	if len(clients) == 0 {
		return
	}
	env, err := protocol.NewEnvelope(protocol.TypeSessionsUpdate, "", protocol.SessionsUpdatePayload{
		Sessions: sessions,
	})
	if err != nil {
		return
	}
	for _, c := range clients {
		c.send(env)
	}
}

func (h *Hub) sendErrorToClient(clientID string, sessionID string, code string, message string) {
	h.mu.RLock()
	c := h.clients[clientID]
	h.mu.RUnlock()
	if c == nil {
		return
	}
	if env, err := protocol.NewEnvelope(protocol.TypeError, sessionID, protocol.ErrorPayload{
		Code:    code,
		Message: message,
	}); err == nil {
		c.send(env)
	}
}

func extractSessionID(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var obj struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(raw, &obj); err != nil {
		return ""
	}
	return obj.SessionID
}
