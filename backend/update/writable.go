package update

import "os"

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
