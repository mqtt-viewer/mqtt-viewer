//go:build windows

package update

import "sync"

// selfUpdatable caches the probe: it writes a file into the install folder,
// and the check runs on every poll. Caching also keeps the update dialog and
// StartUpdate in agreement.
var selfUpdatable = sync.OnceValue(exeDirWritable)

// binaryIsSelfUpdatable reports whether this installation can replace its own
// binary. The updater helper runs without elevation and writes a backup and
// the new exe next to the running one, so the exe's folder must be writable.
// A portable exe in a user folder passes; the NSIS installer's machine-wide
// install under Program Files does not.
func binaryIsSelfUpdatable() bool {
	return selfUpdatable()
}
