package httpserver

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	browserAuthCookie = "pi_remote_browser"
	browserAuthPath   = "/ws/client"
	browserAuthTTL    = 30 * 24 * time.Hour
)

func tokenMatches(expected string, provided string, devNoAuth bool) bool {
	if devNoAuth && expected == "" {
		return true
	}
	if expected == "" || provided == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(provided)) == 1
}

func extractBearerToken(r *http.Request) string {
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(auth) < 7 {
		return ""
	}
	if !strings.EqualFold(auth[:7], "Bearer ") {
		return ""
	}
	return strings.TrimSpace(auth[7:])
}

func browserOrigin(r *http.Request) string {
	origin, err := url.Parse(r.Header.Get("Origin"))
	if err != nil || origin.User != nil || origin.Path != "" || origin.RawQuery != "" ||
		origin.ForceQuery || origin.Fragment != "" || !strings.EqualFold(origin.Host, r.Host) {
		return ""
	}
	if origin.Scheme != "https" && (origin.Scheme != "http" || r.TLS != nil) {
		return ""
	}
	if origin.Scheme == "http" {
		host := origin.Hostname()
		if !strings.EqualFold(host, "localhost") && !net.ParseIP(host).IsLoopback() {
			return ""
		}
	}
	// Preserve the public Host at a reverse proxy so a matching HTTPS origin
	// identifies the browser-facing scheme even when upstream traffic uses HTTP.
	return origin.Scheme + "://" + strings.ToLower(origin.Host)
}

func browserAuthMAC(serverToken, origin, claims string) []byte {
	mac := hmac.New(sha256.New, []byte(serverToken))
	mac.Write([]byte("pi-remote browser auth v1\n" + origin + "\n" + claims))
	return mac.Sum(nil)
}

func newBrowserAuthValue(serverToken, origin string, expires time.Time) string {
	claims := strconv.FormatInt(expires.Unix(), 10) + "." + rand.Text()
	signature := base64.RawURLEncoding.EncodeToString(browserAuthMAC(serverToken, origin, claims))
	return claims + "." + signature
}

// verifyBrowserAuth returns the authenticated cookie value and expiration.
func verifyBrowserAuth(r *http.Request, serverToken string, now time.Time) (string, time.Time) {
	origin := browserOrigin(r)
	if origin == "" || serverToken == "" {
		return "", time.Time{}
	}
	cookie, err := r.Cookie(browserAuthCookie)
	if err != nil {
		return "", time.Time{}
	}
	end := strings.LastIndexByte(cookie.Value, '.')
	if end < 0 {
		return "", time.Time{}
	}
	claims, signature := cookie.Value[:end], cookie.Value[end+1:]
	expiresAt, _, ok := strings.Cut(claims, ".")
	if !ok {
		return "", time.Time{}
	}
	unix, err := strconv.ParseInt(expiresAt, 10, 64)
	if err != nil || unix <= now.Unix() {
		return "", time.Time{}
	}
	decoded, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil || !hmac.Equal(decoded, browserAuthMAC(serverToken, origin, claims)) {
		return "", time.Time{}
	}
	return cookie.Value, time.Unix(unix, 0)
}

func browserClientID(serverToken, cookie, tabID string) string {
	mac := hmac.New(sha256.New, []byte(serverToken))
	mac.Write([]byte("pi-remote browser identity v1\n" + cookie + "\n" + tabID))
	return "browser-" + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Server) handleBrowserAuth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		w.Header().Set("Allow", "POST, DELETE")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	origin := browserOrigin(r)
	if origin == "" {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	cookie := http.Cookie{
		Name:     browserAuthCookie,
		Path:     browserAuthPath,
		HttpOnly: true,
		Secure:   strings.HasPrefix(origin, "https://"),
		SameSite: http.SameSiteStrictMode,
	}
	if r.Method == http.MethodDelete {
		cookie.MaxAge = -1
		cookie.Expires = time.Unix(0, 0)
		http.SetCookie(w, &cookie)
	} else if !tokenMatches(s.cfg.ServerToken, extractBearerToken(r), s.cfg.DevNoAuth) {
		http.Error(w, "invalid server token", http.StatusUnauthorized)
		return
	} else if s.cfg.ServerToken != "" {
		cookie.MaxAge = int(browserAuthTTL / time.Second)
		cookie.Expires = time.Now().Add(browserAuthTTL)
		cookie.Value = newBrowserAuthValue(s.cfg.ServerToken, origin, cookie.Expires)
		http.SetCookie(w, &cookie)
	}
	w.WriteHeader(http.StatusNoContent)
}
