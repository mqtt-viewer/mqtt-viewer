package app

import (
	"sync"
	"testing"
)

// Wails runs each binding call on its own goroutine, so the 1s stats poll can
// walk the map while a connection is being added or deleted. Without the lock
// this is a fatal "concurrent map read and map write" that kills the app.
func TestAppConnectionsSurviveConcurrentAccess(t *testing.T) {
	a := &App{}
	const ids = 50

	var wg sync.WaitGroup
	wg.Add(4)

	go func() {
		defer wg.Done()
		for id := uint(1); id <= ids; id++ {
			a.setAppConnection(id, &AppConnection{ConnectionId: id})
		}
	}()
	go func() {
		defer wg.Done()
		for id := uint(1); id <= ids; id++ {
			a.removeAppConnection(id)
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < ids; i++ {
			for _, conn := range a.appConnectionsSnapshot() {
				_ = conn.ConnectionId
			}
		}
	}()
	go func() {
		defer wg.Done()
		for id := uint(1); id <= ids; id++ {
			a.appConnection(id)
			a.appConnectionCount()
		}
	}()

	wg.Wait()
}

func TestAppConnectionHelpersRoundTrip(t *testing.T) {
	a := &App{}
	if a.appConnectionCount() != 0 {
		t.Fatalf("expected empty map, got %d", a.appConnectionCount())
	}
	if _, ok := a.appConnection(1); ok {
		t.Error("expected no connection before one is set")
	}

	a.setAppConnection(1, &AppConnection{ConnectionId: 1})
	conn, ok := a.appConnection(1)
	if !ok || conn.ConnectionId != 1 {
		t.Fatalf("expected connection 1, got %v (ok=%v)", conn, ok)
	}
	if a.appConnectionCount() != 1 {
		t.Errorf("expected 1 connection, got %d", a.appConnectionCount())
	}

	// The snapshot must be a copy: mutating it cannot reach the live map.
	snapshot := a.appConnectionsSnapshot()
	delete(snapshot, 1)
	if _, ok := a.appConnection(1); !ok {
		t.Error("deleting from the snapshot changed the live map")
	}

	a.removeAppConnection(1)
	if _, ok := a.appConnection(1); ok {
		t.Error("expected connection removed")
	}

	a.replaceAppConnections(map[uint]*AppConnection{2: {ConnectionId: 2}})
	if _, ok := a.appConnection(2); !ok {
		t.Error("expected replaced set to contain connection 2")
	}
	if a.appConnectionCount() != 1 {
		t.Errorf("expected 1 connection after replace, got %d", a.appConnectionCount())
	}
}
