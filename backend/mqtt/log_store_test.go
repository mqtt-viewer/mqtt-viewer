package mqtt

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLogStoreRingCapDropsOldest(t *testing.T) {
	s := newLogStore(1)
	total := logRingCap + 50
	for i := 0; i < total; i++ {
		s.Info(strings.Repeat("", 0) + itoa(i))
	}
	snap := s.Snapshot()
	if len(snap) != logRingCap {
		t.Fatalf("expected ring capped at %d, got %d", logRingCap, len(snap))
	}
	// Oldest retained line should be entry (total-logRingCap).
	wantFirst := itoa(total - logRingCap)
	if snap[0].Message != wantFirst {
		t.Errorf("expected oldest retained message %q, got %q", wantFirst, snap[0].Message)
	}
	wantLast := itoa(total - 1)
	if snap[len(snap)-1].Message != wantLast {
		t.Errorf("expected newest message %q, got %q", wantLast, snap[len(snap)-1].Message)
	}
}

func TestLogStoreDebugGating(t *testing.T) {
	s := newLogStore(1)

	// Debug off: debug dropped, info kept.
	s.Debug("hidden")
	s.Info("shown")
	snap := s.Snapshot()
	if len(snap) != 1 || snap[0].Message != "shown" {
		t.Fatalf("expected only the info line while debug off, got %+v", snap)
	}

	// Debug on: debug captured.
	s.SetDebugEnabled(true)
	s.Debug("now-visible")
	snap = s.Snapshot()
	if len(snap) != 2 || snap[1].Message != "now-visible" {
		t.Fatalf("expected debug line captured while debug on, got %+v", snap)
	}
}

func TestLogStoreClear(t *testing.T) {
	s := newLogStore(1)
	s.Info("a")
	s.Error("b")
	if len(s.Snapshot()) != 2 {
		t.Fatalf("expected 2 entries before clear")
	}
	s.Clear()
	if len(s.Snapshot()) != 0 {
		t.Fatalf("expected 0 entries after clear, got %d", len(s.Snapshot()))
	}
}

func TestLogStoreWritesFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "connections", "conn-1.txt")
	s := newLogStore(1)
	if err := s.InitFile(path); err != nil {
		t.Fatalf("InitFile: %v", err)
	}
	s.Info("hello-file")
	s.SetDebugEnabled(true)
	s.Debug("debug-file")
	s.Close()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading log file: %v", err)
	}
	content := string(data)
	if !strings.Contains(content, "hello-file") {
		t.Errorf("expected info line in file, got:\n%s", content)
	}
	if !strings.Contains(content, "INFO") {
		t.Errorf("expected level tag in file, got:\n%s", content)
	}
	if !strings.Contains(content, "debug-file") {
		t.Errorf("expected debug line in file, got:\n%s", content)
	}
}

func TestLogStoreDebugFileGatedWhenOff(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "conn-1.txt")
	s := newLogStore(1)
	if err := s.InitFile(path); err != nil {
		t.Fatalf("InitFile: %v", err)
	}
	s.Debug("should-not-appear") // debug off
	s.Info("should-appear")
	s.Close()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading log file: %v", err)
	}
	content := string(data)
	if strings.Contains(content, "should-not-appear") {
		t.Errorf("debug line should have been dropped from file while debug off:\n%s", content)
	}
	if !strings.Contains(content, "should-appear") {
		t.Errorf("expected info line in file, got:\n%s", content)
	}
}

// itoa avoids strconv import noise in the loop above.
func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	var b [20]byte
	pos := len(b)
	for i > 0 {
		pos--
		b[pos] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		pos--
		b[pos] = '-'
	}
	return string(b[pos:])
}
