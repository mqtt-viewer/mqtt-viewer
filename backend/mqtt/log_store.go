package mqtt

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	mqttV3 "github.com/eclipse/paho.mqtt.golang"
	lumberjack "gopkg.in/natefinch/lumberjack.v2"
)

// LogLevel classifies a client-log line. Only "debug" is gated by the
// per-connection debug toggle; the rest are always captured.
type LogLevel string

const (
	LogLevelDebug LogLevel = "debug"
	LogLevelInfo  LogLevel = "info"
	LogLevelWarn  LogLevel = "warn"
	LogLevelError LogLevel = "error"
)

// LogEntry is one client-log line, surfaced to the frontend as-is.
type LogEntry struct {
	TimestampMs int64  `json:"timestampMs"`
	Level       string `json:"level"`
	Message     string `json:"message"`
}

const (
	// logRingCap bounds the in-RAM history that backs the live dialog.
	logRingCap = 2000
	// logPendingCap bounds the not-yet-drained queue between ticks. If the
	// library outruns the drain, the oldest pending lines are dropped and a
	// synthesized warn line records how many went missing.
	logPendingCap = 2000
	// logMaxLineLen caps a single message's bytes before append.
	logMaxLineLen = 4096
	// logTruncationSuffix marks lines cut at logMaxLineLen.
	logTruncationSuffix = "... (truncated)"
	// logFileTimeFormat is the millisecond timestamp written to the text file.
	logFileTimeFormat = "2006-01-02T15:04:05.000"
)

// LogStore captures a single connection's MQTT-library client logs into a
// bounded in-RAM ring (for the live dialog) and a durable rotating text file
// (for post-hoc inspection).
//
// The hot path (log) only appends under a mutex: file writes and frontend
// emission both happen on the drain ticker, never on the caller's goroutine
// (which is paho's packet loop). Emission to the frontend is additionally
// demand-gated by SetStreaming so batches only cross the IPC bridge while the
// logs dialog is open; the file keeps being written regardless.
//
// Always-on lifecycle/error lines flow in regardless of the debug toggle;
// "debug"-level writes are dropped when debugEnabled is false, so a connection
// that hasn't switched debug on never buffers, files, or emits verbose output.
type LogStore struct {
	connId uint

	mu sync.Mutex
	// ring is a fixed-capacity ring buffer: it grows by append until it holds
	// logRingCap entries, then wraps in place. head indexes the oldest entry
	// once full.
	ring    []LogEntry
	head    int
	pending []LogEntry
	dropped int
	// streaming gates emission of drained batches to onBatch (the dialog's
	// live feed). File writes are unaffected.
	streaming bool
	onBatch   func([]LogEntry)

	// batching; guarded by mu so Start/Stop races stay clean under -race.
	handleTicker *time.Ticker
	handleChan   chan bool

	debugEnabled atomic.Bool
	// closed makes log a no-op after Close, so a still-live client can't
	// recreate a deleted connection's file or grow pending forever.
	closed atomic.Bool

	// file is lazily set by InitFile; nil = RAM-only (e.g. unit tests before
	// a temp dir is wired, or test mode).
	fileMu sync.Mutex
	file   *lumberjack.Logger
}

func newLogStore(connId uint) *LogStore {
	return &LogStore{
		connId: connId,
	}
}

// InitFile points the store's durable log at path, creating parent dirs. Safe to
// call once at connection creation. A failure degrades to RAM-only logging.
func (s *LogStore) InitFile(path string) error {
	if s.closed.Load() {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	s.fileMu.Lock()
	s.file = &lumberjack.Logger{
		Filename:   path,
		MaxSize:    5, // megabytes
		MaxBackups: 3,
	}
	s.fileMu.Unlock()
	return nil
}

// SetDebugEnabled toggles whether verbose "debug"-level lines are captured.
func (s *LogStore) SetDebugEnabled(enabled bool) {
	s.debugEnabled.Store(enabled)
}

func (s *LogStore) DebugEnabled() bool {
	return s.debugEnabled.Load()
}

// SetStreaming starts or stops forwarding drained batches to onBatch. The
// dialog switches this on while open; everything else (ring, file) runs
// regardless.
func (s *LogStore) SetStreaming(streaming bool) {
	s.mu.Lock()
	s.streaming = streaming
	s.mu.Unlock()
}

// StartEmitting begins draining pending entries every interval: each batch is
// written to the durable file and, while streaming is on, passed to onBatch.
func (s *LogStore) StartEmitting(interval time.Duration, onBatch func([]LogEntry)) {
	s.StopEmitting()
	if s.closed.Load() {
		return
	}
	s.mu.Lock()
	s.onBatch = onBatch
	s.handleTicker = time.NewTicker(interval)
	s.handleChan = make(chan bool)
	ticker := s.handleTicker
	done := s.handleChan
	s.mu.Unlock()
	go func() {
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				s.drain()
			}
		}
	}()
}

func (s *LogStore) StopEmitting() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.handleTicker != nil {
		s.handleTicker.Stop()
		s.handleTicker = nil
	}
	if s.handleChan != nil {
		// close rather than send: a send would block forever if the goroutine
		// has already exited, and close is safe however many times Stop races.
		close(s.handleChan)
		s.handleChan = nil
	}
}

// drain moves pending entries out of the hot path: writes them to the durable
// file and, while streaming, emits them to the frontend.
func (s *LogStore) drain() {
	s.mu.Lock()
	batch := s.takeBatchLocked()
	if len(batch) == 0 {
		s.mu.Unlock()
		return
	}
	cb := s.onBatch
	streaming := s.streaming
	// Acquire fileMu before releasing mu so concurrent drains/snapshots write
	// their batches to the file in take order.
	s.fileMu.Lock()
	s.mu.Unlock()
	s.writeFileLocked(batch)
	s.fileMu.Unlock()
	if streaming && cb != nil {
		cb(batch)
	}
}

// takeBatchLocked detaches the pending queue, folding any drop count into a
// synthesized warn line (recorded in the ring too). Caller holds mu.
func (s *LogStore) takeBatchLocked() []LogEntry {
	batch := s.pending
	s.pending = nil
	if s.dropped > 0 {
		warn := LogEntry{
			TimestampMs: time.Now().UnixMilli(),
			Level:       string(LogLevelWarn),
			Message:     fmt.Sprintf("dropped %d log lines", s.dropped),
		}
		s.dropped = 0
		s.appendRingLocked(warn)
		batch = append(batch, warn)
	}
	return batch
}

// appendRingLocked adds one entry to the fixed-capacity ring. Caller holds mu.
func (s *LogStore) appendRingLocked(entry LogEntry) {
	if len(s.ring) < logRingCap {
		s.ring = append(s.ring, entry)
		return
	}
	s.ring[s.head] = entry
	s.head = (s.head + 1) % logRingCap
}

// log appends one line. "debug" is a no-op when the toggle is off — nothing is
// buffered, batched, or written to disk. This is the hot path (called from the
// MQTT library's own goroutines) so it only appends under the mutex; file
// writes and emission happen on the drain ticker.
func (s *LogStore) log(level LogLevel, msg string) {
	if s.closed.Load() {
		return
	}
	if level == LogLevelDebug && !s.debugEnabled.Load() {
		return
	}
	msg = truncateLogLine(msg)
	entry := LogEntry{
		TimestampMs: time.Now().UnixMilli(),
		Level:       string(level),
		Message:     msg,
	}

	s.mu.Lock()
	s.appendRingLocked(entry)
	if len(s.pending) >= logPendingCap {
		// Drop-oldest: the ring above still holds the line, but it will never
		// reach the file or the live feed. Recorded via the dropped counter.
		s.pending = s.pending[1:]
		s.dropped++
	}
	s.pending = append(s.pending, entry)
	s.mu.Unlock()
}

// truncateLogLine caps a message at logMaxLineLen bytes, cutting on a rune
// boundary and marking the cut.
func truncateLogLine(msg string) string {
	if len(msg) <= logMaxLineLen {
		return msg
	}
	cut := logMaxLineLen
	for cut > 0 && !utf8.RuneStart(msg[cut]) {
		cut--
	}
	return msg[:cut] + logTruncationSuffix
}

// writeFileLocked appends a drained batch to the durable file as one write.
// Caller holds fileMu.
func (s *LogStore) writeFileLocked(batch []LogEntry) {
	if s.file == nil {
		return
	}
	var b strings.Builder
	for _, entry := range batch {
		t := time.UnixMilli(entry.TimestampMs)
		fmt.Fprintf(&b, "%s  %-5s  %s\n", t.Format(logFileTimeFormat), strings.ToUpper(entry.Level), entry.Message)
	}
	_, _ = s.file.Write([]byte(b.String()))
}

func (s *LogStore) Info(msg string)  { s.log(LogLevelInfo, msg) }
func (s *LogStore) Warn(msg string)  { s.log(LogLevelWarn, msg) }
func (s *LogStore) Error(msg string) { s.log(LogLevelError, msg) }
func (s *LogStore) Debug(msg string) { s.log(LogLevelDebug, msg) }

// Snapshot returns a copy of the current in-RAM ring for the RPC getter. It
// first drains pending entries (file write, no emission) atomically with the
// copy, so the snapshot never overlaps with the next emitted batch.
func (s *LogStore) Snapshot() []LogEntry {
	s.mu.Lock()
	batch := s.takeBatchLocked()
	out := make([]LogEntry, 0, len(s.ring))
	out = append(out, s.ring[s.head:]...)
	out = append(out, s.ring[:s.head]...)
	if len(batch) == 0 {
		s.mu.Unlock()
		return out
	}
	// Same lock coupling as drain: keep file batches in take order.
	s.fileMu.Lock()
	s.mu.Unlock()
	s.writeFileLocked(batch)
	s.fileMu.Unlock()
	return out
}

// Clear empties the RAM ring and truncates the durable file (removing rotated
// backups best-effort).
func (s *LogStore) Clear() {
	s.mu.Lock()
	s.ring = nil
	s.head = 0
	s.pending = nil
	s.dropped = 0
	s.mu.Unlock()

	s.fileMu.Lock()
	defer s.fileMu.Unlock()
	if s.file != nil {
		// Rotate() closes the current file, renames it to a backup and opens a
		// fresh empty one; then delete the backups so "clear" really empties.
		_ = s.file.Rotate()
		_ = s.removeBackups()
	}
}

// removeBackups deletes rotated "<name>-<timestamp>.txt" siblings of the active
// log file. Caller holds fileMu.
func (s *LogStore) removeBackups() error {
	if s.file == nil {
		return nil
	}
	name := s.file.Filename
	dir := filepath.Dir(name)
	base := filepath.Base(name)
	ext := filepath.Ext(base)
	prefix := strings.TrimSuffix(base, ext) + "-"
	dirEntries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, de := range dirEntries {
		n := de.Name()
		if n != base && strings.HasPrefix(n, prefix) {
			_ = os.Remove(filepath.Join(dir, n))
		}
	}
	return nil
}

// Close stops emitting, makes further logging a no-op, flushes any pending
// lines to the file and closes it. Called when the connection is deleted (via
// MqttManager.CloseLogging) and on test teardown.
func (s *LogStore) Close() {
	s.closed.Store(true)
	s.StopEmitting()
	s.mu.Lock()
	batch := s.takeBatchLocked()
	s.fileMu.Lock()
	s.mu.Unlock()
	s.writeFileLocked(batch)
	if s.file != nil {
		_ = s.file.Close()
		s.file = nil
	}
	s.fileMu.Unlock()
}

// ---------------------------------------------------------------------------
// paho.Logger / mqttV3.Logger adapters
//
// Both library logger interfaces are identical (Println/Printf). A pahoLogSink
// forwards lines to a bound store at a fixed level — used for v5, where loggers
// are per-connection. Debug-level sinks bail out before formatting, so a
// connection with debug off never pays the Sprintf on paho's packet loop.
// ---------------------------------------------------------------------------

type pahoLogSink struct {
	store *LogStore
	level LogLevel
}

func newPahoLogSink(store *LogStore, level LogLevel) pahoLogSink {
	return pahoLogSink{store: store, level: level}
}

func (a pahoLogSink) enabled() bool {
	if a.store.closed.Load() {
		return false
	}
	return a.level != LogLevelDebug || a.store.DebugEnabled()
}

func (a pahoLogSink) Println(v ...interface{}) {
	if !a.enabled() {
		return
	}
	a.store.log(a.level, strings.TrimRight(fmt.Sprintln(v...), "\n"))
}

func (a pahoLogSink) Printf(format string, v ...interface{}) {
	if !a.enabled() {
		return
	}
	a.store.log(a.level, strings.TrimRight(fmt.Sprintf(format, v...), "\n"))
}

// ---------------------------------------------------------------------------
// v3 global logger dispatcher
//
// paho.mqtt.golang exposes only package-level loggers (mqtt.DEBUG/WARN/ERROR/
// CRITICAL), so v3 verbose output cannot be attributed to a single connection.
// We install the globals once and broadcast each line to every v3 connection
// that currently has its debug toggle on (registered here). Connections with
// debug off are never registered, so they receive none of this output.
// ---------------------------------------------------------------------------

type v3Dispatcher struct {
	mu     sync.RWMutex
	stores map[uint]*LogStore
}

var v3Registry = &v3Dispatcher{stores: map[uint]*LogStore{}}

func (d *v3Dispatcher) register(store *LogStore) {
	if store == nil {
		return
	}
	d.mu.Lock()
	d.stores[store.connId] = store
	d.mu.Unlock()
}

func (d *v3Dispatcher) unregister(connId uint) {
	d.mu.Lock()
	delete(d.stores, connId)
	d.mu.Unlock()
}

func (d *v3Dispatcher) empty() bool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return len(d.stores) == 0
}

func (d *v3Dispatcher) broadcast(level LogLevel, msg string) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	for _, s := range d.stores {
		s.log(level, msg)
	}
}

var installV3LoggersOnce sync.Once

// installV3GlobalLoggers wires paho.mqtt.golang's package-level loggers to the
// broadcast dispatcher exactly once for the process.
func installV3GlobalLoggers() {
	installV3LoggersOnce.Do(func() {
		mqttV3.DEBUG = v3GlobalLogAdapter{level: LogLevelDebug}
		mqttV3.WARN = v3GlobalLogAdapter{level: LogLevelWarn}
		mqttV3.ERROR = v3GlobalLogAdapter{level: LogLevelError}
		mqttV3.CRITICAL = v3GlobalLogAdapter{level: LogLevelError}
	})
}

type v3GlobalLogAdapter struct {
	level LogLevel
}

func (a v3GlobalLogAdapter) Println(v ...interface{}) {
	if v3Registry.empty() {
		return
	}
	v3Registry.broadcast(a.level, strings.TrimRight(fmt.Sprintln(v...), "\n"))
}

func (a v3GlobalLogAdapter) Printf(format string, v ...interface{}) {
	if v3Registry.empty() {
		return
	}
	v3Registry.broadcast(a.level, strings.TrimRight(fmt.Sprintf(format, v...), "\n"))
}
