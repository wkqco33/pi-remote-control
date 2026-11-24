package config

import (
	"testing"
	"time"
)

func TestLoadRequiresTokenUnlessDevNoAuth(t *testing.T) {
	_, err := Load(nil, func(string) string { return "" })
	if err == nil {
		t.Fatal("expected error when token is missing and dev-no-auth is false")
	}

	cfg, err := Load([]string{"--dev-no-auth"}, func(string) string { return "" })
	if err != nil {
		t.Fatalf("unexpected error with --dev-no-auth: %v", err)
	}
	if !cfg.DevNoAuth {
		t.Fatal("expected DevNoAuth=true")
	}
	if cfg.Addr != "127.0.0.1:8787" {
		t.Fatalf("expected default IPv4 loopback at port 8787, got %q", cfg.Addr)
	}
}

func TestDevNoAuthRequiresLoopback(t *testing.T) {
	for _, addr := range []string{"127.0.0.1:8787", "[::1]:8787"} {
		if _, err := Load([]string{"--dev-no-auth", "--addr", addr}, func(string) string { return "" }); err != nil {
			t.Errorf("loopback address %q rejected: %v", addr, err)
		}
	}
	for _, addr := range []string{":8787", "0.0.0.0:8787", "[::]:8787", "192.0.2.1:8787", "relay.example:8787", "127.0.0.1"} {
		_, err := Load(nil, func(key string) string {
			switch key {
			case "PI_REMOTE_DEV_NO_AUTH":
				return "1"
			case "PI_REMOTE_ADDR":
				return addr
			default:
				return ""
			}
		})
		if err == nil {
			t.Errorf("dev-no-auth accepted unsafe or malformed address %q", addr)
		}
	}
}

func TestLoadEnvAndFlagOverride(t *testing.T) {
	env := map[string]string{
		"PI_REMOTE_ADDR":             ":9090",
		"PI_REMOTE_SERVER_TOKEN":     "secret-123",
		"PI_REMOTE_ALLOWED_ORIGINS":  "https://a.example.com, https://b.example.com",
		"PI_REMOTE_RING_BUFFER_SIZE": "128",
		"PI_REMOTE_AUTH_TIMEOUT":     "8s",
	}
	cfg, err := Load([]string{"--addr", ":7777"}, func(k string) string { return env[k] })
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Addr != ":7777" {
		t.Fatalf("expected flag to override env addr, got %q", cfg.Addr)
	}
	if cfg.ServerToken != "secret-123" {
		t.Fatalf("unexpected token: %q", cfg.ServerToken)
	}
	if len(cfg.AllowedOrigins) != 2 || cfg.AllowedOrigins[0] != "https://a.example.com" || cfg.AllowedOrigins[1] != "https://b.example.com" {
		t.Fatalf("unexpected origins: %#v", cfg.AllowedOrigins)
	}
	if cfg.RingBufferSize != 128 {
		t.Fatalf("expected ring buffer 128, got %d", cfg.RingBufferSize)
	}
	if cfg.AuthTimeout != 8*time.Second {
		t.Fatalf("expected auth timeout 8s, got %v", cfg.AuthTimeout)
	}
}

func TestLoadRejectsInvalidValues(t *testing.T) {
	cases := []struct {
		name string
		args []string
	}{
		{name: "bad ring buffer", args: []string{"--dev-no-auth", "--ring-buffer-size", "0"}},
		{name: "bad max bytes", args: []string{"--dev-no-auth", "--max-message-bytes", "512"}},
		{name: "bad auth timeout", args: []string{"--dev-no-auth", "--auth-timeout", "0s"}},
		{name: "bad ping interval", args: []string{"--dev-no-auth", "--ping-interval", "-1s"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Load(tc.args, func(string) string { return "" }); err == nil {
				t.Fatalf("expected error for %s", tc.name)
			}
		})
	}
}
