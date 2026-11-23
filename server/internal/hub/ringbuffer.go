package hub

import (
	"sync"
	"time"

	"github.com/wkqco33/pi-remote-control/server/internal/protocol"
)

// RingBuffer stores the latest N envelopes for a session with monotonically increasing seq.
type RingBuffer struct {
	mu      sync.Mutex
	cap     int
	items   []protocol.Envelope
	nextSeq uint64
}

func NewRingBuffer(capacity int) *RingBuffer {
	if capacity < 1 {
		capacity = 1
	}
	return &RingBuffer{
		cap:     capacity,
		items:   make([]protocol.Envelope, 0, capacity),
		nextSeq: 1,
	}
}

// Push assigns the next sequence number and appends the envelope.
func (rb *RingBuffer) Push(env protocol.Envelope) protocol.Envelope {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	env.Seq = rb.nextSeq
	rb.nextSeq++
	if env.TS == 0 {
		env.TS = time.Now().UnixMilli()
	}

	if len(rb.items) == rb.cap {
		copy(rb.items, rb.items[1:])
		rb.items[len(rb.items)-1] = env
	} else {
		rb.items = append(rb.items, env)
	}
	return env
}

// LastSeq returns the highest sequence number assigned so far (0 if empty).
func (rb *RingBuffer) LastSeq() uint64 {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	if rb.nextSeq <= 1 {
		return 0
	}
	return rb.nextSeq - 1
}

// Since returns all buffered envelopes with Seq > lastSeq.
// truncated is true when events after lastSeq have already been evicted.
func (rb *RingBuffer) Since(lastSeq uint64) (out []protocol.Envelope, truncated bool) {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	if len(rb.items) == 0 {
		return nil, false
	}

	oldest := rb.items[0].Seq
	if lastSeq > 0 && lastSeq+1 < oldest {
		truncated = true
	} else if lastSeq == 0 && oldest > 1 {
		truncated = true
	}

	for _, item := range rb.items {
		if item.Seq > lastSeq {
			out = append(out, item)
		}
	}
	return out, truncated
}
