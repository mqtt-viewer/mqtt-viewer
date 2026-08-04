package mqtt

import (
	"strings"
	"sync"
	"testing"
	"time"
)

// The ID used to be the Unix second, so every call inside the same second
// returned the same string and two connections evicted each other's session.
func TestGeneratedClientIdsAreUnique(t *testing.T) {
	const runs = 1000
	seen := make(map[string]bool, runs)
	for i := 0; i < runs; i++ {
		id := getUniqueClientId()
		if seen[id] {
			t.Fatalf("duplicate client ID after %d calls: %q", i, id)
		}
		seen[id] = true
	}
}

// Brokers are commonly configured with ACLs keyed on the prefix, and MQTT
// 3.1.1 only obliges a broker to accept 23 bytes.
func TestGeneratedClientIdShape(t *testing.T) {
	id := getUniqueClientId()
	if !strings.HasPrefix(id, clientIdPrefix) {
		t.Errorf("client ID %q lost the %q prefix", id, clientIdPrefix)
	}
	if len(id) > maxGeneratedClientIdBytes {
		t.Errorf("client ID %q is %d bytes, over the %d a broker must accept",
			id, len(id), maxGeneratedClientIdBytes)
	}
	if id == clientIdPrefix {
		t.Errorf("client ID %q has no unique suffix", id)
	}
}

// Generating concurrently must not hand out the same ID either.
func TestGeneratedClientIdsAreUniqueConcurrently(t *testing.T) {
	const goroutines = 8
	const perGoroutine = 200

	var mu sync.Mutex
	seen := make(map[string]bool, goroutines*perGoroutine)
	var wg sync.WaitGroup
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < perGoroutine; j++ {
				id := getUniqueClientId()
				mu.Lock()
				if seen[id] {
					t.Errorf("duplicate client ID %q", id)
				}
				seen[id] = true
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
}

// The behaviour that actually matters: two connections opened at the same
// moment, as happens when the app reconnects several saved connections to one
// broker, must both stay up rather than evicting each other. Needs the local
// test broker (scripts/test-broker.sh up).
func TestConcurrentConnectionsToOneBrokerBothSurvive(t *testing.T) {
	const connections = 4

	managers := make([]*MqttManager, connections)
	for i := range managers {
		managers[i] = getTestMqttManager(t)
	}

	// Connect them together so they land inside the same second.
	var wg sync.WaitGroup
	errs := make([]error, connections)
	for i, m := range managers {
		wg.Add(1)
		go func(i int, m *MqttManager) {
			defer wg.Done()
			errs[i] = m.Connect(MqttConnectionDetails{
				Host:        "localhost",
				Port:        1883,
				Protocol:    "mqtt",
				MqttVersion: "5",
			}, []SubscribeParams{{Topic: testTopic(t), QoS: 0}})
		}(i, m)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("connection %d failed to connect: %v", i, err)
		}
	}

	// Every client ID should be distinct, which is what stops the eviction.
	seen := make(map[string]bool, connections)
	for i, m := range managers {
		id := m.connection.clientId
		if seen[id] {
			t.Fatalf("connection %d reused client ID %q", i, id)
		}
		seen[id] = true
	}

	// Give the broker a moment to drop anyone it decided to evict, then check
	// they are all still connected.
	time.Sleep(time.Second)
	for i, m := range managers {
		if state := m.ConnectionState; state != ConnectionStates.Connected {
			t.Errorf("connection %d is %s, expected it to stay connected", i, state)
		}
	}
}
