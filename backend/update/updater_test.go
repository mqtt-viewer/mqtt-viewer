package update

import (
	"mqtt-viewer/backend/env"
	"strings"
	"testing"
)

// withServerBuild sets env.IsServerBuild for the duration of a test and
// restores it afterwards. env.IsServerBuild is a package variable, not an
// environment variable, so t.Setenv cannot manage it.
func withServerBuild(t *testing.T, on bool) {
	t.Helper()
	prev := env.IsServerBuild
	env.IsServerBuild = on
	t.Cleanup(func() { env.IsServerBuild = prev })
}

func TestResolveInstallType_ServerBuilds(t *testing.T) {
	withServerBuild(t, true)

	t.Setenv("MQTT_VIEWER_INSTALL_TYPE", "home-assistant")
	if got := resolveInstallType(); got != installHomeAssistant {
		t.Fatalf("expected home-assistant-addon, got %q", got)
	}

	// Anything else, including unset, is a plain Docker run. A desktop-only
	// signal like FLATPAK_ID must not leak through in a server build.
	t.Setenv("MQTT_VIEWER_INSTALL_TYPE", "")
	t.Setenv("FLATPAK_ID", "app.mqttviewer.MQTTViewer")
	if got := resolveInstallType(); got != installDocker {
		t.Fatalf("expected docker when install type unset, got %q", got)
	}

	t.Setenv("MQTT_VIEWER_INSTALL_TYPE", "something-else")
	if got := resolveInstallType(); got != installDocker {
		t.Fatalf("expected docker for unknown install type, got %q", got)
	}
}

func TestUpdateGuidance_Docker(t *testing.T) {
	cmd, instructions, url := updateGuidance(installDocker)
	if !strings.Contains(cmd, "docker pull") {
		t.Fatalf("docker command should run `docker pull`, got %q", cmd)
	}
	if instructions == "" {
		t.Fatal("docker should have instructions")
	}
	if url != releasesPageURL {
		t.Fatalf("docker should point at the releases page, got %q", url)
	}
}

func TestUpdateGuidance_HomeAssistant(t *testing.T) {
	cmd, instructions, url := updateGuidance(installHomeAssistant)
	if cmd != "" {
		t.Fatalf("home-assistant should have no command, got %q", cmd)
	}
	if instructions == "" {
		t.Fatal("home-assistant should have instructions")
	}
	if url != "" {
		t.Fatalf("home-assistant updates flow through HA, so no releases URL; got %q", url)
	}
}

func TestCanSelfUpdate_FalseForServerBuilds(t *testing.T) {
	withServerBuild(t, true)
	if canSelfUpdate() {
		t.Fatal("canSelfUpdate must be false for server builds regardless of file permissions")
	}
}

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
