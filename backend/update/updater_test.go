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

func TestIsNixStorePath(t *testing.T) {
	if !isNixStorePath("/nix/store/abcd-mqtt-viewer-1.0.0/bin/mqtt-viewer") {
		t.Fatal("a path under /nix/store should be a store path")
	}
	if isNixStorePath("/usr/local/bin/mqtt-viewer") {
		t.Fatal("/usr/local/bin should not be a store path")
	}
	if isNixStorePath("/home/u/.nix-profile/bin/mqtt-viewer") {
		t.Fatal("a profile symlink path is not itself a store path")
	}
	// The prefix trap: without the separator, HasPrefix would match this.
	if isNixStorePath("/nix/storeage/bin/x") {
		t.Fatal("/nix/storeage should not be treated as being inside /nix/store")
	}
	if isNixStorePath("/nix/store") {
		t.Fatal("the store root itself is not a store path")
	}
}

func TestIsNixStorePath_HonoursNixStoreDir(t *testing.T) {
	t.Setenv("NIX_STORE_DIR", "/custom/store")
	if !isNixStorePath("/custom/store/x/bin/y") {
		t.Fatal("should honour NIX_STORE_DIR")
	}
	if isNixStorePath("/nix/store/x/bin/y") {
		t.Fatal("the default root should not apply when NIX_STORE_DIR is set")
	}
}

func TestResolveInstallType_Nix(t *testing.T) {
	t.Setenv("FLATPAK_ID", "")
	t.Setenv("APPIMAGE", "")
	defer func(orig func() (string, error)) { osExecutable = orig }(osExecutable)
	osExecutable = func() (string, error) {
		return "/nix/store/abcd-mqtt-viewer-1.0.0/bin/mqtt-viewer", nil
	}
	if got := resolveInstallType(); got != installNix {
		t.Fatalf("expected nix, got %q", got)
	}
}

func TestUpdateGuidance_Nix(t *testing.T) {
	cmd, instructions, url := updateGuidance(installNix)
	if !strings.Contains(cmd, "nix profile upgrade") {
		t.Fatalf("nix command should run `nix profile upgrade`, got %q", cmd)
	}
	if instructions == "" {
		t.Fatal("nix should have instructions")
	}
	if url != "" {
		t.Fatalf("nix should have no releases URL, got %q", url)
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
