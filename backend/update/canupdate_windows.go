//go:build windows

package update

// binaryIsSelfUpdatable reports whether this installation can replace its own
// binary. On Windows the updater helper renames the locked executable
// aside, which works for per-user and machine installs alike.
func binaryIsSelfUpdatable() bool {
	return true
}
