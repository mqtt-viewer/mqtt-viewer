package app

import (
	"encoding/json"
	"fmt"
	"mqtt-viewer/backend/mqtt"
	mqttmiddleware "mqtt-viewer/backend/mqtt-middleware"
	"mqtt-viewer/backend/protobuf"
	"strings"
	"testing"
	"time"
)

// Broker-free coverage of the Sparkplug App methods' guard paths. The happy
// paths (decode, alias resolution, rebirth encoding) are covered in the
// sparkplug and mqtt-middleware packages.

func TestGetSparkplugMessageHistoryUnknownConnection(t *testing.T) {
	app := getTestApp(t)
	if _, err := app.GetSparkplugMessageHistory(999); err == nil {
		t.Error("Expected error for unknown connection, got nil")
	}
}

func TestGetSparkplugMessageHistoryEmptyForFreshConnection(t *testing.T) {
	app := getSeededTestApp(t)
	messages, err := app.GetSparkplugMessageHistory(1)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(messages.Messages) != 0 {
		t.Errorf("Expected no messages for a fresh connection, got %v", len(messages.Messages))
	}
}

// sparkplugPipeline feeds encoded Sparkplug payloads through the real decode
// middleware and into the connection's history, the same path receive takes,
// so the replay tests exercise the store's index against real message ids.
type sparkplugPipeline struct {
	t          *testing.T
	conn       *AppConnection
	registry   *protobuf.ProtoRegistry
	middleware *mqttmiddleware.ProtoDecodeMiddleware
	counter    int
}

func newSparkplugPipeline(t *testing.T, conn *AppConnection) *sparkplugPipeline {
	t.Helper()
	dir := t.TempDir()
	if err := protobuf.WriteSparkplugProtoFiles(dir); err != nil {
		t.Fatalf("writing sparkplug proto files: %v", err)
	}
	registry, err := protobuf.LoadProtoRegistry(dir)
	if err != nil {
		t.Fatalf("loading proto registry: %v", err)
	}
	return &sparkplugPipeline{
		t:          t,
		conn:       conn,
		registry:   registry,
		middleware: mqttmiddleware.NewProtoDecodeMiddleware(registry, conn.SparkplugStore),
	}
}

// receive runs one message through decode and into history, returning its id.
func (p *sparkplugPipeline) receive(topic string, timeMs int64, jsonPayload string) string {
	p.t.Helper()
	payload := []byte(jsonPayload)
	if !strings.Contains(topic, "STATE") {
		descriptor, _ := p.registry.GetMessageDescriptorFromName("SparkplugBPayload")
		encoded, err := protobuf.EncodeFromJSONBytes(payload, descriptor)
		if err != nil {
			p.t.Fatalf("encoding %s: %v", topic, err)
		}
		payload = encoded
	}
	p.counter++
	msg := mqtt.MqttMessage{
		Id:                   fmt.Sprintf("msg-%d", p.counter),
		Topic:                topic,
		Payload:              payload,
		TimeMs:               timeMs,
		Time:                 time.UnixMilli(timeMs),
		MiddlewareProperties: &map[string]any{},
	}
	if err := p.middleware.Func(&msg); err != nil {
		p.t.Fatalf("middleware: %v", err)
	}
	p.conn.MqttManager.MessageHistory.AddMessage(msg)
	return msg.Id
}

func idsOf(messages []mqtt.MqttMessage) []string {
	ids := []string{}
	for _, message := range messages {
		ids = append(ids, message.Id)
	}
	return ids
}

// replayed flattens a replay into "topic metric=value" lines, rebuilt data
// messages included, in the order the frontend would fold them.
func replayed(t *testing.T, history SparkplugHistory) []string {
	t.Helper()
	out := []string{}
	for _, m := range history.Messages {
		var payload struct {
			Metrics []struct {
				Name        string  `json:"name"`
				DoubleValue float64 `json:"doubleValue"`
			} `json:"metrics"`
		}
		line := m.Topic
		if json.Unmarshal(m.Payload, &payload) == nil {
			for _, metric := range payload.Metrics {
				line += fmt.Sprintf(" %s=%v", metric.Name, metric.DoubleValue)
			}
		}
		out = append(out, line)
	}
	return out
}

func TestGetSparkplugMessageHistoryReplaysLatestValuePerMetric(t *testing.T) {
	app := getSeededTestApp(t)
	p := newSparkplugPipeline(t, testConn(t, app, 1))

	p.receive("spBv1.0/G/NBIRTH/N", 1000,
		`{"seq":"0","metrics":[{"name":"A","alias":"1","datatype":10,"doubleValue":1},{"name":"B","alias":"2","datatype":10,"doubleValue":2}]}`)
	p.receive("spBv1.0/G/NDATA/N", 1100, `{"seq":"1","metrics":[{"alias":"1","doubleValue":10}]}`)
	p.receive("spBv1.0/G/NDATA/N", 1200, `{"seq":"2","metrics":[{"alias":"2","doubleValue":20}]}`)
	p.receive("spBv1.0/G/NDATA/N", 1300, `{"seq":"3","metrics":[{"alias":"1","doubleValue":11}]}`)
	p.receive("STATE/scada-primary", 1400, `{"online":true,"timestamp":1400}`)

	history, err := app.GetSparkplugMessageHistory(1)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	// The newest NDATA only carries A (report by exception), so B's latest
	// value has to come from the older message, and the first A update is
	// superseded.
	got := strings.Join(replayed(t, history), " | ")
	want := strings.Join([]string{
		"spBv1.0/G/NBIRTH/N A=1 B=2",
		"spBv1.0/G/NDATA/N B=20",
		"spBv1.0/G/NDATA/N A=11",
		"STATE/scada-primary",
	}, " | ")
	if got != want {
		t.Fatalf("Expected replay\n  %s\ngot\n  %s", want, got)
	}
	meta, ok := (*history.Messages[1].MiddlewareProperties)["sparkplug"].(map[string]any)
	if !ok || meta["resolution"] != "resolved" || meta["msgType"] != "NDATA" {
		t.Errorf("Expected rebuilt NDATA to carry sparkplug meta, got %v", history.Messages[1].MiddlewareProperties)
	}
}

// Report by exception meets a busy history: X's latest value lives in an
// NDATA that ages out of the window long before the NBIRTH (pinned as its
// topic's latest message) does. The replay must still show X's latest value,
// not fall back to the birth's.
func TestGetSparkplugMessageHistorySurvivesEviction(t *testing.T) {
	app := getSeededTestApp(t)
	conn := testConn(t, app, 1)
	conn.MqttManager.MessageHistory.SetBudgetBytes(256 * 1024)
	p := newSparkplugPipeline(t, conn)

	p.receive("spBv1.0/G/NBIRTH/N", 1000,
		`{"seq":"0","metrics":[{"name":"X","alias":"1","datatype":10,"doubleValue":1},{"name":"Y","alias":"2","datatype":10,"doubleValue":1}]}`)
	p.receive("spBv1.0/G/NDATA/N", 1100, `{"seq":"1","metrics":[{"alias":"1","doubleValue":2}]}`)
	for i := 0; i < 5000; i++ {
		p.receive("spBv1.0/G/NDATA/N", int64(1200+i),
			fmt.Sprintf(`{"seq":"%d","metrics":[{"alias":"2","doubleValue":%d}]}`, (i+2)%256, i))
	}
	history, _ := app.GetSparkplugMessageHistory(1)
	lines := replayed(t, history)
	last := map[string]string{}
	for _, line := range lines {
		for _, field := range strings.Fields(line)[1:] {
			kv := strings.SplitN(field, "=", 2)
			last[kv[0]] = kv[1]
		}
	}
	if last["X"] != "2" || last["Y"] != "4999" {
		t.Fatalf("Expected X=2 and Y=4999 after the replay, got %v from %v", last, lines)
	}
}

// After an NBIRTH, a device that hasn't sent its new DBIRTH yet is still in
// the live tree (awaiting its birth), so the replay must still mention it.
func TestGetSparkplugMessageHistoryKeepsAwaitingBirthDevices(t *testing.T) {
	app := getSeededTestApp(t)
	p := newSparkplugPipeline(t, testConn(t, app, 1))
	p.receive("spBv1.0/G/NBIRTH/N", 1000, `{"seq":"0","metrics":[{"name":"A","alias":"1","datatype":10,"doubleValue":1}]}`)
	p.receive("spBv1.0/G/DBIRTH/N/D", 1100, `{"seq":"1","metrics":[{"name":"T","alias":"1","datatype":10,"doubleValue":1}]}`)
	p.receive("spBv1.0/G/DDATA/N/D", 1200, `{"seq":"2","metrics":[{"alias":"1","doubleValue":2}]}`)
	p.receive("spBv1.0/G/NBIRTH/N", 1300, `{"seq":"0","metrics":[{"name":"A","alias":"1","datatype":10,"doubleValue":1}]}`)
	history, _ := app.GetSparkplugMessageHistory(1)
	for _, line := range replayed(t, history) {
		if strings.Contains(line, "DDATA") {
			t.Errorf("Expected the previous device session's values dropped, got %s", line)
		}
	}
	for _, m := range history.Messages {
		if strings.Contains(m.Topic, "/N/D") {
			return
		}
	}
	t.Fatalf("Expected device D in the replay, got %v", topicsOf(history.Messages))
}

// Messages in one millisecond (a node's connect burst) must replay in
// arrival order, every time.
func TestGetSparkplugMessageHistoryKeepsArrivalOrder(t *testing.T) {
	app := getSeededTestApp(t)
	p := newSparkplugPipeline(t, testConn(t, app, 1))
	want := []string{
		p.receive("spBv1.0/G/NBIRTH/N", 1000, `{"seq":"0","metrics":[{"name":"X","alias":"1","datatype":10,"doubleValue":1}]}`),
	}
	for i := 0; i < 8; i++ {
		want = append(want, p.receive(fmt.Sprintf("spBv1.0/G/DBIRTH/N/D%d", i), 1000,
			fmt.Sprintf(`{"seq":"%d","metrics":[{"name":"T","alias":"1","datatype":10,"doubleValue":1}]}`, i+1)))
	}
	for run := 0; run < 50; run++ {
		history, _ := app.GetSparkplugMessageHistory(1)
		if strings.Join(idsOf(history.Messages), ",") != strings.Join(want, ",") {
			t.Fatalf("run %d: replay order %v, arrival order %v", run, idsOf(history.Messages), want)
		}
	}
}

func TestGetSparkplugMessageHistoryReportsTheLastDrop(t *testing.T) {
	app := getSeededTestApp(t)
	conn := testConn(t, app, 1)
	p := newSparkplugPipeline(t, conn)
	p.receive("spBv1.0/G/NBIRTH/N", 1000, `{"seq":"0","metrics":[{"name":"X","alias":"1","datatype":10,"doubleValue":1}]}`)
	conn.SparkplugStore.Suspend()
	history, _ := app.GetSparkplugMessageHistory(1)
	if history.SuspendedOrd == 0 {
		t.Errorf("Expected the drop's arrival order reported, got 0")
	}
}

func topicsOf(messages []mqtt.MqttMessage) []string {
	topics := []string{}
	for _, message := range messages {
		topics = append(topics, message.Topic)
	}
	return topics
}

func TestPublishSparkplugRebirthRequiresGroupAndNode(t *testing.T) {
	app := getSeededTestApp(t)
	if err := app.PublishSparkplugRebirth(1, "", "node"); err == nil {
		t.Error("Expected error for empty group, got nil")
	}
	if err := app.PublishSparkplugRebirth(1, "group", ""); err == nil {
		t.Error("Expected error for empty edge node, got nil")
	}
}

func TestPublishSparkplugRebirthUnknownConnection(t *testing.T) {
	app := getTestApp(t)
	if err := app.PublishSparkplugRebirth(999, "group", "node"); err == nil {
		t.Error("Expected error for unknown connection, got nil")
	}
}

func TestPublishSparkplugRebirthNotConnected(t *testing.T) {
	app := getSeededTestApp(t)
	if err := app.PublishSparkplugRebirth(1, "group", "node"); err == nil {
		t.Error("Expected error for disconnected connection, got nil")
	}
}

func testConn(t *testing.T, a *App, id uint) *AppConnection {
	t.Helper()
	conn, ok := a.appConnection(id)
	if !ok {
		t.Fatalf("connection %d not found", id)
	}
	return conn
}

// A quiet node's birth is the least recently updated topic there is, so
// plain traffic across enough topics evicts it from history. The replay keeps
// it anyway: births are session state and the store holds them.
func TestSparkplugReplayKeepsBirthsHistoryEvicted(t *testing.T) {
	app := getSeededTestApp(t)
	conn := testConn(t, app, 1)
	conn.MqttManager.MessageHistory.SetBudgetBytes(64 << 20)
	p := newSparkplugPipeline(t, conn)
	p.receive("spBv1.0/G/NBIRTH/N", 1000,
		`{"seq":"0","metrics":[{"name":"Quiet","alias":"1","datatype":10,"doubleValue":7},{"name":"Busy","alias":"2","datatype":10,"doubleValue":1}]}`)
	payload := []byte(strings.Repeat("x", 100))
	for i := 0; i < 1000000; i++ {
		conn.MqttManager.MessageHistory.AddMessage(mqtt.MqttMessage{
			Id: fmt.Sprintf("x%d", i), Topic: fmt.Sprintf("site/area/sensor/%d/value", i),
			Payload: payload, TimeMs: int64(2000 + i), MiddlewareProperties: &map[string]any{},
		})
		if i%1000 == 0 && len(conn.MqttManager.MessageHistory.GetMessagesByIds("spBv1.0/G/NBIRTH/N", []string{"msg-1"}, []int64{1000})) == 0 {
			break
		}
	}
	if len(conn.MqttManager.MessageHistory.GetMessagesByIds("spBv1.0/G/NBIRTH/N", []string{"msg-1"}, []int64{1000})) != 0 {
		t.Fatal("setup: expected history to have evicted the birth")
	}
	p.receive("spBv1.0/G/NDATA/N", 500000, `{"seq":"1","metrics":[{"alias":"2","doubleValue":2}]}`)

	history, _ := app.GetSparkplugMessageHistory(1)
	got := strings.Join(replayed(t, history), " | ")
	if !strings.Contains(got, "NBIRTH/N Quiet=7") {
		t.Fatalf("expected the birth-only metric Quiet=7 replayed, got %s", got)
	}
}

// Repeated samples of one metric in one payload: the latest value is the
// last sample, live and in the replay.
func TestSparkplugReplayKeepsLastSampleOfRepeatedMetric(t *testing.T) {
	app := getSeededTestApp(t)
	p := newSparkplugPipeline(t, testConn(t, app, 1))
	p.receive("spBv1.0/G/NBIRTH/N", 1000, `{"seq":"0","metrics":[{"name":"X","alias":"1","datatype":10,"doubleValue":0}]}`)
	p.receive("spBv1.0/G/NDATA/N", 2000, `{"seq":"1","metrics":[{"alias":"1","timestamp":"1100","doubleValue":1},{"alias":"1","timestamp":"1200","doubleValue":2},{"alias":"1","timestamp":"1300","doubleValue":3}]}`)
	history, _ := app.GetSparkplugMessageHistory(1)
	if got := strings.Join(replayed(t, history), " | "); !strings.Contains(got, "NDATA/N X=3") {
		t.Fatalf("expected the replay to hold the last sample X=3, got %s", got)
	}
}
