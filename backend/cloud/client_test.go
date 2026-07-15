package cloud

import (
	"encoding/json"
	"mqtt-viewer/backend/env"
	"net"
	"net/url"
	"testing"
	"time"
)

type expectedAuthCheckRes struct {
	Status string `json:"status"`
}

// The auth check needs a reachable portal (the dev server on :8090 locally,
// or the real one in CI). Skip rather than fail when it isn't running.
func skipIfPortalUnreachable(t *testing.T) {
	t.Helper()
	u, err := url.Parse(env.ServerAddress)
	if err != nil {
		t.Fatalf("invalid env.ServerAddress %q: %v", env.ServerAddress, err)
	}
	host := u.Host
	if u.Port() == "" {
		if u.Scheme == "https" {
			host = net.JoinHostPort(u.Hostname(), "443")
		} else {
			host = net.JoinHostPort(u.Hostname(), "80")
		}
	}
	conn, err := net.DialTimeout("tcp", host, 500*time.Millisecond)
	if err != nil {
		t.Skipf("portal not reachable at %s: %v", env.ServerAddress, err)
	}
	conn.Close()
}

func TestClientIsAuthorised(t *testing.T) {
	skipIfPortalUnreachable(t)
	client := GetClient()
	if client == nil {
		t.Errorf("Error getting client")
	}
	res, err := client.R().Get("/api/cv1/auth-check")
	if err != nil {
		t.Errorf("Error getting response: %v", err)
	}
	if res.StatusCode() != 200 {
		t.Errorf("Expected status code 200, got %v", res.StatusCode())
	}

	expectedRes := expectedAuthCheckRes{}
	err = json.Unmarshal(res.Body(), &expectedRes)
	if err != nil {
		t.Errorf("Error unmarshalling response: %v", err)
	}

	if expectedRes.Status != "ok" {
		t.Errorf("Expected status ok, got %v", expectedRes.Status)
	}

}
