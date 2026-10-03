package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The swap is two renames. A process death between them leaves .previous
// and a staging dir but no live dir; the next load must restore .previous.
func TestLoadProtoRegistryRestoresImportInterruptedMidSwap(t *testing.T) {
	app, connId := getTestAppWithConnection(t)
	if _, err := app.ImportProtoDir(connId, testProtosGoodDir); err != nil {
		t.Fatalf("importing: %v", err)
	}
	dir := app.protoImportDir(connId)
	if err := os.Rename(dir, dir+".previous"); err != nil {
		t.Fatal(err)
	}
	staging, err := os.MkdirTemp(filepath.Dir(dir), protoImportStagingPattern(connId))
	if err != nil {
		t.Fatal(err)
	}
	// A fresh session: nothing compiled yet.
	mustAppConnection(t, app, connId).ProtoState.Clear()

	state, err := app.LoadProtoRegistry(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if !state.HasImport || !hasDescriptor(state, "demo.SensorPayload") {
		t.Errorf("Expected the previous import restored, got hasImport=%v names=%v", state.HasImport, state.DescriptorNames)
	}
	if _, err := os.Stat(dir + ".previous"); !os.IsNotExist(err) {
		t.Errorf("Expected .previous to be gone, got %v", err)
	}
	if _, err := os.Stat(staging); !os.IsNotExist(err) {
		t.Errorf("Expected the stale staging dir removed, got %v", err)
	}
}

// With both the live dir and .previous present the swap finished; .previous
// is stale and the live dir wins.
func TestLoadProtoRegistryRemovesStalePreviousWhenLiveDirExists(t *testing.T) {
	app, connId := getTestAppWithConnection(t)
	if _, err := app.ImportProtoDir(connId, testProtosGoodDir); err != nil {
		t.Fatalf("importing: %v", err)
	}
	dir := app.protoImportDir(connId)
	if err := os.MkdirAll(dir+".previous", 0770); err != nil {
		t.Fatal(err)
	}
	stale := "syntax = \"proto3\";\n\npackage stale;\n\nmessage Old {\n  string v = 1;\n}\n"
	if err := os.WriteFile(filepath.Join(dir+".previous", "old.proto"), []byte(stale), 0660); err != nil {
		t.Fatal(err)
	}
	staging, err := os.MkdirTemp(filepath.Dir(dir), protoImportStagingPattern(connId))
	if err != nil {
		t.Fatal(err)
	}
	other, err := os.MkdirTemp(filepath.Dir(dir), protoImportStagingPattern(connId+1000))
	if err != nil {
		t.Fatal(err)
	}
	mustAppConnection(t, app, connId).ProtoState.Clear()

	state, err := app.LoadProtoRegistry(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if !hasDescriptor(state, "demo.SensorPayload") || hasDescriptor(state, "stale.Old") {
		t.Errorf("Expected the live import only, got %v", state.DescriptorNames)
	}
	if _, err := os.Stat(dir + ".previous"); !os.IsNotExist(err) {
		t.Errorf("Expected .previous removed, got %v", err)
	}
	if _, err := os.Stat(staging); !os.IsNotExist(err) {
		t.Errorf("Expected the stale staging dir removed, got %v", err)
	}
	if _, err := os.Stat(other); err != nil {
		t.Errorf("Expected another connection's staging dir left alone, got %v", err)
	}
}

func TestImportProtoDirSkipsHiddenAndDeepEntries(t *testing.T) {
	app, connId := getTestAppWithConnection(t)
	src := copyDirForTest(t, testProtosGoodDir)

	// AppleDouble files are binary junk with a .proto extension.
	if err := os.WriteFile(filepath.Join(src, "._demo.proto"), []byte{0, 5, 22, 7, 0, 2}, 0660); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(src, ".git", "x"), 0770); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, ".git", "x", "bad name .proto"), []byte("not a proto"), 0660); err != nil {
		t.Fatal(err)
	}
	nested := filepath.Join(src, filepath.FromSlash(strings.Repeat("d/", maxProtoImportDepth+1)))
	if err := os.MkdirAll(nested, 0770); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "deep.proto"), []byte("not a proto"), 0660); err != nil {
		t.Fatal(err)
	}

	state, err := app.ImportProtoDir(connId, src)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if !hasDescriptor(state, "demo.SensorPayload") {
		t.Errorf("Expected the regular files to import, got %v", state.DescriptorNames)
	}
	for _, rel := range []string{"._demo.proto", ".git"} {
		if _, err := os.Lstat(filepath.Join(app.protoImportDir(connId), rel)); !os.IsNotExist(err) {
			t.Errorf("Expected %s skipped, got %v", rel, err)
		}
	}
}

func TestImportProtoDirSkipsUnreadableSubfolder(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores directory permissions")
	}
	app, connId := getTestAppWithConnection(t)
	src := copyDirForTest(t, testProtosGoodDir)
	locked := filepath.Join(src, "locked")
	if err := os.MkdirAll(locked, 0770); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(locked, "x.proto"), []byte("syntax = \"proto3\";\n"), 0660); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(locked, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(locked, 0770) })

	state, err := app.ImportProtoDir(connId, src)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if !hasDescriptor(state, "demo.SensorPayload") {
		t.Errorf("Expected the readable files to import, got %v", state.DescriptorNames)
	}
}

func TestImportProtoDirInvalidProtoNameErrorsByRelativePath(t *testing.T) {
	app, connId := getTestAppWithConnection(t)
	src := copyDirForTest(t, testProtosGoodDir)
	if err := os.MkdirAll(filepath.Join(src, "sub"), 0770); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "sub", " padded.proto"), []byte("syntax = \"proto3\";\n"), 0660); err != nil {
		t.Fatal(err)
	}
	_, err := app.ImportProtoDir(connId, src)
	if err == nil {
		t.Fatal("Expected an invalid name error")
	}
	if !strings.Contains(err.Error(), `"sub/ padded.proto"`) || strings.Contains(err.Error(), src) {
		t.Errorf("Expected the relative name only, got %v", err)
	}
}

func TestImportProtoFilesRejectsCaseInsensitiveDuplicates(t *testing.T) {
	app, connId := getTestAppWithConnection(t)
	_, err := app.ImportProtoFiles(connId, []ProtoUploadFile{
		{Name: "common/Types.proto", Content: "syntax = \"proto3\";\n"},
		{Name: "Common/types.proto", Content: "syntax = \"proto3\";\n"},
	})
	if err == nil || !strings.Contains(err.Error(), "twice") {
		t.Errorf("Expected a duplicate error, got %v", err)
	}
}

func TestImportProtoFilesRejectsOverlongNames(t *testing.T) {
	app, connId := getTestAppWithConnection(t)
	longSegment := strings.Repeat("a", maxProtoImportSegmentBytes+1-len(".proto")) + ".proto"
	longName := strings.Repeat(strings.Repeat("b", 100)+"/", 11) + "x.proto"
	for _, name := range []string{longSegment, "dir/" + longSegment, longName} {
		_, err := app.ImportProtoFiles(connId, []ProtoUploadFile{{Name: name, Content: "syntax = \"proto3\";\n"}})
		if err == nil || !strings.HasPrefix(err.Error(), "invalid file name") {
			t.Errorf("Expected an invalid name error for a %d-byte name, got %v", len(name), err)
			continue
		}
		if strings.Contains(err.Error(), app.Paths.ResourcePath) {
			t.Errorf("Expected no data-dir path in the error, got %v", err)
		}
	}
	// Exactly at the limits is fine.
	okSegment := strings.Repeat("a", maxProtoImportSegmentBytes-len(".proto")) + ".proto"
	if err := validateProtoUploadName(okSegment); err != nil {
		t.Errorf("Expected a %d-byte segment to be valid, got %v", len(okSegment), err)
	}
}

// A write failure inside the data dir names the file by its relative path.
func TestImportProtoFilesWriteErrorHidesDataDir(t *testing.T) {
	app, connId := getTestAppWithConnection(t)
	// "a.proto" as a file and as a folder can't both exist.
	_, err := app.ImportProtoFiles(connId, []ProtoUploadFile{
		{Name: "a.proto", Content: "syntax = \"proto3\";\n"},
		{Name: "a.proto/b.proto", Content: "syntax = \"proto3\";\n"},
	})
	if err == nil {
		t.Fatal("Expected a write error")
	}
	if strings.Contains(err.Error(), app.Paths.ResourcePath) || strings.Contains(err.Error(), ".staging-") {
		t.Errorf("Expected no data-dir path in the error, got %v", err)
	}
}
