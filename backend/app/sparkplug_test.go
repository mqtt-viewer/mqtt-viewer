package app

import (
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
	if len(messages) != 0 {
		t.Errorf("Expected no messages for a fresh connection, got %v", len(messages))
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

func TestGetSparkplugMessageHistoryReplaysLatestValuePerMetric(t *testing.T) {
	app := getSeededTestApp(t)
	p := newSparkplugPipeline(t, testConn(t, app, 1))

	birth := p.receive("spBv1.0/G/NBIRTH/N", 1000,
		`{"seq":"0","metrics":[{"name":"A","alias":"1","datatype":10,"doubleValue":1},{"name":"B","alias":"2","datatype":10,"doubleValue":2}]}`)
	p.receive("spBv1.0/G/NDATA/N", 1100, `{"seq":"1","metrics":[{"alias":"1","doubleValue":10}]}`)
	onlyB := p.receive("spBv1.0/G/NDATA/N", 1200, `{"seq":"2","metrics":[{"alias":"2","doubleValue":20}]}`)
	latestA := p.receive("spBv1.0/G/NDATA/N", 1300, `{"seq":"3","metrics":[{"alias":"1","doubleValue":11}]}`)
	state := p.receive("STATE/scada-primary", 1400, `{"online":true,"timestamp":1400}`)

	messages, err := app.GetSparkplugMessageHistory(1)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	// The newest NDATA only carries A (report by exception), so B's latest
	// value has to come from the older message, and the first A update is
	// superseded.
	got := idsOf(messages)
	want := []string{birth, onlyB, latestA, state}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("Expected replay %v in arrival order, got %v (%v)", want, got, topicsOf(messages))
	}
	// Replayed messages carry the decoded payload and meta, as they were
	// stored.
	meta, ok := (*messages[1].MiddlewareProperties)["sparkplug"].(map[string]any)
	if !ok || meta["resolution"] != "resolved" {
		t.Errorf("Expected replayed NDATA to keep its sparkplug meta, got %v", messages[1].MiddlewareProperties)
	}
}

func TestGetSparkplugMessageHistorySkipsEvictedMessages(t *testing.T) {
	app := getSeededTestApp(t)
	conn := testConn(t, app, 1)
	p := newSparkplugPipeline(t, conn)

	p.receive("spBv1.0/G/NBIRTH/N", 1000, `{"seq":"0","metrics":[{"name":"A","alias":"1","datatype":10,"doubleValue":1}]}`)
	conn.MqttManager.MessageHistory.Clear()
	// History was cleared without resetting the store: its refs now point at
	// nothing, and the replay must come back empty rather than fail.
	messages, err := app.GetSparkplugMessageHistory(1)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(messages) != 0 {
		t.Errorf("Expected no messages once history is gone, got %v", topicsOf(messages))
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
