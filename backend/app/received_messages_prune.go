package app

import (
	"log/slog"
	"mqtt-viewer/backend/models"
	"time"
)

const (
	// How often the disk-size check may actually run, regardless of how often
	// recordReceivedMessages is called.
	pruneCheckInterval = 2 * time.Second
	// Rows deleted per prune iteration — bounded so each DELETE is a short
	// transaction that doesn't hold the write lock for long.
	pruneChunkRows = 5000
	// Safety bound on prune iterations per check.
	maxPruneIterations = 200
)

// usedBytes estimates the live (non-free) size of the database file:
// (page_count - freelist_count) * page_size. Using the freelist makes the
// measurement correct even when auto_vacuum is off and the file hasn't shrunk,
// so we prune to bound live data rather than over-deleting against a file size
// that won't drop.
func (a *App) usedBytes() (int64, error) {
	var pageCount, pageSize, freeCount int64
	if err := a.Db.Raw("PRAGMA page_count").Scan(&pageCount).Error; err != nil {
		return 0, err
	}
	if err := a.Db.Raw("PRAGMA page_size").Scan(&pageSize).Error; err != nil {
		return 0, err
	}
	if err := a.Db.Raw("PRAGMA freelist_count").Scan(&freeCount).Error; err != nil {
		return 0, err
	}
	used := (pageCount - freeCount) * pageSize
	if used < 0 {
		used = 0
	}
	return used, nil
}

// pruneReceivedMessagesToBudget deletes oldest received messages until the live
// database size is within the disk budget. Throttled, chunked, and only active
// when a positive budget is configured.
func (a *App) pruneReceivedMessagesToBudget() {
	budget := a.diskBudgetBytes.Load()
	if budget <= 0 {
		return // 0 = unlimited
	}

	now := time.Now().UnixNano()
	last := a.lastPruneCheckNanos.Load()
	if now-last < int64(pruneCheckInterval) {
		return
	}
	if !a.lastPruneCheckNanos.CompareAndSwap(last, now) {
		return // another drain is already checking
	}

	a.pruneReceivedMessagesNow(budget)
}

// pruneReceivedMessagesNow runs the prune loop unconditionally (used by tests
// and the throttled entry point).
func (a *App) pruneReceivedMessagesNow(budget int64) {
	for i := 0; i < maxPruneIterations; i++ {
		used, err := a.usedBytes()
		if err != nil {
			slog.Error("prune: failed to read db size", "error", err)
			return
		}
		if used <= budget {
			break
		}
		// Delete the oldest chunk by id (global oldest across connections).
		res := a.Db.Exec(
			`DELETE FROM received_messages
			 WHERE id IN (SELECT id FROM received_messages ORDER BY id ASC LIMIT ?)`,
			pruneChunkRows,
		)
		if res.Error != nil {
			slog.Error("prune: delete failed", "error", res.Error)
			return
		}
		if res.RowsAffected == 0 {
			break // nothing left to delete
		}
	}
	// Release freed pages to the OS where the DB supports it (auto_vacuum
	// INCREMENTAL). Harmless no-op otherwise.
	if err := a.Db.Exec("PRAGMA incremental_vacuum").Error; err != nil {
		slog.Debug("prune: incremental_vacuum no-op", "error", err)
	}
}

// ClearReceivedMessages deletes all durable history (optionally for one
// connection) and compacts the file.
func (a *App) ClearReceivedMessages(connectionID uint) error {
	if connectionID != 0 {
		if err := a.Db.Where("connection_id = ?", connectionID).Delete(&models.ReceivedMessage{}).Error; err != nil {
			return err
		}
	} else {
		// Truncate the whole table (GORM blocks a conditionless Delete).
		if err := a.Db.Exec("DELETE FROM received_messages").Error; err != nil {
			return err
		}
	}
	// Reclaim space immediately on an explicit clear.
	a.Db.Exec("PRAGMA incremental_vacuum")
	return nil
}
