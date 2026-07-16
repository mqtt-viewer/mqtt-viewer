package app

import (
	"net/url"
	"strings"
	"testing"
)

func TestChartWindowKey(t *testing.T) {
	if chartWindowKey(3, "a/b") != "3|a/b" {
		t.Errorf("unexpected key: %s", chartWindowKey(3, "a/b"))
	}
	// Same topic on different connections must not collide.
	if chartWindowKey(1, "x") == chartWindowKey(2, "x") {
		t.Error("keys collided across connections")
	}
}

func TestBuildChartWindowURL(t *testing.T) {
	u := buildChartWindowURL(OpenChartWindowParams{
		ConnectionID: 7,
		Topic:        "home/sensors/34",
		Fields:       []string{"temp", "sensor.rssi"},
	})
	if !strings.HasPrefix(u, "/?") {
		t.Fatalf("expected /? prefix, got %s", u)
	}
	parsed, err := url.Parse(u)
	if err != nil {
		t.Fatalf("url did not parse: %v", err)
	}
	q := parsed.Query()
	if q.Get("view") != "chart" {
		t.Errorf("expected view=chart, got %q", q.Get("view"))
	}
	if q.Get("conn") != "7" {
		t.Errorf("expected conn=7, got %q", q.Get("conn"))
	}
	if q.Get("topic") != "home/sensors/34" {
		t.Errorf("expected topic round-trip, got %q", q.Get("topic"))
	}
	if q.Get("fields") != `["temp","sensor.rssi"]` {
		t.Errorf("expected fields json, got %q", q.Get("fields"))
	}
}

func TestBuildChartWindowURLEscapesSpecialChars(t *testing.T) {
	u := buildChartWindowURL(OpenChartWindowParams{
		ConnectionID: 1,
		Topic:        "a b/c&d=e?f#g",
	})
	parsed, err := url.Parse(u)
	if err != nil {
		t.Fatalf("url with special chars did not parse: %v", err)
	}
	if parsed.Query().Get("topic") != "a b/c&d=e?f#g" {
		t.Errorf("topic not preserved through encoding, got %q", parsed.Query().Get("topic"))
	}
}

func TestBuildChartWindowURLNoFields(t *testing.T) {
	u := buildChartWindowURL(OpenChartWindowParams{ConnectionID: 1, Topic: "t"})
	parsed, _ := url.Parse(u)
	if parsed.Query().Has("fields") {
		t.Error("expected no fields param when none selected")
	}
}

func TestBuildTopicWindowURL(t *testing.T) {
	u := buildTopicWindowURL(OpenTopicWindowParams{ConnectionID: 7, Topic: "a b/c&d=e?f#g"})
	if !strings.HasPrefix(u, "/?") {
		t.Fatalf("expected /? prefix, got %s", u)
	}
	parsed, err := url.Parse(u)
	if err != nil {
		t.Fatalf("url did not parse: %v", err)
	}
	q := parsed.Query()
	if q.Get("view") != "topic" {
		t.Errorf("expected view=topic, got %q", q.Get("view"))
	}
	if q.Get("conn") != "7" {
		t.Errorf("expected conn=7, got %q", q.Get("conn"))
	}
	if q.Get("topic") != "a b/c&d=e?f#g" {
		t.Errorf("topic not preserved through encoding, got %q", q.Get("topic"))
	}
}

func TestBuildTopicWindowURLNoTopic(t *testing.T) {
	u := buildTopicWindowURL(OpenTopicWindowParams{ConnectionID: 1})
	parsed, _ := url.Parse(u)
	if parsed.Query().Has("topic") {
		t.Error("expected no topic param when nothing selected")
	}
}

func TestBuildStatusWindowURL(t *testing.T) {
	u := buildStatusWindowURL(42)
	if !strings.HasPrefix(u, "/?") {
		t.Fatalf("expected /? prefix, got %s", u)
	}
	parsed, err := url.Parse(u)
	if err != nil {
		t.Fatalf("url did not parse: %v", err)
	}
	q := parsed.Query()
	if q.Get("view") != "status" {
		t.Errorf("expected view=status, got %q", q.Get("view"))
	}
	if q.Get("conn") != "42" {
		t.Errorf("expected conn=42, got %q", q.Get("conn"))
	}
}
