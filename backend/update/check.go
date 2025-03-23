package update

import (
	"encoding/json"
	"fmt"
	"mqtt-viewer/backend/cloud"
	"net/http"
)

var updateEndpoint = "/api/cv1/updates/latest"

type UpdateRequest struct {
	MachineId      string `json:"machine_id"`
	CurrentVersion string `json:"current_version"`
	Os             string `json:"os"`
	Arch           string `json:"arch"`
}

type UpdateResponse struct {
	MachineId        string `json:"machine_id"`
	LatestVersion    string `json:"latest_version"`
	CanUpdate        bool   `json:"can_update"` // marked as false if license is not valid for this update
	ReleaseNotes     string `json:"release_notes"`
	NotificationText string `json:"notification_text"`
	NotificationUrl  string `json:"notification_url"`
	UpdateUrl        string `json:"update_url"` // Empty if cannot update
}

type checkForUpdateParams struct {
	machineId      string
	currentVersion string
	os             string
	arch           string
}

func checkForUpdate(params checkForUpdateParams) (UpdateResponse, error) {
	updateRequest := UpdateRequest{
		MachineId:      params.machineId,
		CurrentVersion: params.currentVersion,
		Os:             params.os,
		Arch:           params.arch,
	}

	res, err := cloud.GetClient().R().SetBody(updateRequest).Post(updateEndpoint)
	if err != nil {
		return UpdateResponse{}, newCheckUpdateErr(err)
	}

	if res.StatusCode() != http.StatusOK {
		return UpdateResponse{}, newCheckUpdateErr(fmt.Errorf("unexpected status code: %d", res.StatusCode()))
	}

	updateResponse := UpdateResponse{}
	err = json.Unmarshal(res.Body(), &updateResponse)

	if err != nil {
		return UpdateResponse{}, newCheckUpdateErr(err)
	}

	return updateResponse, nil
}

func newCheckUpdateErr(err error) error {
	return fmt.Errorf("check update: %w", err)
}
