package httpserver

import (
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/wkqco33/pi-remote-control/server/internal/config"
	"github.com/wkqco33/pi-remote-control/server/internal/hub"
	"github.com/wkqco33/pi-remote-control/server/internal/protocol"
)

func TestBrowserAuthLoginAndLogout(t *testing.T) {
	const dummyRelayToken = "test-relay-credential"
	cfg := config.Config{
		ServerToken:     dummyRelayToken,
		AllowedOrigins:  []string{"*"},
		MaxMessageBytes: 4096,
		AuthTimeout:     2 * time.Second,
		PingInterval:    10 * time.Second,
	}
	ts := httptest.NewServer(New(cfg, hub.New(64), testLogger()).Handler())
	defer ts.Close()

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := ts.Client()
	client.Jar = jar
	authRequest := func(method, origin, credential string, want int) *http.Response {
		t.Helper()
		req, err := http.NewRequest(method, ts.URL+"/api/browser-auth", nil)
		if err != nil {
			t.Fatal(err)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if credential != "" {
			req.Header.Set("Authorization", "Bearer "+credential)
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != want || resp.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("%s browser auth status = %d, want %d with no-store", method, resp.StatusCode, want)
		}
		return resp
	}

	authRequest(http.MethodPost, ts.URL, "invalid", http.StatusUnauthorized)
	authRequest(http.MethodPost, "https://another.example", dummyRelayToken, http.StatusForbidden)
	resp := authRequest(http.MethodPost, ts.URL, dummyRelayToken, http.StatusNoContent)
	cookies := resp.Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode ||
		cookies[0].Path != browserAuthPath || cookies[0].MaxAge != int(browserAuthTTL/time.Second) ||
		strings.Contains(cookies[0].Value, dummyRelayToken) {
		t.Fatal("expected scoped, signed browser cookie with a persistent lifetime")
	}

	dialer := websocket.Dialer{Jar: jar, HandshakeTimeout: 2 * time.Second}
	connect := func(origin, want string) string {
		t.Helper()
		headers := http.Header{}
		if origin != "" {
			headers.Set("Origin", origin)
		}
		conn, _, err := dialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http")+browserAuthPath, headers)
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
			t.Fatal(err)
		}
		hello, err := protocol.NewEnvelope(protocol.TypeClientHello, "", protocol.ClientHelloPayload{
			ClientID: "web-test",
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := conn.WriteJSON(hello); err != nil {
			t.Fatal(err)
		}
		var response protocol.Envelope
		if err := conn.ReadJSON(&response); err != nil {
			t.Fatal(err)
		}
		if response.Type != want {
			t.Fatalf("server envelope type = %q, want %q", response.Type, want)
		}
		if response.Type == protocol.TypeClientWelcome {
			welcome, err := protocol.DecodePayload[protocol.ClientWelcomePayload](response.Payload)
			if err != nil {
				t.Fatal(err)
			}
			return welcome.ClientID
		}
		return ""
	}

	browserID := connect(ts.URL, protocol.TypeClientWelcome)
	if !strings.HasPrefix(browserID, "browser-") || connect(ts.URL, protocol.TypeClientWelcome) != browserID {
		t.Fatal("expected stable identity derived from the browser cookie")
	}
	connect("https://another.example", protocol.TypeError)
	connect("", protocol.TypeError)
	authRequest(http.MethodDelete, "https://another.example", "", http.StatusForbidden)
	connect(ts.URL, protocol.TypeClientWelcome)
	authRequest(http.MethodDelete, ts.URL, "", http.StatusNoContent)
	connect(ts.URL, protocol.TypeError)
	authRequest(http.MethodPost, ts.URL, dummyRelayToken, http.StatusNoContent)
	if connect(ts.URL, protocol.TypeClientWelcome) == browserID {
		t.Fatal("new sign-in should produce a new pairing identity")
	}
}

func TestBrowserAuthCookieVerification(t *testing.T) {
	const origin = "https://relay.example"
	const dummyRelayToken = "test-relay-credential"
	now := time.Unix(10000, 0)
	expires := now.Add(browserAuthTTL)
	value := newBrowserAuthValue(dummyRelayToken, origin, expires)
	req := httptest.NewRequest(http.MethodGet, "http://relay.example/ws/client", nil)
	req.Header.Set("Origin", origin)
	req.AddCookie(&http.Cookie{Name: browserAuthCookie, Value: value})
	if _, got := verifyBrowserAuth(req, dummyRelayToken, now); !got.Equal(expires) {
		t.Fatalf("cookie expiry = %v, want %v", got, expires)
	}
	if _, got := verifyBrowserAuth(req, dummyRelayToken, expires); !got.IsZero() {
		t.Fatal("expired cookie was accepted")
	}
	if _, got := verifyBrowserAuth(req, "rotated-credential", now); !got.IsZero() {
		t.Fatal("cookie was accepted after token rotation")
	}
	req.Header.Set("Cookie", browserAuthCookie+"=2"+value)
	if _, got := verifyBrowserAuth(req, dummyRelayToken, now); !got.IsZero() {
		t.Fatal("tampered cookie was accepted")
	}
}

func TestBrowserAuthSecureBehindTLSProxy(t *testing.T) {
	const dummyRelayToken = "test-relay-credential"
	srv := New(config.Config{ServerToken: dummyRelayToken}, hub.New(64), testLogger())
	req := httptest.NewRequest(http.MethodPost, "http://relay.example/api/browser-auth", nil)
	req.Header.Set("Origin", "https://relay.example")
	req.Header.Set("Authorization", "Bearer "+dummyRelayToken)
	recorder := httptest.NewRecorder()
	srv.Handler().ServeHTTP(recorder, req)
	resp := recorder.Result()
	defer resp.Body.Close()
	cookies := resp.Cookies()
	if resp.StatusCode != http.StatusNoContent || len(cookies) != 1 || !cookies[0].Secure {
		t.Fatal("expected a Secure cookie for the browser-facing HTTPS origin")
	}
}

func TestBrowserAuthRequiresHTTPSOnPublicHost(t *testing.T) {
	const dummyRelayToken = "test-relay-credential"
	srv := New(config.Config{ServerToken: dummyRelayToken}, hub.New(64), testLogger())
	req := httptest.NewRequest(http.MethodPost, "http://relay.example/api/browser-auth", nil)
	req.Header.Set("Origin", "http://relay.example")
	req.Header.Set("Authorization", "Bearer "+dummyRelayToken)
	recorder := httptest.NewRecorder()
	srv.Handler().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusForbidden || len(recorder.Result().Cookies()) != 0 {
		t.Fatal("expected to reject browser authentication over public HTTP")
	}
}

func TestEmbeddedUIHasBrowserSecurityHeaders(t *testing.T) {
	srv := New(config.Config{}, hub.New(64), testLogger())
	recorder := httptest.NewRecorder()
	srv.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))
	policy := recorder.Header().Get("Content-Security-Policy")
	if recorder.Code != http.StatusOK || !strings.Contains(policy, "frame-ancestors 'none'") ||
		!strings.Contains(policy, "script-src 'self'") || recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("expected embedded UI to restrict scripts and framing")
	}
}
