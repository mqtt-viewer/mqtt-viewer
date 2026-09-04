package app

import "runtime/debug"

// memLimitBaseBytes covers baseline heap usage outside the per-connection
// message history budgets: SQLite/GORM, event marshalling, and general
// runtime slack.
const memLimitBaseBytes int64 = 1 << 30 // 1 GiB

// MemoryLimitModel is the shape of the soft memory limit, exposed to the
// frontend so the estimate the settings dialog shows is derived from the same
// numbers the runtime is given (see frontend/src/util/memory-budget.ts).
type MemoryLimitModel struct {
	// BaseBytes covers heap usage outside the per-connection history budgets.
	BaseBytes int64 `json:"baseBytes"`
	// Each connected connection adds budget * BudgetFactorNumerator /
	// BudgetFactorDenominator: headroom over the budget for churn.
	BudgetFactorNumerator   int64 `json:"budgetFactorNumerator"`
	BudgetFactorDenominator int64 `json:"budgetFactorDenominator"`
}

// memoryLimitModel is the single source of truth for the soft limit. The 3/2
// factor covers measured churn headroom over estimatedBytes' accounting, which
// is deliberately conservative (see the calibration note above estimatedBytes
// in backend/mqtt/message.go).
var memoryLimitModel = MemoryLimitModel{
	BaseBytes:               memLimitBaseBytes,
	BudgetFactorNumerator:   3,
	BudgetFactorDenominator: 2,
}

// Limit is the soft memory limit for a given per-connection history budget and
// number of currently connected connections.
func (m MemoryLimitModel) Limit(budgetBytes, connectedCount int64) int64 {
	return m.BaseBytes + connectedCount*(budgetBytes*m.BudgetFactorNumerator/m.BudgetFactorDenominator)
}

// GetMemoryLimitModel exposes the limit's shape to the frontend so the settings
// dialog's estimate cannot drift from what the runtime actually allows.
func (a *App) GetMemoryLimitModel() MemoryLimitModel {
	return memoryLimitModel
}

// computeMemoryLimit derives a soft runtime memory limit from the configured
// per-connection history budget and the number of currently connected
// connections. It delegates to memoryLimitModel so the limit the runtime gets
// and the one the frontend shows can never diverge.
func computeMemoryLimit(budgetBytes int64, connectedCount int64) int64 {
	return memoryLimitModel.Limit(budgetBytes, connectedCount)
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
