package mqtt

import (
	"context"
	"net"
	"testing"
	"time"
)

// newTestPinger returns a pinger with short timings and a connection whose
// server side is drained. Every PINGREQ read from the wire is signalled on the
// returned channel.
func newTestPinger(t *testing.T, onNewLatencyMs func(int32)) (*PingerV5, net.Conn, <-chan struct{}) {
	t.Helper()
	client, server := net.Pipe()
	t.Cleanup(func() {
		client.Close()
		server.Close()
	})

	pings := make(chan struct{}, 32)
	go func() {
		buf := make([]byte, 16)
		for {
			n, err := server.Read(buf)
			if err != nil {
				return
			}
			for i := 0; i < n; i += 2 { // PINGREQ is two bytes
				select {
				case pings <- struct{}{}:
				default:
				}
			}
		}
	}()

	p := newPingerV5(context.Background(), onNewLatencyMs)
	p.interval = 20 * time.Millisecond
	p.timeout = 200 * time.Millisecond
	return p, client, pings
}

// A broker that goes silent without closing the socket must be reported as
// dead, otherwise the client sits in "connected" forever and never reconnects.
func TestPingerFailsWhenNoPingResp(t *testing.T) {
	p, conn, pings := newTestPinger(t, nil)

	errCh := make(chan error, 1)
	go func() { errCh <- p.Run(context.Background(), conn, 30) }()

	select {
	case <-pings:
	case <-time.After(time.Second):
		t.Fatal("expected a PINGREQ to be sent")
	}

	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("expected Run to return an error when no PINGRESP arrives")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not report the connection as lost")
	}
}

// While the broker answers, the pinger must keep running and only stop when
// its context is cancelled.
func TestPingerKeepsRunningWhilePingRespArrives(t *testing.T) {
	var latencies []int32
	latencyCh := make(chan int32, 32)
	p, conn, pings := newTestPinger(t, func(ms int32) {
		select {
		case latencyCh <- ms:
		default:
		}
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	errCh := make(chan error, 1)
	go func() { errCh <- p.Run(ctx, conn, 30) }()

	go func() {
		for range pings {
			p.PingResp()
		}
	}()

	// Well past the timeout: with responses arriving the pinger must survive.
	deadline := time.After(p.timeout * 5)
	for {
		select {
		case err := <-errCh:
			t.Fatalf("pinger stopped while the broker was answering: %v", err)
		case ms := <-latencyCh:
			latencies = append(latencies, ms)
		case <-deadline:
			if len(latencies) == 0 {
				t.Fatal("expected at least one latency reading")
			}
			for _, ms := range latencies {
				if ms < 0 || ms > 5000 {
					t.Fatalf("implausible latency reading: %dms", ms)
				}
			}
			cancel()
			select {
			case err := <-errCh:
				if err != nil {
					t.Fatalf("expected nil error on context cancel, got %v", err)
				}
			case <-time.After(time.Second):
				t.Fatal("Run did not return after context cancel")
			}
			return
		}
	}
}

// autopaho reuses one pinger across reconnects, so a run must not inherit the
// previous connection's timestamps.
func TestPingerResetsStateBetweenRuns(t *testing.T) {
	p, conn, pings := newTestPinger(t, nil)

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() { errCh <- p.Run(ctx, conn, 30) }()
	<-pings
	cancel()
	if err := <-errCh; err != nil {
		t.Fatalf("expected nil error on context cancel, got %v", err)
	}

	// The first run left an unanswered ping behind. The second run must start
	// clean and send a fresh PINGREQ rather than immediately timing out.
	p2, conn2, pings2 := newTestPinger(t, nil)
	p2.lastPingSent = p.lastPingSent
	p2.pingOutstanding = true

	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	errCh2 := make(chan error, 1)
	go func() { errCh2 <- p2.Run(ctx2, conn2, 30) }()

	select {
	case <-pings2:
	case err := <-errCh2:
		t.Fatalf("second run failed instead of pinging: %v", err)
	case <-time.After(time.Second):
		t.Fatal("second run did not send a PINGREQ")
	}
}

// A keepalive shorter than the ping interval is the ceiling on how long we may
// stay quiet, so it must win.
func TestPingerRespectsShortKeepAlive(t *testing.T) {
	p, conn, pings := newTestPinger(t, nil)
	p.interval = time.Hour
	p.timeout = 5 * time.Second

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = p.Run(ctx, conn, 1) }()

	answered := make(chan struct{}, 8)
	go func() {
		for range pings {
			p.PingResp()
			answered <- struct{}{}
		}
	}()

	<-answered // first ping is immediate
	select {
	case <-answered:
	case <-time.After(3 * time.Second):
		t.Fatal("expected the 1s keepalive to override the longer ping interval")
	}
}
