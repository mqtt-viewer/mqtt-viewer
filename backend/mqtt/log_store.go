package mqtt

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

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
	// logFileTimeFormat is the millisecond timestamp written to the text file.
	logFileTimeFormat = "2006-01-02T15:04:05.000"
)

// LogStore captures a single connection's MQTT-library client logs into a
// bounded in-RAM ring (for the live dialog) and a durable rotating text file
// (for post-hoc inspection). It also coalesces new entries into batches emitted
// to the frontend on a ticker, mirroring MessageBuffer.
//
// Always-on lifecycle/error lines flow in regardless of the debug toggle;
// "debug"-level writes are dropped when debugEnabled is false, so a connection
// that hasn't switched debug on never buffers, files, or emits verbose output.
type LogStore struct {
	connId uint

	mu      sync.Mutex
	entries []LogEntry
	pending []LogEntry

	debugEnabled atomic.Bool

	// file is lazily set by InitFile; nil = RAM-only (e.g. unit tests before
	// a temp dir is wired, or test mode).
	fileMu sync.Mutex
	file   *lumberjack.Logger

	// batching
	handleTicker *time.Ticker
	handleChan   chan bool
	onBatch      func([]LogEntry)
}

func newLogStore(connId uint) *LogStore {
	return &LogStore{
		connId:  connId,
		entries: []LogEntry{},
		pending: []LogEntry{},
	}
}

// InitFile points the store's durable log at path, creating parent dirs. Safe to
// call once at connection creation. A failure degrades to RAM-only logging.
func (s *LogStore) InitFile(path string) error {
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

// StartEmitting begins draining new entries to onBatch every interval.
func (s *LogStore) StartEmitting(interval time.Duration, onBatch func([]LogEntry)) {
	s.StopEmitting()
	s.mu.Lock()
	s.onBatch = onBatch
	s.mu.Unlock()
	s.handleTicker = time.NewTicker(interval)
	s.handleChan = make(chan bool)
	go func() {
		for {
			select {
			case <-s.handleChan:
				return
			case <-s.handleTicker.C:
				s.drain()
			}
		}
	}()
}

func (s *LogStore) StopEmitting() {
	if s.handleTicker != nil {
		s.handleTicker.Stop()
		s.handleTicker = nil
	}
	if s.handleChan != nil {
		s.handleChan <- true
		s.handleChan = nil
	}
}

func (s *LogStore) drain() {
	s.mu.Lock()
	batch := s.pending
	s.pending = []LogEntry{}
	cb := s.onBatch
	s.mu.Unlock()
	if len(batch) > 0 && cb != nil {
		cb(batch)
	}
}

// log appends one line. "debug" is a no-op when the toggle is off — nothing is
// buffered, batched, or written to disk.
func (s *LogStore) log(level LogLevel, msg string) {
	if level == LogLevelDebug && !s.debugEnabled.Load() {
		return
	}
	now := time.Now()
	entry := LogEntry{
		TimestampMs: now.UnixMilli(),
		Level:       string(level),
		Message:     msg,
	}

	s.mu.Lock()
	s.entries = append(s.entries, entry)
	if len(s.entries) > logRingCap {
		// drop-oldest; copy to a fresh slice so the backing array can be freed
		s.entries = append([]LogEntry{}, s.entries[len(s.entries)-logRingCap:]...)
	}
	s.pending = append(s.pending, entry)
	s.mu.Unlock()

	s.writeFile(now, level, msg)
}

func (s *LogStore) writeFile(t time.Time, level LogLevel, msg string) {
	s.fileMu.Lock()
	defer s.fileMu.Unlock()
	if s.file == nil {
		return
	}
	line := fmt.Sprintf("%s  %-5s  %s\n", t.Format(logFileTimeFormat), strings.ToUpper(string(level)), msg)
	_, _ = s.file.Write([]byte(line))
}

func (s *LogStore) Info(msg string)  { s.log(LogLevelInfo, msg) }
func (s *LogStore) Warn(msg string)  { s.log(LogLevelWarn, msg) }
func (s *LogStore) Error(msg string) { s.log(LogLevelError, msg) }
func (s *LogStore) Debug(msg string) { s.log(LogLevelDebug, msg) }

// Snapshot returns a copy of the current in-RAM ring for the RPC getter.
func (s *LogStore) Snapshot() []LogEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]LogEntry, len(s.entries))
	copy(out, s.entries)
	return out
}

// Clear empties the RAM ring and truncates the durable file (removing rotated
// backups best-effort).
func (s *LogStore) Clear() {
	s.mu.Lock()
	s.entries = []LogEntry{}
	s.pending = []LogEntry{}
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

// Close stops emitting and closes the file. Called when the connection is torn
// down (currently only exercised in tests; app connections live for the process).
func (s *LogStore) Close() {
	s.StopEmitting()
	s.fileMu.Lock()
	defer s.fileMu.Unlock()
	if s.file != nil {
		_ = s.file.Close()
	}
}

// ---------------------------------------------------------------------------
// paho.Logger / mqttV3.Logger adapters
//
// Both library logger interfaces are identical (Println/Printf). A pahoLogSink
// forwards formatted lines to a bound store method — used for v5, where loggers
// are per-connection.
// ---------------------------------------------------------------------------

type pahoLogSink struct {
	sink func(msg string)
}

func newPahoLogSink(sink func(msg string)) pahoLogSink {
	return pahoLogSink{sink: sink}
}

func (a pahoLogSink) Println(v ...interface{}) {
	a.sink(strings.TrimRight(fmt.Sprintln(v...), "\n"))
}

func (a pahoLogSink) Printf(format string, v ...interface{}) {
	a.sink(strings.TrimRight(fmt.Sprintf(format, v...), "\n"))
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
	v3Registry.broadcast(a.level, strings.TrimRight(fmt.Sprintln(v...), "\n"))
}

func (a v3GlobalLogAdapter) Printf(format string, v ...interface{}) {
	v3Registry.broadcast(a.level, strings.TrimRight(fmt.Sprintf(format, v...), "\n"))
}
