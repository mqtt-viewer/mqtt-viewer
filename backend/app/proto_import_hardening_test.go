package app

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"mqtt-viewer/backend/models"
)

var testProtosOneBadDir = path.Join(appDir, "..", "protobuf", "test-protos", "test-protos-one-bad")

func hasDescriptor(state *ProtoStateResult, name string) bool {
	for _, n := range state.DescriptorNames {
		if n == name {
			return true
		}
	}
	return false
}

func stagingLeftovers(t *testing.T, app *App) []string {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(app.Paths.ResourcePath, protoImportsDirName, ".staging-*"))
	if err != nil {
		t.Fatalf("globbing staging dirs: %v", err)
	}
	return matches
}

const brokenProto = "syntax = \"proto3\";\n\npackage broken;\n\nmessage Broken {\n  string name = 1\n}\n"

// A broken re-import must not wipe a working one: the compile error comes
// back with relative paths, and the previous files, registry and recorded
// source all survive.
func TestImportProtoFilesCompileFailureKeepsPreviousImport(t *testing.T) {
	app, connId := getTestAppWithConnection(t)
	if _, err := app.ImportProtoDir(connId, testProtosGoodDir); err != nil {
		t.Fatalf("importing: %v", err)
	}

	_, err := app.ImportProtoFiles(connId, []ProtoUploadFile{{Name: "sub/broken.proto", Content: brokenProto}})
	if err == nil {
		t.Fatal("Expected the broken import to fail")
	}
	if !strings.HasPrefix(err.Error(), "sub/broken.proto:") {
		t.Errorf("Expected the compile error with a relative path, got %v", err)
	}
	if strings.Contains(err.Error(), app.Paths.ResourcePath) {
		t.Errorf("Expected no data-dir path in the error, got %v", err)
	}

	state, err := app.GetProtoState(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if state.LoadError != "" {
		t.Errorf("Expected no load error, got %v", state.LoadError)
	}
	if !hasDescriptor(state, "demo.SensorPayload") {
		t.Errorf("Expected the previous registry to stay live, got %v", state.DescriptorNames)
	}
	if state.SourceDir != testProtosGoodDir {
		t.Errorf("Expected proto_reg_dir to stay %v, got %v", testProtosGoodDir, state.SourceDir)
	}
	if _, err := os.Stat(filepath.Join(app.protoImportDir(connId), "demo.proto")); err != nil {
		t.Errorf("Expected the previous files to stay on disk, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(app.protoImportDir(connId), "sub")); !os.IsNotExist(err) {
		t.Errorf("Expected none of the broken files on disk, got %v", err)
	}
	if left := stagingLeftovers(t, app); len(left) != 0 {
		t.Errorf("Expected the staging dir to be cleaned up, got %v", left)
	}
}

// A failed first import changes nothing at all.
func TestImportProtoDirCompileFailureOnFirstImportChangesNothing(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	if _, err := app.ImportProtoDir(connId, testProtosOneBadDir); err == nil {
		t.Fatal("Expected the broken import to fail")
	}

	state, err := app.GetProtoState(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if state.HasImport || state.SourceDir != "" || state.LoadError != "" || state.Dir != "" {
		t.Errorf("Expected an untouched state, got %+v", state)
	}
	if left := stagingLeftovers(t, app); len(left) != 0 {
		t.Errorf("Expected the staging dir to be cleaned up, got %v", left)
	}
}

// An import dir that's already broken on disk (found at startup) still
// reports its compile error through the lazy load.
func TestLoadProtoRegistryReportsBrokenDirOnDisk(t *testing.T) {
	app, connId := getTestAppWithConnection(t)
	dir := app.protoImportDir(connId)
	if err := os.MkdirAll(dir, 0770); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "broken.proto"), []byte(brokenProto), 0660); err != nil {
		t.Fatalf("writing broken proto: %v", err)
	}

	state, err := app.LoadProtoRegistry(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if !strings.HasPrefix(state.LoadError, "broken.proto:") {
		t.Errorf("Expected the compile error as the load error, got %q", state.LoadError)
	}
}

func TestValidateProtoUploadName(t *testing.T) {
	deep := strings.Repeat("d/", maxProtoImportDepth)
	valid := []string{
		"a.proto",
		"v1..2.proto",
		"common/types.proto",
		"my types.proto",
		deep + "ok.proto",
	}
	for _, name := range valid {
		if err := validateProtoUploadName(name); err != nil {
			t.Errorf("validateProtoUploadName(%q) = %v, want nil", name, err)
		}
	}

	invalid := []string{
		"",
		".proto",
		"a/.proto",
		"../evil.proto",
		"a/../evil.proto",
		"./a.proto",
		"a//b.proto",
		" a.proto",
		"dir /a.proto",
		" dir/a.proto",
		"C:/evil.proto",
		"c:evil.proto",
		"a:b.proto",
		"sub\\evil.proto",
		"/abs.proto",
		"a.txt",
		"nul\x00.proto",
		deep + "d/too-deep.proto",
	}
	for _, name := range invalid {
		if err := validateProtoUploadName(name); err == nil {
			t.Errorf("validateProtoUploadName(%q) = nil, want error", name)
		}
	}
}

func TestImportProtoFilesEnforcesLimits(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	tooMany := make([]ProtoUploadFile, maxProtoImportFiles+1)
	for i := range tooMany {
		tooMany[i] = ProtoUploadFile{Name: fmt.Sprintf("f%d.proto", i)}
	}
	if _, err := app.ImportProtoFiles(connId, tooMany); err == nil || !strings.Contains(err.Error(), "too many") {
		t.Errorf("Expected a too-many-files error, got %v", err)
	}

	big := strings.Repeat("/", maxProtoImportFileBytes+1)
	if _, err := app.ImportProtoFiles(connId, []ProtoUploadFile{{Name: "big.proto", Content: big}}); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Errorf("Expected a per-file size error, got %v", err)
	}

	chunk := strings.Repeat("/", maxProtoImportFileBytes)
	total := []ProtoUploadFile{}
	for i := 0; i*maxProtoImportFileBytes <= maxProtoImportTotalBytes; i++ {
		total = append(total, ProtoUploadFile{Name: fmt.Sprintf("f%d.proto", i), Content: chunk})
	}
	if _, err := app.ImportProtoFiles(connId, total); err == nil || !strings.Contains(err.Error(), "in total") {
		t.Errorf("Expected a total size error, got %v", err)
	}

	if _, err := os.Stat(app.protoImportDir(connId)); !os.IsNotExist(err) {
		t.Errorf("Expected nothing imported, got %v", err)
	}
}

// A folder import never follows a symlink, to a file or to a folder.
func TestImportProtoDirSkipsSymlinks(t *testing.T) {
	app, connId := getTestAppWithConnection(t)
	src := copyDirForTest(t, testProtosGoodDir)

	outside := t.TempDir()
	leaked := "syntax = \"proto3\";\n\npackage leaked;\n\nmessage Secret {\n  string value = 1;\n}\n"
	if err := os.WriteFile(filepath.Join(outside, "secret.proto"), []byte(leaked), 0660); err != nil {
		t.Fatalf("writing outside proto: %v", err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret.proto"), filepath.Join(src, "link.proto")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(src, "linked")); err != nil {
		t.Fatalf("symlinking dir: %v", err)
	}

	state, err := app.ImportProtoDir(connId, src)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if hasDescriptor(state, "leaked.Secret") {
		t.Errorf("Expected symlinked files to be skipped, got %v", state.DescriptorNames)
	}
	if !hasDescriptor(state, "demo.SensorPayload") {
		t.Errorf("Expected the regular files to import, got %v", state.DescriptorNames)
	}
	if _, err := os.Lstat(filepath.Join(app.protoImportDir(connId), "link.proto")); !os.IsNotExist(err) {
		t.Errorf("Expected no copy of the symlinked file, got %v", err)
	}
}

func TestImportProtoDirEnforcesLimits(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	bigDir := copyDirForTest(t, testProtosGoodDir)
	if err := os.WriteFile(filepath.Join(bigDir, "big.proto"), []byte(strings.Repeat("/", maxProtoImportFileBytes+1)), 0660); err != nil {
		t.Fatalf("writing big proto: %v", err)
	}
	if _, err := app.ImportProtoDir(connId, bigDir); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Errorf("Expected a per-file size error, got %v", err)
	}

	deepDir := t.TempDir()
	nested := filepath.Join(deepDir, filepath.FromSlash(strings.Repeat("d/", maxProtoImportDepth+1)))
	if err := os.MkdirAll(nested, 0770); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(nested, "deep.proto"), []byte("syntax = \"proto3\";\n"), 0660); err != nil {
		t.Fatalf("writing deep proto: %v", err)
	}
	if _, err := app.ImportProtoDir(connId, deepDir); err == nil || !strings.Contains(err.Error(), "nested") {
		t.Errorf("Expected a depth error, got %v", err)
	}

	if _, err := os.Stat(app.protoImportDir(connId)); !os.IsNotExist(err) {
		t.Errorf("Expected nothing imported, got %v", err)
	}
}

// Deleting a connection removes the aside and staging dirs an interrupted
// swap left behind, but never another connection's.
func TestDeleteConnectionRemovesProtoImportSiblings(t *testing.T) {
	app, connId := getTestAppWithConnection(t)
	if _, err := app.ImportProtoDir(connId, testProtosGoodDir); err != nil {
		t.Fatalf("importing: %v", err)
	}
	importDir := app.protoImportDir(connId)
	parent := filepath.Dir(importDir)
	mine := []string{
		importDir + ".previous",
		filepath.Join(parent, fmt.Sprintf(".staging-%d-123", connId)),
	}
	other := filepath.Join(parent, fmt.Sprintf(".staging-%d1-123", connId))
	for _, dir := range append(mine, other) {
		if err := os.MkdirAll(dir, 0770); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}

	if err := app.DeleteConnection(connId); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	for _, dir := range append(mine, importDir) {
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			t.Errorf("Expected %v to be removed, got %v", dir, err)
		}
	}
	if _, err := os.Stat(other); err != nil {
		t.Errorf("Expected another connection's staging dir to survive, got %v", err)
	}
}

// DeleteConnection waits for an import in flight (the import lock) before
// removing the import dir.
func TestDeleteConnectionWaitsForImportLock(t *testing.T) {
	app, connId := getTestAppWithConnection(t)
	if _, err := app.ImportProtoDir(connId, testProtosGoodDir); err != nil {
		t.Fatalf("importing: %v", err)
	}
	importDir := app.protoImportDir(connId)
	protoState := mustAppConnection(t, app, connId).ProtoState

	protoState.LockImport()
	done := make(chan error, 1)
	go func() { done <- app.DeleteConnection(connId) }()

	time.Sleep(200 * time.Millisecond)
	_, statErr := os.Stat(importDir)
	protoState.UnlockImport()
	if statErr != nil {
		t.Errorf("Expected the import dir to survive while the import lock is held, got %v", statErr)
	}
	if err := <-done; err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if _, err := os.Stat(importDir); !os.IsNotExist(err) {
		t.Errorf("Expected the import dir to be removed, got %v", err)
	}
	if _, err := app.ImportProtoDir(connId, testProtosGoodDir); err == nil {
		t.Error("Expected an import after delete to fail")
	}
	if _, err := os.Stat(importDir); !os.IsNotExist(err) {
		t.Errorf("Expected no import dir recreated after delete, got %v", err)
	}
}

// versionedProto is a file set whose messages are named per version, so a
// stale registry is visible by name. size sets the message count, which
// sets how long a compile takes.
func versionedProto(version, size int) []ProtoUploadFile {
	var b strings.Builder
	fmt.Fprintf(&b, "syntax = \"proto3\";\n\npackage v%d;\n\n", version)
	for i := 0; i < size; i++ {
		fmt.Fprintf(&b, "message M%d {\n  string a = 1;\n  int64 b = 2;\n  repeated double c = 3;\n}\n\n", i)
	}
	return []ProtoUploadFile{{Name: "versioned.proto", Content: b.String()}}
}

// Hammers the lazy load (LoadProtoRegistry, and ConnectMqtt through the
// same helper) against imports. Each round starts from a large import on
// disk and nothing compiled, then races the lazy load against a small
// import. Without the import lock the lazy load reads the large files, the
// small import finishes first, and the slow compile lands last, leaving
// stale types live while disk holds new ones. Probabilistic in principle,
// but the compile-time gap makes it fail on nearly every round without
// the lock.
func TestLazyProtoLoadDoesNotRaceImports(t *testing.T) {
	app, connId := getTestAppWithConnection(t)
	protoState := mustAppConnection(t, app, connId).ProtoState

	for round := 1; round <= 10; round++ {
		if _, err := app.ImportProtoFiles(connId, versionedProto(0, 3000)); err != nil {
			t.Fatalf("importing: %v", err)
		}
		// As after a restart: nothing compiled yet, so the lazy load runs.
		protoState.Clear()
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			if _, err := app.LoadProtoRegistry(connId); err != nil {
				t.Errorf("loading: %v", err)
			}
		}()
		go func() {
			defer wg.Done()
			// Let the lazy load start reading first.
			time.Sleep(2 * time.Millisecond)
			if _, err := app.ImportProtoFiles(connId, versionedProto(round, 1)); err != nil {
				t.Errorf("importing: %v", err)
			}
		}()
		wg.Wait()

		want := fmt.Sprintf("v%d.M0", round)
		if _, ok := protoState.RuleDescriptor(want); !ok {
			t.Fatalf("round %d: expected the live registry to hold %s from disk, it holds a stale import", round, want)
		}
	}
}

// Hammers concurrent rule writes end to end: every rule the DB holds must be
// live afterwards. The window this guards is narrow, so this alone rarely
// fails without the fix; TestReloadRulesSerialisesReadThenSet pins the
// ordering deterministically.
func TestConcurrentProtoRuleWritesKeepMatcherInSync(t *testing.T) {
	app, connId := getTestAppWithConnection(t)
	protoState := mustAppConnection(t, app, connId).ProtoState

	const writers = 40
	var wg sync.WaitGroup
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			rule := models.ProtoBindingRule{TopicFilter: fmt.Sprintf("hammer/%d", i), MessageType: "test.HelloMessage"}
			if _, err := app.AddProtoBindingRule(connId, rule); err != nil {
				t.Errorf("adding rule %d: %v", i, err)
			}
		}(i)
	}
	wg.Wait()

	for i := 0; i < writers; i++ {
		topic := fmt.Sprintf("hammer/%d", i)
		if got := protoState.MatchUncached(topic); got.Filter != topic {
			t.Errorf("Expected the live matcher to hold the rule for %s, got %+v", topic, got)
		}
	}
}

// A rule reload that read the DB first must not land its (older) rules
// after a reload that started later: ReloadRules holds its lock across the
// read and the set.
func TestReloadRulesSerialisesReadThenSet(t *testing.T) {
	state := newProtoState(true, nil)
	older := []models.ProtoBindingRule{{ID: 1, TopicFilter: "a", MessageType: "T"}}
	newer := append(older, models.ProtoBindingRule{ID: 2, TopicFilter: "b", MessageType: "T"})

	firstReading := make(chan struct{})
	releaseFirst := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_ = state.ReloadRules(func() ([]models.ProtoBindingRule, error) {
			close(firstReading)
			<-releaseFirst
			return older, nil
		})
	}()
	<-firstReading
	go func() {
		defer wg.Done()
		_ = state.ReloadRules(func() ([]models.ProtoBindingRule, error) { return newer, nil })
	}()
	// Give an unserialised second reload time to finish first.
	time.Sleep(100 * time.Millisecond)
	close(releaseFirst)
	wg.Wait()

	if got := state.MatchUncached("b"); got.Filter != "b" {
		t.Errorf("Expected the later read to land last, got %+v", got)
	}
}
