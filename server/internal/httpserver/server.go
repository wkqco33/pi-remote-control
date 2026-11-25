package httpserver

import (
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/wkqco33/pi-remote-control/server/internal/config"
	"github.com/wkqco33/pi-remote-control/server/internal/hub"
	"github.com/wkqco33/pi-remote-control/server/internal/protocol"
)

const (
	agentQueueSize = 128
	// Clients receive replay bursts of up to one ring buffer per subscribed session.
	clientQueueSize = 4096
)

// Server serves the embedded Web UI, REST endpoints, and WebSocket relays.
type Server struct {
	cfg    config.Config
	hub    *hub.Hub
	logger *slog.Logger
	mux    *http.ServeMux
}

func New(cfg config.Config, h *hub.Hub, logger *slog.Logger) *Server {
	s := &Server{
		cfg:    cfg,
		hub:    h,
		logger: logger,
		mux:    http.NewServeMux(),
	}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return s.mux
}

func (s *Server) routes() {
	s.mux.HandleFunc("/healthz", s.handleHealth)
	s.mux.HandleFunc("/readyz", s.handleHealth)
	s.mux.HandleFunc("/api/sessions", s.handleSessions)
	s.mux.HandleFunc("/api/browser-auth", s.handleBrowserAuth)
	s.mux.HandleFunc("/ws/agent", s.handleAgentWS)
	s.mux.HandleFunc("/ws/client", s.handleClientWS)

	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		panic(err)
	}
	static, err := newStaticHandler(sub)
	if err != nil {
		panic(err)
	}
	s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		static.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "ok",
		"sessions": len(s.hub.ListSessions()),
	})
}

func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !tokenMatches(s.cfg.ServerToken, extractBearerToken(r), s.cfg.DevNoAuth) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"sessions": s.hub.ListSessions(),
	})
}

func (s *Server) upgrader() websocket.Upgrader {
	return websocket.Upgrader{
		ReadBufferSize:  8192,
		WriteBufferSize: 8192,
		CheckOrigin: func(r *http.Request) bool {
			origin := strings.TrimSpace(r.Header.Get("Origin"))
			if origin == "" {
				return true
			}
			if len(s.cfg.AllowedOrigins) > 0 {
				for _, allowed := range s.cfg.AllowedOrigins {
					if allowed == "*" || strings.EqualFold(allowed, origin) {
						return true
					}
				}
				return false
			}
			u, err := url.Parse(origin)
			if err != nil {
				return false
			}
			return strings.EqualFold(u.Host, r.Host)
		},
	}
}

func (s *Server) handleAgentWS(w http.ResponseWriter, r *http.Request) {
	up := s.upgrader()
	conn, err := up.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	conn.SetReadLimit(s.cfg.MaxMessageBytes)
	_ = conn.SetReadDeadline(time.Now().Add(s.cfg.AuthTimeout))

	var helloEnv protocol.Envelope
	if err := conn.ReadJSON(&helloEnv); err != nil || helloEnv.Type != protocol.TypeAgentHello {
		s.sendWSError(conn, "", "auth_required", "expected agent.hello first frame")
		return
	}
	hello, err := protocol.DecodePayload[protocol.AgentHelloPayload](helloEnv.Payload)
	if err != nil || hello.SessionID == "" {
		s.sendWSError(conn, "", "invalid_hello", "invalid agent.hello payload")
		return
	}
	if !tokenMatches(s.cfg.ServerToken, hello.ServerToken, s.cfg.DevNoAuth) {
		s.sendWSError(conn, hello.SessionID, "unauthorized", "invalid server token")
		return
	}
	_ = conn.SetReadDeadline(time.Time{})

	peer := newWSPeer(conn, s.cfg.PingInterval, agentQueueSize)
	gen := s.hub.RegisterAgent(hello, peer.enqueue)
	s.logger.Info("agent connected", "sessionId", hello.SessionID, "host", hello.Host)
	defer func() {
		peer.close()
		s.hub.UnregisterAgent(hello.SessionID, gen, "connection closed")
		s.logger.Info("agent disconnected", "sessionId", hello.SessionID)
	}()

	go peer.writeLoop()

	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(s.cfg.PingInterval * 2))
		return nil
	})
	_ = conn.SetReadDeadline(time.Now().Add(s.cfg.PingInterval * 2))

	for {
		var env protocol.Envelope
		if err := conn.ReadJSON(&env); err != nil {
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(s.cfg.PingInterval * 2))
		if env.Type == protocol.TypePing {
			if pong, err := protocol.NewEnvelope(protocol.TypePong, hello.SessionID, nil); err == nil {
				peer.enqueue(pong)
			}
			continue
		}
		s.hub.HandleAgentEvent(hello.SessionID, env)
	}
}

func (s *Server) handleClientWS(w http.ResponseWriter, r *http.Request) {
	up := s.upgrader()
	conn, err := up.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	conn.SetReadLimit(s.cfg.MaxMessageBytes)
	_ = conn.SetReadDeadline(time.Now().Add(s.cfg.AuthTimeout))

	var helloEnv protocol.Envelope
	if err := conn.ReadJSON(&helloEnv); err != nil || helloEnv.Type != protocol.TypeClientHello {
		s.sendWSError(conn, "", "auth_required", "expected client.hello first frame")
		return
	}
	hello, err := protocol.DecodePayload[protocol.ClientHelloPayload](helloEnv.Payload)
	if err != nil || strings.TrimSpace(hello.ClientID) == "" {
		s.sendWSError(conn, "", "invalid_hello", "invalid client.hello payload")
		return
	}
	if !tokenMatches(s.cfg.ServerToken, hello.ServerToken, s.cfg.DevNoAuth) {
		var cookie string
		var expires time.Time
		if hello.ServerToken == "" {
			cookie, expires = verifyBrowserAuth(r, s.cfg.ServerToken, time.Now())
		}
		if expires.IsZero() {
			s.sendWSError(conn, "", "unauthorized", "invalid server token")
			return
		}
		hello.ClientID = browserClientID(s.cfg.ServerToken, cookie, hello.ClientID)
		timer := time.AfterFunc(time.Until(expires), func() { _ = conn.Close() })
		defer timer.Stop()
	}
	_ = conn.SetReadDeadline(time.Time{})

	peer := newWSPeer(conn, s.cfg.PingInterval, clientQueueSize)
	// A silently dropped event cannot be recovered; reconnecting replays it.
	peer.closeOnOverflow = true
	gen, welcome := s.hub.RegisterClient(hello.ClientID, peer.enqueue)
	s.logger.Info("client connected", "clientId", hello.ClientID)
	defer func() {
		peer.close()
		s.hub.UnregisterClient(hello.ClientID, gen)
		s.logger.Info("client disconnected", "clientId", hello.ClientID)
	}()

	go peer.writeLoop()

	if welcomeEnv, err := protocol.NewEnvelope(protocol.TypeClientWelcome, "", welcome); err == nil {
		peer.enqueue(welcomeEnv)
	}

	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(s.cfg.PingInterval * 2))
		return nil
	})
	_ = conn.SetReadDeadline(time.Now().Add(s.cfg.PingInterval * 2))

	for {
		var env protocol.Envelope
		if err := conn.ReadJSON(&env); err != nil {
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(s.cfg.PingInterval * 2))

		switch env.Type {
		case protocol.TypePing:
			if pong, err := protocol.NewEnvelope(protocol.TypePong, "", nil); err == nil {
				peer.enqueue(pong)
			}
		case protocol.TypeSessionSubscribe:
			sub, err := protocol.DecodePayload[protocol.SessionSubscribePayload](env.Payload)
			if err == nil && sub.SessionID != "" {
				s.hub.Subscribe(hello.ClientID, sub.SessionID, sub.LastSeq)
			}
		case protocol.TypeSessionUnsub:
			sub, err := protocol.DecodePayload[protocol.SessionSubscribePayload](env.Payload)
			if err == nil && sub.SessionID != "" {
				s.hub.Unsubscribe(hello.ClientID, sub.SessionID)
			}
		default:
			s.hub.HandleClientCommand(hello.ClientID, env)
		}
	}
}

func (s *Server) sendWSError(conn *websocket.Conn, sessionID string, code string, message string) {
	if env, err := protocol.NewEnvelope(protocol.TypeError, sessionID, protocol.ErrorPayload{
		Code:    code,
		Message: message,
	}); err == nil {
		_ = conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
		_ = conn.WriteJSON(env)
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

type wsPeer struct {
	closeOnOverflow bool

	conn         *websocket.Conn
	pingInterval time.Duration
	out          chan protocol.Envelope
	closeOnce    sync.Once
	done         chan struct{}
}

func newWSPeer(conn *websocket.Conn, pingInterval time.Duration, queueSize int) *wsPeer {
	return &wsPeer{
		conn:         conn,
		pingInterval: pingInterval,
		out:          make(chan protocol.Envelope, queueSize),
		done:         make(chan struct{}),
	}
}

func (p *wsPeer) enqueue(env protocol.Envelope) bool {
	select {
	case <-p.done:
		return false
	default:
	}
	select {
	case p.out <- env:
		return true
	default:
		// Slow consumer: never block the hub lock or other peers.
		if p.closeOnOverflow {
			p.close()
			// Closing may flush to the network, so keep it off the caller's lock.
			go func() { _ = p.conn.Close() }()
		}
		return false
	}
}

func (p *wsPeer) close() {
	p.closeOnce.Do(func() {
		close(p.done)
	})
}

func (p *wsPeer) writeLoop() {
	ticker := time.NewTicker(p.pingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-p.done:
			return
		case env := <-p.out:
			_ = p.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := p.conn.WriteJSON(env); err != nil {
				_ = p.conn.Close()
				return
			}
		case <-ticker.C:
			_ = p.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := p.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				_ = p.conn.Close()
				return
			}
		}
	}
}
