package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGuardRuntimeOrigin(t *testing.T) {
	tests := []struct {
		name      string
		path      string
		host      string
		origin    string
		fetchSite string
		wantCode  int
		wantNext  bool
	}{
		{name: "same origin", path: "/wails/runtime", host: "viewer.test", origin: "https://viewer.test", fetchSite: "same-origin", wantCode: http.StatusNoContent, wantNext: true},
		{name: "TLS proxy", path: "/wails/runtime", host: "viewer.test", origin: "https://viewer.test", wantCode: http.StatusNoContent, wantNext: true},
		{name: "non-browser client", path: "/wails/runtime", host: "viewer.test", wantCode: http.StatusNoContent, wantNext: true},
		{name: "cross-origin header", path: "/wails/runtime", host: "viewer.test", origin: "https://evil.test", wantCode: http.StatusForbidden},
		{name: "cross-site fetch", path: "/wails/runtime", host: "viewer.test", fetchSite: "cross-site", wantCode: http.StatusForbidden},
		{name: "non-runtime route", path: "/wails/events", host: "viewer.test", origin: "https://evil.test", fetchSite: "cross-site", wantCode: http.StatusNoContent, wantNext: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			called := false
			handler := guardRuntimeOrigin(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				called = true
				w.WriteHeader(http.StatusNoContent)
			}))
			req := httptest.NewRequest(http.MethodPost, "http://"+tt.host+tt.path, nil)
			req.Host = tt.host
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			if tt.fetchSite != "" {
				req.Header.Set("Sec-Fetch-Site", tt.fetchSite)
			}
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, req)

			if response.Code != tt.wantCode {
				t.Fatalf("status = %d, want %d", response.Code, tt.wantCode)
			}
			if called != tt.wantNext {
				t.Fatalf("next called = %v, want %v", called, tt.wantNext)
			}
		})
	}
}
