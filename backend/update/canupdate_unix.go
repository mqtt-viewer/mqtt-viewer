//go:build !windows

package update

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

// canSelfUpdate reports whether this installation can replace its own
// binary. AppImage mounts are read-only and package-managed installs
// (deb/rpm into /usr/local/bin) are root-owned, so both fail the
// writability check and fall back to notification-only updates.
func canSelfUpdate() bool {
	if os.Getenv("APPIMAGE") != "" {
		return false
	}
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return false
	}
	// The swap removes and renames the target, so both the binary and its
	// directory must be writable. On macOS the target is the .app bundle
	// directory itself.
	dir := filepath.Dir(exe)
	return unix.Access(exe, unix.W_OK) == nil && unix.Access(dir, unix.W_OK) == nil
}
