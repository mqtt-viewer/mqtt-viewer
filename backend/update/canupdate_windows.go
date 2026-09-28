//go:build windows

package update

import "path/filepath"

// binaryIsSelfUpdatable reports whether this installation can replace its own
// binary. The updater helper runs without elevation and writes a backup and
// the new exe next to the running one, so the exe's directory must be
// writable. A portable exe in a user folder passes; the NSIS installer's
// machine-wide install under Program Files does not.
func binaryIsSelfUpdatable() bool {
	exe, err := osExecutable()
	if err != nil {
		return false
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return dirIsWritable(filepath.Dir(exe))
}
