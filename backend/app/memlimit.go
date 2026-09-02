package app

import "runtime/debug"

// memLimitBaseBytes covers baseline heap usage outside the per-connection
// message history budgets: SQLite/GORM, event marshalling, and general
// runtime slack.
const memLimitBaseBytes int64 = 1 << 30 // 1 GiB

// computeMemoryLimit derives a soft runtime memory limit from the configured
// per-connection history budget and the number of currently connected
// connections. The 3/2 factor covers measured churn headroom over
// estimatedBytes' accounting, which is deliberately conservative (see the
// calibration note above estimatedBytes in backend/mqtt/message.go).
func computeMemoryLimit(budgetBytes int64, connectedCount int64) int64 {
	return memLimitBaseBytes + connectedCount*(budgetBytes*3/2)
}

// recomputeMemoryLimit sets Go's soft memory limit (debug.SetMemoryLimit)
// from the current budget and connection count. This is a SOFT limit: the
// garbage collector runs harder as the heap approaches it instead of letting
// the process grow to roughly 2x live bytes plus churn between collections.
// Measured 2026-07-19: without this, two connections each budgeted at 512MB
// plateaued at ~4.6GB process RSS under a 2x2000 msg/s flood — GOGC=100
// roughly doubles the heap ceiling over live bytes, ~4k msg/s of
// JSON-marshalling churn adds garbage between GCs, and macOS keeps
// MADV_FREE'd pages counted in RSS.
func (a *App) recomputeMemoryLimit() {
	debug.SetMemoryLimit(computeMemoryLimit(a.memoryBudgetBytes(), a.connectedConnCount.Load()))
}
