package update

import (
	"os"
	"path/filepath"
)

// exeDirWritable reports whether the current user can create files in the
// running executable's folder. It checks the unresolved path because that is
// what the updater helper swaps.
func exeDirWritable() bool {
	exe, err := osExecutable()
	if err != nil {
		return false
	}
	return dirIsWritable(filepath.Dir(exe))
}

// dirIsWritable reports whether the current user can create files in dir, by
// creating and removing a probe file. On Windows a permission check on the
// directory is not reliable (ACLs, UAC), so an actual write is the only
// trustworthy test.
func dirIsWritable(dir string) bool {
	f, err := os.CreateTemp(dir, ".mqtt-viewer-update-probe-*")
	if err != nil {
		return false
	}
	name := f.Name()
	_ = f.Close()
	_ = os.Remove(name)
	return true
}
