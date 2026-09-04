package env

import "testing"

func TestResolveServerAddress(t *testing.T) {
	tests := []struct {
		name        string
		isDev       bool
		devDefault  string
		devOverride string
		want        string
	}{
		{
			name:       "prod ignores empty override",
			isDev:      false,
			devDefault: "http://localhost:8090",
			want:       prodServerAddress,
		},
		{
			name:        "prod ignores set override",
			isDev:       false,
			devDefault:  "http://localhost:8090",
			devOverride: "http://localhost:9999",
			want:        prodServerAddress,
		},
		{
			name:       "dev without override keeps default",
			isDev:      true,
			devDefault: "http://localhost:8090",
			want:       "http://localhost:8090",
		},
		{
			name:        "dev with override uses override",
			isDev:       true,
			devDefault:  "http://localhost:8090",
			devOverride: "http://localhost:9999",
			want:        "http://localhost:9999",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveServerAddress(tt.isDev, tt.devDefault, tt.devOverride)
			if got != tt.want {
				t.Errorf("resolveServerAddress(%v, %q, %q) = %q, want %q",
					tt.isDev, tt.devDefault, tt.devOverride, got, tt.want)
			}
		})
	}
}
