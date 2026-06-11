package update

import (
	"encoding/json"
	"fmt"
	"mqtt-viewer/backend/cloud"
	"mqtt-viewer/backend/env"
	"net/http"
	"runtime"
	"time"
)

// checkEndpoint is the portal endpoint queried for update information.
// See docs/update-endpoint-spec.md for the full contract.
var checkEndpoint = "/api/cv1/updates/v3/check"

type portalCheckRequest struct {
	MachineId      string `json:"machine_id"`
	CurrentVersion string `json:"current_version"`
	Os             string `json:"os"`
	Arch           string `json:"arch"`
}

type portalArtifact struct {
	Name   string `json:"name"`
	Url    string `json:"url"`
	Size   int64  `json:"size"`
	Sha256 string `json:"sha256"`
}

type portalCheckResponse struct {
	UpToDate         bool            `json:"up_to_date"`
	LatestVersion    string          `json:"latest_version"`
	CanUpdate        bool            `json:"can_update"` // false if license is not valid for this update
	ReleaseNotes     string          `json:"release_notes"`
	PublishedAt      *time.Time      `json:"published_at"`
	NotificationText string          `json:"notification_text"`
	NotificationUrl  string          `json:"notification_url"`
	Artifact         *portalArtifact `json:"artifact"`
}

// fetchUpdateInfo queries the portal update endpoint for the running platform.
func fetchUpdateInfo(currentVersion string) (*portalCheckResponse, error) {
	return fetchUpdateInfoFor(currentVersion, runtime.GOOS, runtime.GOARCH)
}

func fetchUpdateInfoFor(currentVersion string, os string, arch string) (*portalCheckResponse, error) {
	req := portalCheckRequest{
		MachineId:      env.MachineId,
		CurrentVersion: currentVersion,
		Os:             os,
		Arch:           arch,
	}

	res, err := cloud.GetClient().R().SetBody(req).Post(checkEndpoint)
	if err != nil {
		return nil, fmt.Errorf("check update: %w", err)
	}
	if res.StatusCode() != http.StatusOK {
		return nil, fmt.Errorf("check update: unexpected status code: %d", res.StatusCode())
	}

	checkResponse := portalCheckResponse{}
	if err := json.Unmarshal(res.Body(), &checkResponse); err != nil {
		return nil, fmt.Errorf("check update: %w", err)
	}
	return &checkResponse, nil
}
