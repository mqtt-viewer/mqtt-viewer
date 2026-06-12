package update

import (
	"bytes"
	"context"
	"crypto/sha256"
	"mqtt-viewer/backend/env"
	"os"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

// TestPortalE2E exercises the full client update path (check + provider +
// download + digest) against a locally running portal. Opt-in because it
// needs external services:
//
//	cd ../cloud && go run main.go serve --http=127.0.0.1:8091 --dir=<tmp>
//	(seed a released release_v3 record whose artifact URL is reachable)
//	PORTAL_E2E=1 PORTAL_E2E_ADDR=http://127.0.0.1:8091 go test ./backend/update/ -run TestPortalE2E -v
func TestPortalE2E(t *testing.T) {
	if os.Getenv("PORTAL_E2E") != "1" {
		t.Skip("set PORTAL_E2E=1 with a local portal running to run this test")
	}
	if addr := os.Getenv("PORTAL_E2E_ADDR"); addr != "" {
		env.ServerAddress = addr
	}

	info, err := fetchUpdateInfoFor("v1.0.0", "darwin", "arm64")
	if err != nil {
		t.Fatalf("check failed: %v", err)
	}
	if info.UpToDate {
		t.Fatalf("expected an update to be available, got up_to_date")
	}
	if !info.CanUpdate || info.Artifact == nil {
		t.Fatalf("expected can_update with artifact, got %+v", info)
	}
	t.Logf("portal offers %s (%s, %d bytes)", info.LatestVersion, info.Artifact.Name, info.Artifact.Size)

	provider := NewPortalProvider()
	release, err := provider.Check(context.Background(), updater.CheckRequest{
		CurrentVersion: "1.0.0",
		Platform:       "darwin",
		Arch:           "arm64",
	})
	if err != nil {
		t.Fatalf("provider check failed: %v", err)
	}
	if release == nil {
		t.Fatalf("provider returned no release")
	}
	if release.Verification == nil || release.Verification.DigestAlgo != "sha256" {
		t.Fatalf("expected sha256 verification, got %+v", release.Verification)
	}

	var buf bytes.Buffer
	var lastWritten, lastTotal int64
	err = provider.Download(context.Background(), release, &buf, func(written, total int64) {
		lastWritten, lastTotal = written, total
	})
	if err != nil {
		t.Fatalf("download failed: %v", err)
	}
	if int64(buf.Len()) != info.Artifact.Size {
		t.Fatalf("downloaded %d bytes, expected %d", buf.Len(), info.Artifact.Size)
	}
	if lastWritten != int64(buf.Len()) || lastTotal != info.Artifact.Size {
		t.Errorf("progress callback ended at %d/%d, expected %d/%d", lastWritten, lastTotal, buf.Len(), info.Artifact.Size)
	}

	digest := sha256.Sum256(buf.Bytes())
	if !bytes.Equal(digest[:], release.Verification.Digest) {
		t.Fatalf("sha256 mismatch: downloaded artifact does not match portal digest")
	}
	t.Logf("downloaded %d bytes, sha256 verified against portal digest", buf.Len())

	// Same request from a platform the release has no artifact for must come
	// back up-to-date (deterministic notify-nothing).
	winInfo, err := fetchUpdateInfoFor("v1.0.0", "windows", "amd64")
	if err != nil {
		t.Fatalf("windows check failed: %v", err)
	}
	if !winInfo.UpToDate {
		t.Fatalf("expected up_to_date for platform without artifact, got %+v", winInfo)
	}
}
