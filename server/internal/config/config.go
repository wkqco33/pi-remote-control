package config

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultAddr            = "127.0.0.1:8787"
	DefaultRingBufferSize  = 512
	DefaultMaxMessageBytes = 10 * 1024 * 1024
	DefaultAuthTimeout     = 5 * time.Second
	DefaultPingInterval    = 25 * time.Second
)

// Config holds immutable server runtime settings.
type Config struct {
	Addr            string
	ServerToken     string
	DevNoAuth       bool
	AllowedOrigins  []string
	RingBufferSize  int
	MaxMessageBytes int64
	AuthTimeout     time.Duration
	PingInterval    time.Duration
}

// Load parses environment variables and CLI flags into a validated Config.
func Load(args []string, getenv func(string) string) (Config, error) {
	cfg := Config{
		Addr:            DefaultAddr,
		RingBufferSize:  DefaultRingBufferSize,
		MaxMessageBytes: DefaultMaxMessageBytes,
		AuthTimeout:     DefaultAuthTimeout,
		PingInterval:    DefaultPingInterval,
	}

	if v := strings.TrimSpace(getenv("PI_REMOTE_ADDR")); v != "" {
		cfg.Addr = v
	}
	if v := getenv("PI_REMOTE_SERVER_TOKEN"); v != "" {
		cfg.ServerToken = strings.TrimSpace(v)
	}
	if v := strings.TrimSpace(getenv("PI_REMOTE_DEV_NO_AUTH")); v == "1" || strings.EqualFold(v, "true") {
		cfg.DevNoAuth = true
	}
	if v := strings.TrimSpace(getenv("PI_REMOTE_ALLOWED_ORIGINS")); v != "" {
		cfg.AllowedOrigins = splitCSV(v)
	}
	if v := strings.TrimSpace(getenv("PI_REMOTE_RING_BUFFER_SIZE")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return Config{}, fmt.Errorf("invalid PI_REMOTE_RING_BUFFER_SIZE: %w", err)
		}
		cfg.RingBufferSize = n
	}
	if v := strings.TrimSpace(getenv("PI_REMOTE_MAX_MESSAGE_BYTES")); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return Config{}, fmt.Errorf("invalid PI_REMOTE_MAX_MESSAGE_BYTES: %w", err)
		}
		cfg.MaxMessageBytes = n
	}
	if v := strings.TrimSpace(getenv("PI_REMOTE_AUTH_TIMEOUT")); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return Config{}, fmt.Errorf("invalid PI_REMOTE_AUTH_TIMEOUT: %w", err)
		}
		cfg.AuthTimeout = d
	}
	if v := strings.TrimSpace(getenv("PI_REMOTE_PING_INTERVAL")); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return Config{}, fmt.Errorf("invalid PI_REMOTE_PING_INTERVAL: %w", err)
		}
		cfg.PingInterval = d
	}

	var originsFlag string
	fs := flag.NewFlagSet("pi-remote-server", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.StringVar(&cfg.Addr, "addr", cfg.Addr, "HTTP/WebSocket listen address")
	fs.StringVar(&cfg.ServerToken, "token", cfg.ServerToken, "Shared server authentication token")
	fs.BoolVar(&cfg.DevNoAuth, "dev-no-auth", cfg.DevNoAuth, "Allow unauthenticated connections on a loopback IP (development only)")
	fs.StringVar(&originsFlag, "allowed-origins", "", "Comma-separated allowed WebSocket origins")
	fs.IntVar(&cfg.RingBufferSize, "ring-buffer-size", cfg.RingBufferSize, "Per-session event ring buffer capacity")
	fs.Int64Var(&cfg.MaxMessageBytes, "max-message-bytes", cfg.MaxMessageBytes, "Maximum WebSocket message size in bytes")
	fs.DurationVar(&cfg.AuthTimeout, "auth-timeout", cfg.AuthTimeout, "Initial WebSocket authentication frame timeout")
	fs.DurationVar(&cfg.PingInterval, "ping-interval", cfg.PingInterval, "WebSocket ping interval")

	if err := fs.Parse(args); err != nil {
		return Config{}, fmt.Errorf("parse flags: %w", err)
	}
	if strings.TrimSpace(originsFlag) != "" {
		cfg.AllowedOrigins = splitCSV(originsFlag)
	}

	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// Validate checks invariants on Config.
func (c Config) Validate() error {
	if strings.TrimSpace(c.Addr) == "" {
		return errors.New("addr must not be empty")
	}
	if !c.DevNoAuth && strings.TrimSpace(c.ServerToken) == "" {
		return errors.New("server token is required unless --dev-no-auth / PI_REMOTE_DEV_NO_AUTH=1 is set")
	}
	if c.DevNoAuth {
		host, _, err := net.SplitHostPort(c.Addr)
		if err != nil {
			return fmt.Errorf("invalid listen address: %w", err)
		}
		ip, err := netip.ParseAddr(host)
		if err != nil || !ip.Unmap().IsLoopback() {
			return errors.New("dev-no-auth requires a numeric loopback listen address (127.0.0.1 or ::1)")
		}
	}
	if c.RingBufferSize < 1 {
		return errors.New("ring-buffer-size must be >= 1")
	}
	if c.MaxMessageBytes < 1024 {
		return errors.New("max-message-bytes must be >= 1024")
	}
	if c.AuthTimeout <= 0 {
		return errors.New("auth-timeout must be > 0")
	}
	if c.PingInterval <= 0 {
		return errors.New("ping-interval must be > 0")
	}
	return nil
}

func splitCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
