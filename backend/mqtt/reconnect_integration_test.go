package mqtt

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// Reconnect tests against a broker this test starts and kills itself. Slow
// (minutes) and needs docker, so gated behind an env var rather than run in
// `just test`:
//
//	MQTT_RECONNECT_TEST=1 go test ./backend/mqtt -run TestReconnect -v -timeout 600s
//
// It uses its own container on its own port on purpose. scripts/test-broker.sh
// binds 1883, and a mosquitto installed on the host binds the same port, so a
// test that stops the container there can end up talking to the host broker
// and silently prove nothing.
const (
	reconnectBrokerName = "mqtt-viewer-reconnect-test-broker"
	reconnectBrokerPort = 18831
)

// The broker is killed in two ways because they fail differently:
//
//   - stop: the socket closes, so the client sees an immediate EOF.
//   - pause: the container freezes with the socket still open. Nothing is
//     returned and nothing is refused, so only the keepalive can notice. This
//     is what a network blackhole, a sleeping laptop or a dropped VPN look
//     like, and it is the case that used to leave the v5 client wedged in
//     "connected" forever.
func TestReconnectAfterBrokerStop(t *testing.T) {
	testReconnect(t, "3", "stop", "start")
	testReconnect(t, "5", "stop", "start")
}

func TestReconnectAfterBrokerGoesSilent(t *testing.T) {
	testReconnect(t, "3", "pause", "unpause")
	testReconnect(t, "5", "pause", "unpause")
}

func testReconnect(t *testing.T, mqttVersion, down, up string) {
	t.Run(fmt.Sprintf("v%s/%s", mqttVersion, down), func(t *testing.T) {
		requireReconnectTest(t)
		startReconnectBroker(t)

		start := time.Now()
		logf := func(format string, args ...any) {
			t.Logf("[%5.1fs] %s", time.Since(start).Seconds(), fmt.Sprintf(format, args...))
		}

		m := getTestMqttManager(t)
		m.SetConnectionCallbacks(MqttConnectionCallbacks{
			OnConnecting:     func() { logf("connecting") },
			OnConnectionUp:   func() { logf("connected") },
			OnConnectionDown: func(e *error) { logf("disconnected: %s", errText(e)) },
			OnReconnecting:   func(e *error) { logf("reconnecting: %s", errText(e)) },
		})

		err := m.Connect(MqttConnectionDetails{
			Host:        "localhost",
			Port:        reconnectBrokerPort,
			Protocol:    "mqtt",
			MqttVersion: mqttVersion,
		}, []SubscribeParams{{Topic: t.Name(), QoS: 0}})
		if err != nil {
			t.Fatalf("initial connect failed: %v", err)
		}
		defer m.Disconnect(nil)
		logf("connected")

		docker(t, down, reconnectBrokerName)

		// The client must notice the broker is gone. With the socket left open
		// this can only come from the keepalive, so allow for the ping timeout.
		if !waitForState(t, m, ConnectionStates.Reconnecting, 45*time.Second) {
			t.Fatalf("client never noticed the broker was gone (state=%s)", m.ConnectionState)
		}
		logf("noticed the broker was gone")

		// Stay down long enough that any give-up-after-N-attempts behaviour
		// would have taken effect.
		time.Sleep(60 * time.Second)
		if m.ConnectionState != ConnectionStates.Reconnecting {
			t.Fatalf("expected to still be retrying after 60s down, got %s", m.ConnectionState)
		}

		docker(t, up, reconnectBrokerName)
		if !waitForState(t, m, ConnectionStates.Connected, 45*time.Second) {
			t.Fatalf("did not reconnect after the broker came back (state=%s)", m.ConnectionState)
		}
		logf("reconnected")
	})
}

func requireReconnectTest(t *testing.T) {
	t.Helper()
	if os.Getenv("MQTT_RECONNECT_TEST") == "" {
		t.Skip("set MQTT_RECONNECT_TEST=1 to run (slow, needs docker)")
	}
}

// startReconnectBroker gives the test a mosquitto it fully owns, and makes sure
// it is running and unpaused whatever the previous test left behind.
func startReconnectBroker(t *testing.T) {
	t.Helper()
	_ = exec.Command("docker", "rm", "-f", reconnectBrokerName).Run()
	out, err := exec.Command("docker", "run", "-d",
		"--name", reconnectBrokerName,
		"-p", fmt.Sprintf("%d:1883", reconnectBrokerPort),
		"eclipse-mosquitto", "sh", "-c",
		"printf 'listener 1883\\nallow_anonymous true\\n' > /mosquitto/config/mosquitto.conf && exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf",
	).CombinedOutput()
	if err != nil {
		t.Fatalf("could not start test broker: %v: %s", err, out)
	}
	t.Cleanup(func() {
		_ = exec.Command("docker", "rm", "-f", reconnectBrokerName).Run()
	})
	time.Sleep(2 * time.Second) // let mosquitto bind
}

func docker(t *testing.T, args ...string) {
	t.Helper()
	out, err := exec.Command("docker", args...).CombinedOutput()
	if err != nil {
		t.Fatalf("docker %s failed: %v: %s", strings.Join(args, " "), err, out)
	}
}

func waitForState(t *testing.T, m *MqttManager, want ConnectionState, timeout time.Duration) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if m.ConnectionState == want {
			return true
		}
		time.Sleep(500 * time.Millisecond)
	}
	return false
}

func errText(e *error) string {
	if e == nil {
		return "no reason given"
	}
	return (*e).Error()
}
