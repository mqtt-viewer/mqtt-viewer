package update

import (
	"strings"
	"testing"
)

func TestResolveInstallType_FlatpakAndAppImage(t *testing.T) {
	t.Setenv("APPIMAGE", "")
	t.Setenv("FLATPAK_ID", "app.mqttviewer.MQTTViewer")
	if got := resolveInstallType(); got != installFlatpak {
		t.Fatalf("expected flatpak, got %q", got)
	}

	t.Setenv("FLATPAK_ID", "")
	t.Setenv("APPIMAGE", "/tmp/MQTT_Viewer.AppImage")
	if got := resolveInstallType(); got != installAppImage {
		t.Fatalf("expected appimage, got %q", got)
	}
}

func TestUpdateGuidance_Flatpak(t *testing.T) {
	cmd, instructions, url := updateGuidance(installFlatpak)
	if !strings.Contains(cmd, "flatpak update") {
		t.Fatalf("flatpak command should run `flatpak update`, got %q", cmd)
	}
	if instructions == "" {
		t.Fatal("flatpak should have instructions")
	}
	if url != "" {
		t.Fatalf("flatpak should have no releases URL, got %q", url)
	}
}

func TestUpdateGuidance_ManagedDownloads(t *testing.T) {
	for _, it := range []string{installAppImage, installLinuxPackage} {
		cmd, instructions, url := updateGuidance(it)
		if cmd != "" {
			t.Fatalf("%s should have no command, got %q", it, cmd)
		}
		if instructions == "" {
			t.Fatalf("%s should have instructions", it)
		}
		if url != releasesPageURL {
			t.Fatalf("%s should point at the releases page, got %q", it, url)
		}
	}
}

func TestUpdateGuidance_SelfUpdateTypesHaveNoInstructions(t *testing.T) {
	for _, it := range []string{installMacOS, installWindows, installLinuxPortable} {
		cmd, instructions, _ := updateGuidance(it)
		if cmd != "" || instructions != "" {
			t.Fatalf("%s (self-update) should have empty command/instructions, got cmd=%q instructions=%q", it, cmd, instructions)
		}
	}
}

func TestIsFlatpak(t *testing.T) {
	t.Setenv("FLATPAK_ID", "")
	if isFlatpak() {
		t.Fatal("should not detect flatpak when FLATPAK_ID is empty")
	}
	t.Setenv("FLATPAK_ID", "app.mqttviewer.MQTTViewer")
	if !isFlatpak() {
		t.Fatal("should detect flatpak when FLATPAK_ID is set")
	}
}
