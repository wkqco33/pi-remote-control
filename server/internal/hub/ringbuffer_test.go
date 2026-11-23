package hub

import (
	"testing"

	"github.com/wkqco33/pi-remote-control/server/internal/protocol"
)

func TestRingBufferWrapAndSince(t *testing.T) {
	rb := NewRingBuffer(3)
	if rb.LastSeq() != 0 {
		t.Fatalf("expected initial LastSeq 0, got %d", rb.LastSeq())
	}

	for i := 0; i < 5; i++ {
		env := rb.Push(protocol.Envelope{Type: protocol.TypeStreamDelta})
		if env.Seq != uint64(i+1) {
			t.Fatalf("expected seq %d, got %d", i+1, env.Seq)
		}
	}

	if rb.LastSeq() != 5 {
		t.Fatalf("expected LastSeq 5, got %d", rb.LastSeq())
	}

	// Items in buffer are 3, 4, 5.
	items, truncated := rb.Since(0)
	if !truncated || len(items) != 3 || items[0].Seq != 3 || items[2].Seq != 5 {
		t.Fatalf("unexpected Since(0): truncated=%v items=%#v", truncated, items)
	}

	items, truncated = rb.Since(2)
	if truncated || len(items) != 3 || items[0].Seq != 3 {
		t.Fatalf("expected exact continuity from seq 2, got truncated=%v len=%d", truncated, len(items))
	}

	items, truncated = rb.Since(1)
	if !truncated || len(items) != 3 {
		t.Fatalf("expected truncated=true from seq 1, got truncated=%v len=%d", truncated, len(items))
	}

	items, truncated = rb.Since(5)
	if truncated || len(items) != 0 {
		t.Fatalf("expected empty Since(5), got truncated=%v len=%d", truncated, len(items))
	}
}
