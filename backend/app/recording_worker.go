package app

import (
	"log/slog"
	"mqtt-viewer/backend/mqtt"
	"time"
)

// recordQueueCapacity bounds how many drained batches can wait for the
// single DB writer. Sized well above one drain interval's worth of batches
// (two connections draining every 300ms) so a brief writer stall doesn't
// shed load immediately; a sustained one does, by design.
const recordQueueCapacity = 64

// recordDropLogInterval throttles the "queue full" warning under sustained
// overload to at most one log line per window rather than one per drain.
const recordDropLogInterval = 5 * time.Second

type recordBatch struct {
	connectionID uint
	messages     []mqtt.MqttMessage
}

// startRecordingWorker starts the single goroutine that owns all writes to
// the received_messages table. Batches arrive via recordQueue so the
// message-buffer drain (event emit + enqueue) never blocks on SQLite writer
// contention between connections or on prune work.
func (a *App) startRecordingWorker() {
	a.recordQueue = make(chan recordBatch, recordQueueCapacity)
	a.recordStop = make(chan struct{})
	go func() {
		for {
			select {
			case batch, ok := <-a.recordQueue:
				if !ok {
					return
				}
				a.insertReceivedMessages(batch.connectionID, batch.messages)
				a.pruneReceivedMessagesToBudget()
			case <-a.recordStop:
				return
			}
		}
	}()
}

// enqueueRecordBatch hands a drained batch to the recording worker.
// Non-blocking: recording is best-effort, so a full queue drops the batch
// rather than stalling the caller, which sits on the buffer-drain path.
func (a *App) enqueueRecordBatch(connectionID uint, messages []mqtt.MqttMessage) {
	if !a.recordingEnabled.Load() || len(messages) == 0 {
		return
	}
	select {
	case a.recordQueue <- recordBatch{connectionID: connectionID, messages: messages}:
	default:
		a.recordDropped.Add(1)
		a.logRecordQueueFull()
	}
}

func (a *App) logRecordQueueFull() {
	now := time.Now().UnixNano()
	last := a.lastRecordDropLogNanos.Load()
	if now-last < int64(recordDropLogInterval) {
		return
	}
	if a.lastRecordDropLogNanos.CompareAndSwap(last, now) {
		slog.Warn("record queue full: dropping batch", "totalDropped", a.recordDropped.Load())
	}
}
