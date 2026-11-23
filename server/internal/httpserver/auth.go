package httpserver

import (
	"crypto/subtle"
	"net/http"
	"strings"
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
