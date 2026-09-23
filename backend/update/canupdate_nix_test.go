//go:build !windows

package update

import "testing"

// Lives in a !windows file because canSelfUpdate is only build-tagged in for
// unix; the Windows implementation returns true unconditionally.
func TestCanSelfUpdate_FalseForNixInstall(t *testing.T) {
	t.Setenv("FLATPAK_ID", "")
	t.Setenv("APPIMAGE", "")
	defer func(orig func() (string, error)) { osExecutable = orig }(osExecutable)
	osExecutable = func() (string, error) {
		return "/nix/store/abcd-mqtt-viewer-1.0.0/bin/mqtt-viewer", nil
	}
	if canSelfUpdate() {
		t.Fatal("a Nix store install must never self-update")
	}
}
