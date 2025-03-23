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

type PingerV5 struct {
	logCtx            context.Context
	lastPacketSent    time.Time
	lastPingSent      time.Time
	lastPingResponse  time.Time
	lastPingLatencyMs int32
	onNewLatencyMs    func(int32)

	debug log.Logger

	running bool // Used to prevent concurrent calls to Run

	mu sync.Mutex // Protects all of the above
}

func newPingerV5(ctx context.Context, onNewLatencyMs func(int32)) *PingerV5 {
	return &PingerV5{
		logCtx:         ctx,
		debug:          log.NOOPLogger{},
		onNewLatencyMs: onNewLatencyMs,
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
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		p.running = false
		p.mu.Unlock()
	}()

	// interval := time.Duration(keepAlive) * time.Second
	interval := time.Second * 2
	timer := time.NewTimer(0) // Immediately send first pingreq
	for {
		select {
		case <-ctx.Done():
			timer.Stop() // We don't care if the timer has fired
			return nil
		case <-timer.C:
			p.mu.Lock()
			// Only send a ping if a ping has recently arrived, or it's been more than 5 seconds
			// (it may have been missed)
			since := time.Since(p.lastPingResponse)
			if since < interval || since > time.Second*5 {
				if since > time.Second*5 {
					slog.WarnContext(p.logCtx, fmt.Sprintf("ping response handler waited longer than 5000ms, assuming no response"))
				}
				p.lastPingSent = time.Now() // set before sending because WriteTo may return after PINGRESP is handled
				if _, err := packets.NewControlPacket(packets.PINGREQ).WriteTo(conn); err != nil {
					slog.Error(fmt.Sprintf("ping packet write error: %v", err))
					p.mu.Unlock()
					return fmt.Errorf("failed to send PINGREQ: %w", err)
				}
			}
			timer.Reset(interval)
			p.mu.Unlock()
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
	defer p.mu.Unlock()
	p.lastPingResponse = time.Now()
	p.lastPingLatencyMs = int32(p.lastPingResponse.UnixMilli()) - int32(p.lastPingSent.UnixMilli())
	if p.onNewLatencyMs != nil {
		p.onNewLatencyMs(p.lastPingLatencyMs)
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
