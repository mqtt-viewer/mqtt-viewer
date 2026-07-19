package app

import (
	"fmt"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/util"
	"os"
	"path/filepath"
	"strings"
)

// protoImportsDirName is the folder under the app's resource dir that holds
// every connection's imported proto files, one subdirectory per connection
// id.
const protoImportsDirName = "proto-imports"

// ProtoUploadFile is a single .proto file uploaded from the browser (the web
// build has no native folder picker, so files are read client-side and sent
// as name+content pairs). Name may carry forward-slash relative subpaths
// (e.g. "common/types.proto") to preserve import-relative layouts.
type ProtoUploadFile struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

// protoImportDir is the internal directory a connection's imported .proto
// files are copied into: <ResourcePath>/proto-imports/<connId>/. Compiling
// always reads from here; the folder or files the user originally picked are
// never read from again after the copy.
func (a *App) protoImportDir(connId uint) string {
	return filepath.Join(a.Paths.ResourcePath, protoImportsDirName, fmt.Sprint(connId))
}

// ImportProtoDir copies every .proto file found under sourceDir (recursively,
// preserving relative paths) into the connection's internal proto-imports
// directory, compiles that internal copy, and swaps the result into the live
// protoState. sourceDir is persisted onto Connection.ProtoRegDir for display
// and as the source ReimportProto re-reads from; it is not itself compiled
// from again.
func (a *App) ImportProtoDir(connId uint, sourceDir string) (*ProtoStateResult, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return nil, fmt.Errorf("connection not found (%d)", connId)
	}
	// Serialises against any other import/remove in flight for this
	// connection (see protoState.importMu) so a concurrent call from a
	// second window can't interleave the directory swap below.
	appConnection.ProtoState.LockImport()
	defer appConnection.ProtoState.UnlockImport()

	info, err := os.Stat(sourceDir)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("folder not found")
	}

	protoFilePaths := util.FindAllNestedFilesWithExtension(sourceDir, ".proto")
	if len(protoFilePaths) == 0 {
		return nil, fmt.Errorf("no .proto files in that folder")
	}

	files := make([]ProtoUploadFile, 0, len(protoFilePaths))
	for _, filePath := range protoFilePaths {
		rel, err := filepath.Rel(sourceDir, filePath)
		if err != nil {
			return nil, err
		}
		content, err := os.ReadFile(filePath)
		if err != nil {
			return nil, err
		}
		files = append(files, ProtoUploadFile{Name: filepath.ToSlash(rel), Content: string(content)})
	}

	if err := a.swapInProtoImportFiles(connId, files); err != nil {
		return nil, err
	}
	if err := a.setProtoRegDir(connId, &sourceDir); err != nil {
		return nil, err
	}

	return a.refreshProtoImportState(connId)
}

// ImportProtoFiles writes an in-memory set of uploaded .proto files into the
// connection's internal proto-imports directory (the path the Docker/web
// build uses, where a native folder dialog is a no-op), then compiles and
// swaps them in the same way as ImportProtoDir. Uploads have no source
// folder to remember, so ProtoRegDir is cleared.
func (a *App) ImportProtoFiles(connId uint, files []ProtoUploadFile) (*ProtoStateResult, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return nil, fmt.Errorf("connection not found (%d)", connId)
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("no files to import")
	}
	for _, f := range files {
		if err := validateProtoUploadName(f.Name); err != nil {
			return nil, err
		}
	}

	// See ImportProtoDir: serialises against any other import/remove in
	// flight for this connection.
	appConnection.ProtoState.LockImport()
	defer appConnection.ProtoState.UnlockImport()

	if err := a.swapInProtoImportFiles(connId, files); err != nil {
		return nil, err
	}
	if err := a.setProtoRegDir(connId, nil); err != nil {
		return nil, err
	}

	return a.refreshProtoImportState(connId)
}

// validateProtoUploadName guards ImportProtoFiles against a name that would
// escape the internal import directory (absolute paths, ".." segments,
// backslashes, which forward-slash-relative names never legitimately need)
// or that isn't a .proto file. Forward-slash relative subpaths are allowed so
// a folder-shaped upload can preserve its import-relative layout.
func validateProtoUploadName(name string) error {
	if name == "" || filepath.IsAbs(name) || strings.HasPrefix(name, "/") {
		return fmt.Errorf("invalid file name: %q", name)
	}
	if strings.Contains(name, "..") {
		return fmt.Errorf("invalid file name: %q", name)
	}
	if strings.Contains(name, "\\") {
		return fmt.Errorf("invalid file name: %q", name)
	}
	if !strings.HasSuffix(name, ".proto") {
		return fmt.Errorf("invalid file name: %q (must end in .proto)", name)
	}
	return nil
}

// ReimportProto re-runs ImportProtoDir against the connection's last recorded
// import source, picking up any edits made to the files on disk since the
// last import.
func (a *App) ReimportProto(connId uint) (*ProtoStateResult, error) {
	connection := models.Connection{}
	if res := a.Db.First(&connection, connId); res.Error != nil {
		return nil, res.Error
	}
	if connection.ProtoRegDir == nil || *connection.ProtoRegDir == "" {
		return nil, fmt.Errorf("no source folder recorded")
	}
	sourceDir := *connection.ProtoRegDir
	if info, err := os.Stat(sourceDir); err != nil || !info.IsDir() {
		return nil, fmt.Errorf("source folder not found")
	}
	return a.ImportProtoDir(connId, sourceDir)
}

// ClearProtoImport removes the connection's internal proto-imports directory
// and forgets the recorded source, leaving any binding rules in place: they
// simply show as stale once their message types are gone from the registry.
func (a *App) ClearProtoImport(connId uint) (*ProtoStateResult, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return nil, fmt.Errorf("connection not found (%d)", connId)
	}
	// See ImportProtoDir: serialises against any other import/remove in
	// flight for this connection.
	appConnection.ProtoState.LockImport()
	defer appConnection.ProtoState.UnlockImport()

	if err := os.RemoveAll(a.protoImportDir(connId)); err != nil {
		return nil, err
	}
	if err := a.setProtoRegDir(connId, nil); err != nil {
		return nil, err
	}
	return a.refreshProtoImportState(connId)
}

// swapInProtoImportFiles stages files in a fresh temp directory under the
// same parent as the connection's internal proto-imports directory
// (deliberately not the OS temp dir, which can be a different filesystem —
// os.Rename across filesystems fails with EXDEV, notably inside a Flatpak
// sandbox) and only then swaps it in for the live directory, so a failure
// partway through writing or swapping leaves whatever was previously
// imported untouched.
func (a *App) swapInProtoImportFiles(connId uint, files []ProtoUploadFile) error {
	parent := filepath.Join(a.Paths.ResourcePath, protoImportsDirName)
	if err := os.MkdirAll(parent, 0770); err != nil {
		return err
	}

	stagingDir, err := os.MkdirTemp(parent, ".staging-*")
	if err != nil {
		return err
	}
	// No-op once the rename below succeeds (the path no longer exists);
	// cleans up the staging dir on any earlier error.
	defer os.RemoveAll(stagingDir)

	for _, f := range files {
		dest := filepath.Join(stagingDir, filepath.FromSlash(f.Name))
		if err := os.MkdirAll(filepath.Dir(dest), 0770); err != nil {
			return err
		}
		if err := os.WriteFile(dest, []byte(f.Content), 0660); err != nil {
			return err
		}
	}

	dest := a.protoImportDir(connId)
	asideDir := dest + ".previous"

	// Best-effort: clean up any stale aside directory left behind by an
	// earlier swap that never got to its own cleanup (e.g. the app crashed
	// mid-swap), so this attempt isn't permanently blocked by it. Never
	// touches dest.
	_ = os.RemoveAll(asideDir)

	hadPrevious := false
	if _, err := os.Stat(dest); err == nil {
		// Move the existing import aside rather than deleting it outright,
		// so a failure on the next rename can restore it instead of leaving
		// the connection with nothing imported.
		if err := os.Rename(dest, asideDir); err != nil {
			return err
		}
		hadPrevious = true
	}

	if err := os.Rename(stagingDir, dest); err != nil {
		if hadPrevious {
			// Best-effort restore; if this also fails the connection is left
			// pointing at neither dest nor asideDir, which the caller's next
			// compile attempt will surface as "folder not found" rather than
			// silently serving stale state.
			_ = os.Rename(asideDir, dest)
		}
		return err
	}

	if hadPrevious {
		os.RemoveAll(asideDir)
	}
	return nil
}

// setProtoRegDir writes Connection.ProtoRegDir directly (rather than going
// through UpdateConnection, which no longer manages this column at all): dir
// nil clears it.
func (a *App) setProtoRegDir(connId uint, dir *string) error {
	return a.Db.Model(&models.Connection{}).Where("id = ?", connId).Update("proto_reg_dir", dir).Error
}

// refreshProtoImportState (re)compiles the connection's internal proto import
// dir and swaps the result into its live protoState, emitting
// ProtoStateChanged. When nothing has been imported (the internal dir simply
// doesn't exist), protoState is cleared rather than reporting an error;
// compileProtoRegistry's own missing-dir check only fires here for a dir that
// existed a moment ago and vanished before the compile ran.
func (a *App) refreshProtoImportState(connId uint) (*ProtoStateResult, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return nil, fmt.Errorf("connection not found (%d)", connId)
	}

	dir := a.protoImportDir(connId)
	if _, err := os.Stat(dir); err != nil {
		appConnection.ProtoState.Clear()
	} else {
		registry, loadErr, dirMissing := compileProtoRegistry(dir)
		appConnection.ProtoState.SetRegistry(registry, dir, loadErr, dirMissing)
	}
	a.emitProtoStateChanged(connId)

	return a.buildProtoStateResult(connId, appConnection)
}
