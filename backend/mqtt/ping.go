package mqtt

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"sync"
	"time"

	"github.com/eclipse/paho.golang/packets"
	"github.com/eclipse/paho.golang/paho/log"
)

// Copy of interface from pago.Pinger for easy reference
type Pinger interface {
	// Run starts the pinger. It blocks until the pinger is stopped.
	// If the pinger stops due to an error, it returns the error.
	// If the keepAlive is 0, it returns nil immediately.
	// Run() may be called multiple times, but only after prior instances have terminated.
	Run(ctx context.Context, conn net.Conn, keepAlive uint16) error

	// PacketSent is called when a packet is sent to the server.
	PacketSent()

	// PingResp is called when a PINGRESP is received from the server.
	PingResp()

	// SetDebug sets the logger for debugging.
	// It is not thread-safe and must be called before Run() to avoid race conditions.
	SetDebug(log.Logger)
}

var (
	// How often to send a PINGREQ. The MQTT keepalive is a ceiling, not a
	// target: pinging more often than that is legal and keeps the latency
	// readout in the UI live. A PINGREQ is two bytes, so the cost is noise
	// even against a broker flooding us.
	PING_INTERVAL = 2 * time.Second
	// How long to wait for the PINGRESP before treating the connection as
	// dead. Without this the client sits in "connected" forever whenever a
	// broker goes silent without closing the socket, and never reconnects.
	// Matches the v3 client's PingTimeout.
	PING_TIMEOUT = 10 * time.Second
)

type PingerV5 struct {
	logCtx            context.Context
	lastPacketSent    time.Time
	lastPingSent      time.Time
	lastPingResponse  time.Time
	lastPingLatencyMs int32
	pingOutstanding   bool
	onNewLatencyMs    func(int32)

	interval time.Duration
	timeout  time.Duration

	debug log.Logger

	running bool // Used to prevent concurrent calls to Run

	mu sync.Mutex // Protects all of the above
}

func newPingerV5(ctx context.Context, onNewLatencyMs func(int32)) *PingerV5 {
	return &PingerV5{
		logCtx:         ctx,
		debug:          log.NOOPLogger{},
		onNewLatencyMs: onNewLatencyMs,
		interval:       PING_INTERVAL,
		timeout:        PING_TIMEOUT,
	}
}

// Run starts the pinger; blocks until done (either context cancelled or error encountered)
func (p *PingerV5) Run(ctx context.Context, conn net.Conn, keepAlive uint16) error {
	if keepAlive == 0 {
		p.debug.Println("Run() returning immediately due to keepAlive == 0")
		return nil
	}
	if conn == nil {
		return fmt.Errorf("conn is nil")
	}
	p.mu.Lock()
	if p.running {
		p.mu.Unlock()
		return fmt.Errorf("Run() already in progress")
	}
	p.running = true
	// The pinger instance outlives a single connection (autopaho builds a new
	// paho client per reconnect but reuses this handler), so clear anything
	// left over from the previous connection.
	p.lastPingSent = time.Time{}
	p.lastPingResponse = time.Time{}
	p.pingOutstanding = false
	p.mu.Unlock()

	defer func() {
		p.mu.Lock()
		p.running = false
		p.pingOutstanding = false
		p.mu.Unlock()
	}()

	interval := p.interval
	// The keepalive the server agreed to is an upper bound on the gap between
	// packets, so never ping less often than that.
	if keepAliveInterval := time.Duration(keepAlive) * time.Second; keepAliveInterval < interval {
		interval = keepAliveInterval
	}
	timer := time.NewTimer(0) // Immediately send first pingreq
	for {
		select {
		case <-ctx.Done():
			timer.Stop() // We don't care if the timer has fired
			return nil
		case <-timer.C:
			p.mu.Lock()
			outstanding := p.pingOutstanding
			if outstanding && time.Since(p.lastPingSent) > p.timeout {
				p.mu.Unlock()
				slog.WarnContext(p.logCtx, fmt.Sprintf("no PINGRESP after %s, treating connection as lost", p.timeout))
				return fmt.Errorf("no PINGRESP received within %s", p.timeout)
			}
			if !outstanding {
				// Set before sending: WriteTo may return after the PINGRESP
				// has already been handled.
				p.lastPingSent = time.Now()
				p.pingOutstanding = true
			}
			p.mu.Unlock()

			if !outstanding {
				// Write outside the lock so a blocked socket cannot stall
				// PacketSent and PingResp, which paho calls from its own loops.
				if _, err := packets.NewControlPacket(packets.PINGREQ).WriteTo(conn); err != nil {
					slog.ErrorContext(p.logCtx, fmt.Sprintf("ping packet write error: %v", err))
					return fmt.Errorf("failed to send PINGREQ: %w", err)
				}
			}
			timer.Reset(interval)
		}
	}
}

func (p *PingerV5) PacketSent() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.lastPacketSent = time.Now()
}

func (p *PingerV5) PingResp() {
	p.mu.Lock()
	p.lastPingResponse = time.Now()
	p.pingOutstanding = false
	if p.lastPingSent.IsZero() {
		// A PINGRESP we did not ask for. Nothing to measure.
		p.mu.Unlock()
		return
	}
	p.lastPingLatencyMs = int32(p.lastPingResponse.Sub(p.lastPingSent).Milliseconds())
	latency := p.lastPingLatencyMs
	onNewLatencyMs := p.onNewLatencyMs
	p.mu.Unlock()

	// Called outside the lock: this runs into app code that emits events.
	if onNewLatencyMs != nil {
		onNewLatencyMs(latency)
	}
}

func (p *PingerV5) SetDebug(debug log.Logger) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.debug = debug
}

// Not yet enabled
func (mm *MqttManager) sendPingV3() {
	if mm.connection.v3Connection == nil {
		slog.WarnContext(mm.ctx, "attempted to send ping while not connected")
		return
	}
}
