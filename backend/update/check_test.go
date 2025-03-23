package update

import (
	"mqtt-viewer/backend/machine"
	"strings"
	"testing"
)

func TestBetaCheckUpdate(t *testing.T) {

	t.Run("Beta test should always return the newest version", func(t *testing.T) {
		mid := "aksjdhakhsdj"
		currentVersion := "0.0.0"
		os := "darwin"
		arch := "arm64"
		res, err := checkForUpdate(checkForUpdateParams{
			machineId:      mid,
			currentVersion: currentVersion,
			os:             os,
			arch:           arch,
		})
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
		if !res.CanUpdate {
			t.Errorf("expected update to be available, got unavailable")
		}
	})
}

func TestCheckUpdate(t *testing.T) {

	t.Run("trial expired", func(t *testing.T) {
		mid := machine.TMachineIdLicenseTrialExpired
		currentVersion := "0.0.0"
		os := "linux"
		arch := "amd64"
		res, err := checkForUpdate(checkForUpdateParams{
			machineId:      mid,
			currentVersion: currentVersion,
			os:             os,
			arch:           arch,
		})
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
		if res.CanUpdate {
			t.Errorf("expected update to be unavailable, got available")
		}
		if !strings.Contains(res.NotificationText, "expired") {
			t.Errorf("expected notification text to contain 'expired', got %s", res.NotificationText)
		}
	})

	t.Run("trial ongoing", func(t *testing.T) {
		mid := machine.TMachineIdLicenseTrial
		currentVersion := "0.0.0"
		os := "linux"
		arch := "amd64"
		res, err := checkForUpdate(checkForUpdateParams{
			machineId:      mid,
			currentVersion: currentVersion,
			os:             os,
			arch:           arch,
		})
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
		if !res.CanUpdate {
			t.Errorf("expected update to be available, got unavailable")
		}
	})

	t.Run("license expired", func(t *testing.T) {
		mid := machine.TMachineIdLicenseExpired
		currentVersion := "0.0.0"
		os := "linux"
		arch := "amd64"
		res, err := checkForUpdate(checkForUpdateParams{
			machineId:      mid,
			currentVersion: currentVersion,
			os:             os,
			arch:           arch,
		})
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
		if res.CanUpdate {
			t.Errorf("expected update to be unavailable, got available")
		}
		if !strings.Contains(res.NotificationText, "not valid") {
			t.Errorf("expected notification text to contain 'not valid', got %s", res.NotificationText)
		}
	})

	t.Run("license ongoing", func(t *testing.T) {
		mid := machine.TMachineIdLicenseValid
		currentVersion := "0.0.0"
		os := "linux"
		arch := "amd64"
		res, err := checkForUpdate(checkForUpdateParams{
			machineId:      mid,
			currentVersion: currentVersion,
			os:             os,
			arch:           arch,
		})
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
		if !res.CanUpdate {
			t.Errorf("expected update to be available, got unavailable")
		}
	})

	t.Run("no record of machine id :(", func(t *testing.T) {
		fakeMachineId := "fake-machine-id"
		fakeCurrentVersion := "fake-current-version"
		fakeOs := "fake-os"
		fakeArch := "fake-arch"

		update, err := checkForUpdate(checkForUpdateParams{
			machineId:      fakeMachineId,
			currentVersion: fakeCurrentVersion,
			os:             fakeOs,
			arch:           fakeArch,
		})
		if err == nil {
			t.Errorf("expected error, got nil")
		}
		if update != (UpdateResponse{}) {
			t.Errorf("expected empty UpdateResponse, got %v", update)
		}
	})
}
