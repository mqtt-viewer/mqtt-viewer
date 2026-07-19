package app

import (
	"mqtt-viewer/backend/models"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
)

var testProtosGoodDir = path.Join(appDir, "..", "protobuf", "test-protos", "test-protos-good")

// copyDirForTest copies src into a fresh t.TempDir(), so a test can delete or
// mutate its own throwaway copy of a fixture directory without touching the
// checked-in original.
func copyDirForTest(t *testing.T, src string) string {
	t.Helper()
	dest := t.TempDir()
	entries, err := os.ReadDir(src)
	if err != nil {
		t.Fatalf("reading fixture dir: %v", err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		content, err := os.ReadFile(filepath.Join(src, entry.Name()))
		if err != nil {
			t.Fatalf("reading fixture file: %v", err)
		}
		if err := os.WriteFile(filepath.Join(dest, entry.Name()), content, 0660); err != nil {
			t.Fatalf("writing fixture copy: %v", err)
		}
	}
	return dest
}

func TestImportProtoDirCopiesFilesAndCompiles(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	state, err := app.ImportProtoDir(connId, testProtosGoodDir)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if state.LoadError != "" {
		t.Errorf("Expected no load error, got %v", state.LoadError)
	}
	if len(state.DescriptorNames) == 0 {
		t.Error("Expected descriptor names to be populated")
	}
	found := false
	for _, name := range state.DescriptorNames {
		if name == "demo.SensorPayload" {
			found = true
		}
	}
	if !found {
		t.Errorf("Expected demo.SensorPayload among descriptor names, got %v", state.DescriptorNames)
	}
	if state.SourceDir != testProtosGoodDir {
		t.Errorf("Expected SourceDir %v, got %v", testProtosGoodDir, state.SourceDir)
	}

	// The internal copy, not the original, is what got compiled.
	internalDir := app.protoImportDir(connId)
	if state.Dir != internalDir {
		t.Errorf("Expected compiled dir %v, got %v", internalDir, state.Dir)
	}
	copiedFiles, err := os.ReadDir(internalDir)
	if err != nil {
		t.Fatalf("reading internal import dir: %v", err)
	}
	if len(copiedFiles) == 0 {
		t.Error("Expected .proto files to be copied into the internal import dir")
	}
}

func TestImportProtoDirRejectsMissingFolder(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	_, err := app.ImportProtoDir(connId, "/definitely/does/not/exist-abc123")
	if err == nil {
		t.Fatal("Expected an error for a missing source folder")
	}
}

func TestImportProtoDirRejectsFolderWithNoProtoFiles(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	empty := t.TempDir()
	_, err := app.ImportProtoDir(connId, empty)
	if err == nil {
		t.Fatal("Expected an error for a folder with no .proto files")
	}
}

func TestImportProtoDirUnknownConnection(t *testing.T) {
	app := getTestApp(t)

	if _, err := app.ImportProtoDir(999, testProtosGoodDir); err == nil {
		t.Fatal("Expected an error for an unknown connection id")
	}
}

func TestReimportProtoRecompilesFromRecordedSource(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	if _, err := app.ImportProtoDir(connId, testProtosGoodDir); err != nil {
		t.Fatalf("importing: %v", err)
	}

	state, err := app.ReimportProto(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(state.DescriptorNames) == 0 {
		t.Error("Expected descriptor names to survive a re-import")
	}
}

func TestReimportProtoErrorsWithNoRecordedSource(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	if _, err := app.ReimportProto(connId); err == nil {
		t.Fatal("Expected an error when no source folder has been recorded")
	}
}

func TestReimportProtoErrorsWhenSourceRemoved(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	throwaway := copyDirForTest(t, testProtosGoodDir)
	if _, err := app.ImportProtoDir(connId, throwaway); err != nil {
		t.Fatalf("importing: %v", err)
	}

	if err := os.RemoveAll(throwaway); err != nil {
		t.Fatalf("removing throwaway source: %v", err)
	}

	if _, err := app.ReimportProto(connId); err == nil {
		t.Fatal("Expected an error when the recorded source folder no longer exists")
	}

	// The previously-imported internal copy and its compiled state must
	// survive a failed re-import.
	state, err := app.GetProtoState(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(state.DescriptorNames) == 0 {
		t.Error("Expected the prior import's descriptor names to still be loaded")
	}
}

func TestImportProtoFilesHappyPath(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	content, err := os.ReadFile(filepath.Join(testProtosGoodDir, "demo.proto"))
	if err != nil {
		t.Fatalf("reading fixture: %v", err)
	}

	state, err := app.ImportProtoFiles(connId, []ProtoUploadFile{
		{Name: "demo.proto", Content: string(content)},
	})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if state.SourceDir != "" {
		t.Errorf("Expected no SourceDir for an upload, got %v", state.SourceDir)
	}
	found := false
	for _, name := range state.DescriptorNames {
		if name == "demo.SensorPayload" {
			found = true
		}
	}
	if !found {
		t.Errorf("Expected demo.SensorPayload among descriptor names, got %v", state.DescriptorNames)
	}
}

func TestImportProtoFilesPreservesRelativeSubpaths(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	content, err := os.ReadFile(filepath.Join(testProtosGoodDir, "demo.proto"))
	if err != nil {
		t.Fatalf("reading fixture: %v", err)
	}

	_, err = app.ImportProtoFiles(connId, []ProtoUploadFile{
		{Name: "nested/demo.proto", Content: string(content)},
	})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if _, err := os.Stat(filepath.Join(app.protoImportDir(connId), "nested", "demo.proto")); err != nil {
		t.Errorf("Expected the relative subpath to be preserved, got %v", err)
	}
}

func TestImportProtoFilesRejectsEmptyList(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	if _, err := app.ImportProtoFiles(connId, []ProtoUploadFile{}); err == nil {
		t.Fatal("Expected an error for an empty file list")
	}
}

func TestImportProtoFilesRejectsAbsoluteName(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	_, err := app.ImportProtoFiles(connId, []ProtoUploadFile{{Name: "/etc/evil.proto", Content: ""}})
	if err == nil {
		t.Fatal("Expected an error for an absolute file name")
	}
}

func TestImportProtoFilesRejectsTraversal(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	_, err := app.ImportProtoFiles(connId, []ProtoUploadFile{{Name: "../evil.proto", Content: ""}})
	if err == nil {
		t.Fatal("Expected an error for a traversal file name")
	}
}

func TestImportProtoFilesRejectsBackslash(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	_, err := app.ImportProtoFiles(connId, []ProtoUploadFile{{Name: "sub\\evil.proto", Content: ""}})
	if err == nil {
		t.Fatal("Expected an error for a backslash in the file name")
	}
}

func TestImportProtoFilesRejectsWrongExtension(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	_, err := app.ImportProtoFiles(connId, []ProtoUploadFile{{Name: "evil.txt", Content: ""}})
	if err == nil {
		t.Fatal("Expected an error for a non-.proto file name")
	}
}

func TestImportProtoFilesAllowsForwardSlashSubpath(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	content, err := os.ReadFile(filepath.Join(testProtosGoodDir, "simple.proto"))
	if err != nil {
		t.Fatalf("reading fixture: %v", err)
	}

	_, err = app.ImportProtoFiles(connId, []ProtoUploadFile{
		{Name: "common/simple.proto", Content: string(content)},
	})
	if err != nil {
		t.Fatalf("Expected forward-slash relative subpaths to be allowed, got %v", err)
	}
}

func TestClearProtoImportEmptiesState(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	if _, err := app.ImportProtoDir(connId, testProtosGoodDir); err != nil {
		t.Fatalf("importing: %v", err)
	}

	state, err := app.ClearProtoImport(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if state.Dir != "" {
		t.Errorf("Expected no compiled dir after clearing, got %v", state.Dir)
	}
	if state.SourceDir != "" {
		t.Errorf("Expected no source dir after clearing, got %v", state.SourceDir)
	}
	if state.HasImport {
		t.Error("Expected HasImport to be false after clearing")
	}
	if len(state.DescriptorNames) != 0 {
		t.Errorf("Expected no descriptor names after clearing, got %v", state.DescriptorNames)
	}

	if _, err := os.Stat(app.protoImportDir(connId)); !os.IsNotExist(err) {
		t.Errorf("Expected the internal import dir to be removed, got err %v", err)
	}

	// Re-import should now fail: clearing forgot the source.
	if _, err := app.ReimportProto(connId); err == nil {
		t.Fatal("Expected re-import to fail once the source has been cleared")
	}
}

func TestClearProtoImportLeavesRulesInPlace(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	if _, err := app.ImportProtoDir(connId, testProtosGoodDir); err != nil {
		t.Fatalf("importing: %v", err)
	}
	if _, err := app.AddProtoBindingRule(connId, models.ProtoBindingRule{TopicFilter: "sensors/+/telemetry", MessageType: "demo.SensorPayload"}); err != nil {
		t.Fatalf("adding rule: %v", err)
	}

	state, err := app.ClearProtoImport(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(state.Rules) != 1 {
		t.Errorf("Expected the binding rule to survive clearing the import, got %v", state.Rules)
	}
}

func TestDeleteConnectionRemovesProtoImportDir(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	if _, err := app.ImportProtoDir(connId, testProtosGoodDir); err != nil {
		t.Fatalf("importing: %v", err)
	}

	importDir := app.protoImportDir(connId)
	if _, err := os.Stat(importDir); err != nil {
		t.Fatalf("Expected the import dir to exist before delete, got %v", err)
	}

	if err := app.DeleteConnection(connId); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if _, err := os.Stat(importDir); !os.IsNotExist(err) {
		t.Errorf("Expected the import dir to be removed, got err %v", err)
	}
}

// TestSwapInProtoImportFilesLeavesPreviousImportIntactOnFailure exercises the
// atomic-swap failure path directly: staging under proto-imports/ (rather
// than the OS temp dir) means a failure to even create the staging directory
// must never touch the previously-imported dir. Uses a read-only
// proto-imports/ parent to force that failure deterministically.
func TestSwapInProtoImportFilesLeavesPreviousImportIntactOnFailure(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("permission-based failure injection isn't reliable on windows")
	}
	if os.Geteuid() == 0 {
		t.Skip("root bypasses the permission check this test relies on")
	}

	app, connId := getTestAppWithConnection(t)
	if _, err := app.ImportProtoDir(connId, testProtosGoodDir); err != nil {
		t.Fatalf("importing: %v", err)
	}
	before, err := os.ReadDir(app.protoImportDir(connId))
	if err != nil {
		t.Fatalf("reading established import dir: %v", err)
	}

	parent := filepath.Join(app.Paths.ResourcePath, protoImportsDirName)
	if err := os.Chmod(parent, 0500); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	t.Cleanup(func() { os.Chmod(parent, 0770) })

	content, err := os.ReadFile(filepath.Join(testProtosGoodDir, "demo.proto"))
	if err != nil {
		t.Fatalf("reading fixture: %v", err)
	}
	err = app.swapInProtoImportFiles(connId, []ProtoUploadFile{{Name: "demo.proto", Content: string(content)}})
	if err == nil {
		t.Fatal("Expected the swap to fail when the proto-imports parent directory isn't writable")
	}

	if err := os.Chmod(parent, 0770); err != nil {
		t.Fatalf("chmod restore: %v", err)
	}

	after, err := os.ReadDir(app.protoImportDir(connId))
	if err != nil {
		t.Fatalf("reading import dir after failed swap: %v", err)
	}
	if len(after) != len(before) {
		t.Errorf("Expected the previous import to survive a failed swap untouched, got %v files vs %v before", len(after), len(before))
	}
}

// TestConcurrentProtoImportsAreSerialized fires overlapping ImportProtoDir
// and ImportProtoFiles calls for the same connection (as two open windows
// importing/re-importing around the same time would) and checks that the
// per-connection import lock (protoState.importMu) kept the swaps from
// interleaving into a torn or failed compile. Run with -race to also catch
// any data race the lock is meant to prevent.
func TestConcurrentProtoImportsAreSerialized(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	content, err := os.ReadFile(filepath.Join(testProtosGoodDir, "demo.proto"))
	if err != nil {
		t.Fatalf("reading fixture: %v", err)
	}

	var wg sync.WaitGroup
	errCh := make(chan error, 20)
	for i := 0; i < 10; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			if _, err := app.ImportProtoDir(connId, testProtosGoodDir); err != nil {
				errCh <- err
			}
		}()
		go func() {
			defer wg.Done()
			if _, err := app.ImportProtoFiles(connId, []ProtoUploadFile{{Name: "demo.proto", Content: string(content)}}); err != nil {
				errCh <- err
			}
		}()
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Errorf("concurrent import returned an error: %v", err)
	}

	state, err := app.GetProtoState(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if state.LoadError != "" {
		t.Errorf("Expected no load error from a torn swap, got %v", state.LoadError)
	}
	if !state.HasImport {
		t.Error("Expected an import to be present once the concurrent imports settle")
	}
}

// TestConnectMqttLazyLoadsInternalProtoDir mirrors the ConnectMqtt lazy-load
// path used to exercise ProtoRegDir directly against a user path: with proto
// enabled and something already imported, connecting must compile the
// internal copy into the live protoState without an explicit
// LoadProtoRegistry call.
func TestConnectMqttLazyLoadsInternalProtoDir(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	if _, err := app.ImportProtoDir(connId, testProtosGoodDir); err != nil {
		t.Fatalf("importing: %v", err)
	}

	trueVal := true
	conn := models.Connection{}
	if res := app.Db.First(&conn, connId); res.Error != nil {
		t.Fatalf("fetching connection: %v", res.Error)
	}
	conn.IsProtoEnabled = &trueVal
	if err := app.UpdateConnection(&conn); err != nil {
		t.Fatalf("enabling proto: %v", err)
	}

	// Simulate a fresh app session: nothing compiled into protoState yet,
	// same as after a restart, before ConnectMqtt has run.
	app.AppConnections[connId].ProtoState.Clear()

	if err := app.ConnectMqtt(connId); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	registry := app.AppConnections[connId].ProtoState.Registry()
	if registry == nil {
		t.Fatal("Expected ConnectMqtt to lazily compile the internal proto import dir")
	}
}
