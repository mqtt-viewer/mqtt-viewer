package app

import "testing"

func TestComputeMemoryLimit(t *testing.T) {
	const defaultBudget int64 = 512 * 1024 * 1024

	// The literal cases below are pinned in frontend/src/util/memory-budget.test.ts
	// too: the settings dialog's estimate is derived from this same model, so
	// both sides must agree on the exact numbers.
	cases := []struct {
		name           string
		budgetBytes    int64
		connectedCount int64
		want           int64
	}{
		{
			name:           "zero connections is just the base",
			budgetBytes:    defaultBudget,
			connectedCount: 0,
			want:           memLimitBaseBytes,
		},
		{
			name:           "one connection adds 1.5x its budget",
			budgetBytes:    defaultBudget,
			connectedCount: 1,
			want:           memLimitBaseBytes + defaultBudget*3/2,
		},
		{
			name:           "two connections scale linearly",
			budgetBytes:    defaultBudget,
			connectedCount: 2,
			want:           memLimitBaseBytes + 2*(defaultBudget*3/2),
		},
		{
			name:           "custom budget",
			budgetBytes:    100 * 1024 * 1024,
			connectedCount: 3,
			want:           memLimitBaseBytes + 3*(100*1024*1024*3/2),
		},
		{
			name:           "default budget, one connection, literal",
			budgetBytes:    defaultBudget,
			connectedCount: 1,
			want:           1879048192, // 1792 MiB
		},
		{
			name:           "default budget, two connections, literal",
			budgetBytes:    defaultBudget,
			connectedCount: 2,
			want:           2684354560, // 2560 MiB
		},
		{
			name:           "default budget, three connections, literal",
			budgetBytes:    defaultBudget,
			connectedCount: 3,
			want:           3489660928, // 3328 MiB
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := computeMemoryLimit(tc.budgetBytes, tc.connectedCount)
			if got != tc.want {
				t.Errorf("computeMemoryLimit(%d, %d) = %d, want %d", tc.budgetBytes, tc.connectedCount, got, tc.want)
			}
		})
	}
}

// The frontend derives its estimate from the model this exposes, so it must be
// the same value the runtime uses, with the calibrated constants intact.
// Changing any of these numbers means re-checking the calibration note on
// recomputeMemoryLimit and the pinned literals in
// frontend/src/util/memory-budget.test.ts.
func TestGetMemoryLimitModelExposesRuntimeModel(t *testing.T) {
	model := (&App{}).GetMemoryLimitModel()

	if model != memoryLimitModel {
		t.Fatalf("GetMemoryLimitModel() = %+v, want %+v", model, memoryLimitModel)
	}

	if model.BaseBytes != 1<<30 {
		t.Errorf("BaseBytes = %d, want %d", model.BaseBytes, int64(1<<30))
	}
	if model.BudgetFactorNumerator != 3 {
		t.Errorf("BudgetFactorNumerator = %d, want 3", model.BudgetFactorNumerator)
	}
	if model.BudgetFactorDenominator != 2 {
		t.Errorf("BudgetFactorDenominator = %d, want 2", model.BudgetFactorDenominator)
	}
}
