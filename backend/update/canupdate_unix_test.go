//go:build !windows

package update

import "testing"

func TestCanSelfUpdate_FalseInFlatpak(t *testing.T) {
	t.Setenv("FLATPAK_ID", "app.mqttviewer.MQTTViewer")
	if canSelfUpdate() {
		t.Fatal("canSelfUpdate must be false inside a Flatpak sandbox")
	}
}
