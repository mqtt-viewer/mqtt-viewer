package mqtt

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestLogStoreRingCapDropsOldest(t *testing.T) {
	s := newLogStore(1)
	total := logRingCap + 50
	for i := 0; i < total; i++ {
		s.Info(itoa(i))
		// Drain periodically so the pending cap never interferes with the
		// ring-wraparound behaviour under test.
		if i%1000 == 999 {
			s.Snapshot()
		}
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
	// Ordering must be strictly sequential across the wrap point.
	for i := 1; i < len(snap); i++ {
		if snap[i-1].TimestampMs > snap[i].TimestampMs {
			t.Fatalf("snapshot out of order at index %d", i)
		}
	}
}

func TestLogStorePendingCapSynthesizesDroppedLine(t *testing.T) {
	s := newLogStore(1)
	over := 25
	for i := 0; i < logPendingCap+over; i++ {
		s.Info(itoa(i))
	}

	emitted := make(chan []LogEntry, 1)
	s.StartEmitting(time.Millisecond, func(entries []LogEntry) {
		select {
		case emitted <- entries:
		default:
		}
	})
	s.SetStreaming(true)
	var batch []LogEntry
	select {
	case batch = <-emitted:
	case <-time.After(2 * time.Second):
		t.Fatal("expected a drained batch, got none")
	}
	s.Close()
	// Capped batch plus one synthesized warn line.
	if len(batch) != logPendingCap+1 {
		t.Fatalf("expected %d entries in batch, got %d", logPendingCap+1, len(batch))
	}
	last := batch[len(batch)-1]
	want := "dropped " + itoa(over) + " log lines"
	if last.Level != string(LogLevelWarn) || last.Message != want {
		t.Errorf("expected trailing warn %q, got %s %q", want, last.Level, last.Message)
	}
	// Oldest pending lines were dropped, so the batch starts at `over`.
	if batch[0].Message != itoa(over) {
		t.Errorf("expected batch to start at %q, got %q", itoa(over), batch[0].Message)
	}
}

func TestLogStoreSnapshotDrainsPending(t *testing.T) {
	s := newLogStore(1)
	s.Info("before-snapshot")

	emitted := make(chan []LogEntry, 10)
	s.StartEmitting(time.Millisecond, func(entries []LogEntry) { emitted <- entries })
	s.SetStreaming(true)

	snap := s.Snapshot()
	if len(snap) != 1 || snap[0].Message != "before-snapshot" {
		t.Fatalf("expected snapshot to contain the line, got %+v", snap)
	}

	s.Info("after-snapshot")
	select {
	case batch := <-emitted:
		// The first emitted batch after the snapshot must not repeat lines the
		// snapshot already returned.
		if len(batch) != 1 || batch[0].Message != "after-snapshot" {
			t.Fatalf("expected batch to contain only post-snapshot lines, got %+v", batch)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected a drained batch, got none")
	}
	s.Close()
}

func TestLogStoreStreamingGatesEmission(t *testing.T) {
	s := newLogStore(1)
	emitted := make(chan []LogEntry, 10)
	s.StartEmitting(time.Millisecond, func(entries []LogEntry) { emitted <- entries })

	// Streaming off (default): drained lines must not reach onBatch.
	s.Info("while-off")
	select {
	case batch := <-emitted:
		t.Fatalf("expected no emission while streaming off, got %+v", batch)
	case <-time.After(50 * time.Millisecond):
	}

	// But the ring still captured the line.
	if snap := s.Snapshot(); len(snap) != 1 {
		t.Fatalf("expected ring capture while streaming off, got %+v", snap)
	}

	s.SetStreaming(true)
	s.Info("while-on")
	select {
	case batch := <-emitted:
		if len(batch) != 1 || batch[0].Message != "while-on" {
			t.Fatalf("expected the streamed line, got %+v", batch)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected emission while streaming on, got none")
	}
	s.Close()
}

func TestLogStoreCloseMakesLoggingNoOp(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "conn-1.txt")
	s := newLogStore(1)
	if err := s.InitFile(path); err != nil {
		t.Fatalf("InitFile: %v", err)
	}
	s.Info("kept")
	s.Close()

	// A still-live client logging after Close must not buffer anything...
	s.Info("after-close")
	if snap := s.Snapshot(); len(snap) != 1 || snap[0].Message != "kept" {
		t.Fatalf("expected only pre-close entries, got %+v", snap)
	}

	// ...nor recreate the (deleted) file.
	os.Remove(path)
	if err := s.InitFile(path); err != nil {
		t.Fatalf("InitFile after close: %v", err)
	}
	s.Info("still-no-op")
	s.Snapshot()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("expected no file to be recreated after Close, stat err: %v", err)
	}
}

func TestLogStoreTruncatesLongLines(t *testing.T) {
	s := newLogStore(1)
	s.Info(strings.Repeat("x", logMaxLineLen+100))
	snap := s.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(snap))
	}
	msg := snap[0].Message
	if !strings.HasSuffix(msg, logTruncationSuffix) {
		t.Errorf("expected truncation suffix, got tail %q", msg[len(msg)-30:])
	}
	if len(msg) != logMaxLineLen+len(logTruncationSuffix) {
		t.Errorf("expected message capped at %d bytes plus suffix, got %d", logMaxLineLen, len(msg))
	}
	// Short lines pass through untouched.
	if got := truncateLogLine("short"); got != "short" {
		t.Errorf("expected short line untouched, got %q", got)
	}
	// Cuts land on a rune boundary.
	long := strings.Repeat("é", logMaxLineLen) // 2 bytes each
	if !utf8.ValidString(truncateLogLine(long)) {
		t.Error("expected truncation to preserve utf8 validity")
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
