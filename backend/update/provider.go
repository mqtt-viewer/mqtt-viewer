package update

import (
	"context"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

const artifactUrlMetadataKey = "portal.artifact.url"

// PortalProvider implements the Wails v3 updater.Provider interface against
// the MQTT Viewer portal. The portal decides which release (and which GitHub
// release asset) applies to the requesting machine, version, OS and arch.
type PortalProvider struct {
	httpClient *http.Client
}

func NewPortalProvider() *PortalProvider {
	return &PortalProvider{
		httpClient: http.DefaultClient,
	}
}

func (p *PortalProvider) Name() string {
	return "portal"
}

func (p *PortalProvider) Check(ctx context.Context, req updater.CheckRequest) (*updater.Release, error) {
	info, err := fetchUpdateInfoFor(req.CurrentVersion, req.Platform, req.Arch)
	if err != nil {
		return nil, err
	}

	if info.UpToDate || sameVersion(info.LatestVersion, req.CurrentVersion) {
		return nil, nil
	}
	// The portal marks updates the current license does not cover with
	// can_update=false. They must never be installed; the notification flow
	// (see Updater.CheckForUpdates) surfaces them to the user instead.
	if !info.CanUpdate {
		return nil, nil
	}
	if info.Artifact == nil || info.Artifact.Url == "" {
		return nil, fmt.Errorf("portal: update available but no artifact provided")
	}

	release := &updater.Release{
		Version: strings.TrimPrefix(info.LatestVersion, "v"),
		Name:    info.LatestVersion,
		Notes:   info.ReleaseNotes,
		Artifact: updater.Artifact{
			Filename: info.Artifact.Name,
			Size:     info.Artifact.Size,
			Platform: req.Platform,
			Arch:     req.Arch,
		},
		Metadata: map[string]any{
			artifactUrlMetadataKey: info.Artifact.Url,
		},
	}
	if info.PublishedAt != nil {
		release.PublishedAt = *info.PublishedAt
	}
	if info.Artifact.Sha256 != "" {
		digest, err := hex.DecodeString(info.Artifact.Sha256)
		if err != nil {
			return nil, fmt.Errorf("portal: invalid sha256 digest: %w", err)
		}
		release.Verification = &updater.Verification{
			DigestAlgo: "sha256",
			Digest:     digest,
		}
	}
	return release, nil
}

func (p *PortalProvider) Download(ctx context.Context, r *updater.Release, dst io.Writer, onProgress func(written, total int64)) error {
	if r == nil || r.Metadata == nil {
		return fmt.Errorf("portal: no release metadata")
	}
	urlStr, ok := r.Metadata[artifactUrlMetadataKey].(string)
	if !ok || urlStr == "" {
		return fmt.Errorf("portal: no artifact url in release metadata")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return err
	}
	res, err := p.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("portal: unexpected status code downloading artifact: %d", res.StatusCode)
	}

	total := res.ContentLength
	if total <= 0 {
		total = r.Artifact.Size
	}

	var written int64
	buf := make([]byte, 256*1024)
	for {
		n, readErr := res.Body.Read(buf)
		if n > 0 {
			if _, writeErr := dst.Write(buf[:n]); writeErr != nil {
				return writeErr
			}
			written += int64(n)
			onProgress(written, total)
		}
		if readErr == io.EOF {
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}

func sameVersion(a string, b string) bool {
	return strings.TrimPrefix(a, "v") == strings.TrimPrefix(b, "v")
}
