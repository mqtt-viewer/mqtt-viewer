package update

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestDirIsWritable(t *testing.T) {
	dir := t.TempDir()
	if !dirIsWritable(dir) {
		t.Fatal("a fresh temp dir should be writable")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("probe file should be removed, found %d entries", len(entries))
	}
}

func TestDirIsWritable_MissingDir(t *testing.T) {
	if dirIsWritable(filepath.Join(t.TempDir(), "missing")) {
		t.Fatal("a missing dir should not be writable")
	}
}

func TestDirIsWritable_ReadOnlyDir(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("mode bits do not restrict root or Windows ACLs")
	}
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })
	if dirIsWritable(dir) {
		t.Fatal("a read-only dir should not be writable")
	}
}

func TestExeDirWritable_ChecksUnresolvedExeFolder(t *testing.T) {
	dir := t.TempDir()
	orig := osExecutable
	t.Cleanup(func() { osExecutable = orig })

	osExecutable = func() (string, error) { return filepath.Join(dir, "mqtt-viewer.exe"), nil }
	if !exeDirWritable() {
		t.Fatal("exe in a writable folder should be self-updatable")
	}

	osExecutable = func() (string, error) { return filepath.Join(dir, "missing", "mqtt-viewer.exe"), nil }
	if exeDirWritable() {
		t.Fatal("exe in an unwritable folder should not be self-updatable")
	}
}
