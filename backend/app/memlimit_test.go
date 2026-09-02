package app

import "testing"

func TestComputeMemoryLimit(t *testing.T) {
	const defaultBudget int64 = 512 * 1024 * 1024

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
