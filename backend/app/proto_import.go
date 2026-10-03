package app

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mqtt-viewer/backend/models"
	"os"
	"path/filepath"
	"strings"
)

// protoImportsDirName is the folder under the app's resource dir that holds
// every connection's imported proto files, one subdirectory per connection
// id.
const protoImportsDirName = "proto-imports"

// Import limits. Uploads arrive over HTTP in the Docker web UI, so every
// import (folder or upload) is bounded before anything is written.
const (
	maxProtoImportFiles      = 2000
	maxProtoImportFileBytes  = 4 << 20
	maxProtoImportTotalBytes = 32 << 20
	// maxProtoImportDepth is how many folders deep a file may sit.
	maxProtoImportDepth = 16
	// Common filesystem limits: a name (one path segment) of at most 255
	// bytes, a whole relative path well inside PATH_MAX once the data-dir
	// prefix is added.
	maxProtoImportSegmentBytes = 255
	maxProtoImportNameBytes    = 1024
)

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

// protoImportStagingPattern names a connection's staging dirs (an
// os.MkdirTemp pattern) so DeleteConnection can find leftovers without
// touching another connection's import in flight.
func protoImportStagingPattern(connId uint) string {
	return fmt.Sprintf(".staging-%d-*", connId)
}

// ImportProtoDir copies every .proto file found under sourceDir (recursively,
// preserving relative paths) into the connection's internal proto-imports
// directory, compiles it, and swaps the result into the live protoState.
// sourceDir is persisted onto Connection.ProtoRegDir for display and as the
// source ReimportProto re-reads from; it is not itself compiled from again.
// Symlinks and other non-regular files are skipped, never followed. A
// compile failure changes nothing (see importProtoFiles).
func (a *App) ImportProtoDir(connId uint, sourceDir string) (*ProtoStateResult, error) {
	appConnection, unlock, err := a.lockProtoImport(connId)
	if err != nil {
		return nil, err
	}
	defer unlock()

	info, err := os.Stat(sourceDir)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("folder not found")
	}

	files, err := collectProtoDirFiles(sourceDir)
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("no .proto files in that folder")
	}

	return a.importProtoFiles(connId, appConnection, files, &sourceDir)
}

// collectProtoDirFiles reads every regular .proto file under sourceDir,
// within the import limits. The root itself may be a symlink (the user
// picked it); anything below that is a symlink or not a regular file is
// skipped. So is anything unrelated to the protos that would otherwise fail
// the import: hidden files and folders (.git, macOS ._x.proto AppleDouble
// files), folders that can't be read, and folders more than
// maxProtoImportDepth deep. Errors name files by their relative path, never
// the absolute one.
func collectProtoDirFiles(sourceDir string) ([]ProtoUploadFile, error) {
	root, err := filepath.EvalSymlinks(sourceDir)
	if err != nil {
		return nil, fmt.Errorf("folder not found")
	}

	files := []ProtoUploadFile{}
	total := 0
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return fmt.Errorf("folder not found")
		}
		if rel == "." {
			if walkErr != nil {
				return fmt.Errorf("folder can't be read")
			}
			return nil
		}
		if strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if walkErr != nil || len(strings.Split(filepath.ToSlash(rel), "/")) > maxProtoImportDepth {
				return fs.SkipDir
			}
			return nil
		}
		if walkErr != nil {
			return nil
		}
		if !d.Type().IsRegular() || filepath.Ext(d.Name()) != ".proto" {
			return nil
		}
		name := filepath.ToSlash(rel)
		if err := validateProtoUploadName(name); err != nil {
			return err
		}
		if len(files) >= maxProtoImportFiles {
			return fmt.Errorf("too many .proto files (the limit is %d)", maxProtoImportFiles)
		}
		content, err := readProtoFileWithinLimit(path, name)
		if err != nil {
			return err
		}
		total += len(content)
		if total > maxProtoImportTotalBytes {
			return fmt.Errorf("the .proto files are too large in total (the limit is %d MiB)", maxProtoImportTotalBytes>>20)
		}
		files = append(files, ProtoUploadFile{Name: name, Content: string(content)})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return files, nil
}

// readProtoFileWithinLimit reads at most one byte past the per-file limit,
// so a file that grows after the walk saw it still can't blow the budget.
func readProtoFileWithinLimit(path, name string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("%s can't be read: %w", name, withoutPath(err))
	}
	defer f.Close()
	content, err := io.ReadAll(io.LimitReader(f, maxProtoImportFileBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%s can't be read: %w", name, withoutPath(err))
	}
	if len(content) > maxProtoImportFileBytes {
		return nil, fmt.Errorf("%s is too large (the limit is %d MiB per file)", name, maxProtoImportFileBytes>>20)
	}
	return content, nil
}

// ImportProtoFiles writes an in-memory set of uploaded .proto files into the
// connection's internal proto-imports directory (the path the Docker/web
// build uses, where a native folder dialog is a no-op), then compiles and
// swaps them in the same way as ImportProtoDir. Uploads have no source
// folder to remember, so ProtoRegDir is cleared.
func (a *App) ImportProtoFiles(connId uint, files []ProtoUploadFile) (*ProtoStateResult, error) {
	if _, ok := a.appConnection(connId); !ok {
		return nil, fmt.Errorf("connection not found (%d)", connId)
	}
	if err := validateProtoUploadFiles(files); err != nil {
		return nil, err
	}

	// See ImportProtoDir: serialises against any other import/remove in
	// flight for this connection.
	appConnection, unlock, err := a.lockProtoImport(connId)
	if err != nil {
		return nil, err
	}
	defer unlock()

	return a.importProtoFiles(connId, appConnection, files, nil)
}

// validateProtoUploadFiles checks every name and the import limits before
// anything touches the disk.
func validateProtoUploadFiles(files []ProtoUploadFile) error {
	if len(files) == 0 {
		return fmt.Errorf("no files to import")
	}
	if len(files) > maxProtoImportFiles {
		return fmt.Errorf("too many .proto files (the limit is %d)", maxProtoImportFiles)
	}
	total := 0
	// Keyed case-insensitively: on a case-insensitive filesystem (macOS,
	// Windows) "A.proto" and "a.proto" are one file and the second write
	// would silently replace the first.
	seen := make(map[string]bool, len(files))
	for _, f := range files {
		if err := validateProtoUploadName(f.Name); err != nil {
			return err
		}
		key := strings.ToLower(f.Name)
		if seen[key] {
			return fmt.Errorf("%s is in the upload twice (names that differ only by case count as the same file)", f.Name)
		}
		seen[key] = true
		if len(f.Content) > maxProtoImportFileBytes {
			return fmt.Errorf("%s is too large (the limit is %d MiB per file)", f.Name, maxProtoImportFileBytes>>20)
		}
		total += len(f.Content)
		if total > maxProtoImportTotalBytes {
			return fmt.Errorf("the .proto files are too large in total (the limit is %d MiB)", maxProtoImportTotalBytes>>20)
		}
	}
	return nil
}

// validateProtoUploadName guards an import against a name that would escape
// the internal import directory (absolute paths, "." or ".." segments,
// backslashes, drive letters or any colon, which forward-slash-relative
// names never legitimately need), that a filesystem would mangle (empty or
// whitespace-padded segments, or segments or whole names too long to
// create), that nests too deep, or that isn't a .proto file. ".." is only
// rejected as a whole segment: "v1..2.proto" is legal.
func validateProtoUploadName(name string) error {
	if len(name) > maxProtoImportNameBytes {
		return fmt.Errorf("invalid file name: %q (longer than %d bytes)", name[:64]+"...", maxProtoImportNameBytes)
	}
	if name == "" || filepath.IsAbs(name) || strings.HasPrefix(name, "/") {
		return fmt.Errorf("invalid file name: %q", name)
	}
	if strings.ContainsAny(name, "\\:\x00") {
		return fmt.Errorf("invalid file name: %q", name)
	}
	segments := strings.Split(name, "/")
	for _, seg := range segments {
		if seg == "" || seg == "." || seg == ".." || strings.TrimSpace(seg) != seg {
			return fmt.Errorf("invalid file name: %q", name)
		}
		if len(seg) > maxProtoImportSegmentBytes {
			return fmt.Errorf("invalid file name: %q (a folder or file name is longer than %d bytes)", name, maxProtoImportSegmentBytes)
		}
	}
	if len(segments)-1 > maxProtoImportDepth {
		return fmt.Errorf("invalid file name: %q (nested more than %d folders deep)", name, maxProtoImportDepth)
	}
	base := segments[len(segments)-1]
	if !strings.HasSuffix(base, ".proto") || base == ".proto" {
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
	// See ImportProtoDir: serialises against any other import/remove in
	// flight for this connection.
	appConnection, unlock, err := a.lockProtoImport(connId)
	if err != nil {
		return nil, err
	}
	defer unlock()

	if err := os.RemoveAll(a.protoImportDir(connId)); err != nil {
		return nil, fmt.Errorf("couldn't remove the imported files: %w", withoutPath(err))
	}
	if err := a.setProtoRegDir(connId, nil); err != nil {
		return nil, err
	}
	a.refreshProtoImportStateLocked(connId, appConnection)
	return a.buildProtoStateResult(connId, appConnection)
}

// lockProtoImport takes the connection's import lock (protoState.importMu)
// and re-checks the connection still exists once it has it: a delete that
// held the lock first has already removed the import dir, and an import
// queued behind it must not recreate one.
func (a *App) lockProtoImport(connId uint) (*AppConnection, func(), error) {
	appConnection, ok := a.appConnection(connId)
	if !ok {
		return nil, nil, fmt.Errorf("connection not found (%d)", connId)
	}
	appConnection.ProtoState.LockImport()
	if current, ok := a.appConnection(connId); !ok || current != appConnection {
		appConnection.ProtoState.UnlockImport()
		return nil, nil, fmt.Errorf("connection not found (%d)", connId)
	}
	return appConnection, appConnection.ProtoState.UnlockImport, nil
}

// importProtoFiles stages files, compiles the staged copy and, only if that
// compiles, swaps it in for the live import, records sourceDir (nil clears
// it) and installs the registry. A compile failure returns the compile error
// (paths relative to the import root) and leaves the previous on-disk
// import, the live registry and proto_reg_dir untouched; on a first import
// nothing is created. The caller holds the import lock.
func (a *App) importProtoFiles(connId uint, appConnection *AppConnection, files []ProtoUploadFile, sourceDir *string) (*ProtoStateResult, error) {
	stagingDir, err := a.stageProtoImportFiles(connId, files)
	if err != nil {
		return nil, err
	}
	// No-op once the swap succeeds (the path no longer exists); cleans up
	// the staging dir on a compile failure or any other error.
	defer os.RemoveAll(stagingDir)

	registry, loadErr, _ := compileProtoRegistry(stagingDir)
	if loadErr != "" {
		return nil, errors.New(loadErr)
	}

	if err := a.swapInStagedProtoImport(connId, stagingDir); err != nil {
		return nil, fmt.Errorf("couldn't save the imported files: %w", withoutPath(err))
	}
	dir := a.protoImportDir(connId)
	registry.Dir = dir
	appConnection.ProtoState.SetRegistry(registry, dir, "", false)
	setErr := a.setProtoRegDir(connId, sourceDir)
	a.emitProtoStateChanged(connId)
	if setErr != nil {
		return nil, setErr
	}
	return a.buildProtoStateResult(connId, appConnection)
}

// stageProtoImportFiles writes files into a fresh staging directory under
// the same parent as the connection's internal proto-imports directory
// (deliberately not the OS temp dir, which can be a different filesystem —
// os.Rename across filesystems fails with EXDEV, notably inside a Flatpak
// sandbox). The caller removes it.
func (a *App) stageProtoImportFiles(connId uint, files []ProtoUploadFile) (string, error) {
	parent := filepath.Join(a.Paths.ResourcePath, protoImportsDirName)
	if err := os.MkdirAll(parent, 0770); err != nil {
		return "", fmt.Errorf("couldn't create the import folder: %w", withoutPath(err))
	}

	stagingDir, err := os.MkdirTemp(parent, protoImportStagingPattern(connId))
	if err != nil {
		return "", fmt.Errorf("couldn't create the import folder: %w", withoutPath(err))
	}

	for _, f := range files {
		dest := filepath.Join(stagingDir, filepath.FromSlash(f.Name))
		if err := os.MkdirAll(filepath.Dir(dest), 0770); err != nil {
			os.RemoveAll(stagingDir)
			return "", fmt.Errorf("%s can't be written: %w", f.Name, withoutPath(err))
		}
		if err := os.WriteFile(dest, []byte(f.Content), 0660); err != nil {
			os.RemoveAll(stagingDir)
			return "", fmt.Errorf("%s can't be written: %w", f.Name, withoutPath(err))
		}
	}
	return stagingDir, nil
}

// swapInStagedProtoImport swaps a staged directory in for the connection's
// live import, so a failure partway through swapping leaves whatever was
// previously imported untouched.
func (a *App) swapInStagedProtoImport(connId uint, stagingDir string) error {
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

// recoverInterruptedProtoImportSwapLocked repairs what a process death
// partway through swapInStagedProtoImport leaves on disk. The swap is two
// renames (live dir to .previous, staging to live), so a crash between them
// leaves .previous and a staging dir but no live dir: .previous is renamed
// back so the old import isn't silently lost. With both present the swap had
// finished and .previous is just stale. Staging dirs are never in use outside
// the import lock, which the caller holds, so any found are leftovers.
func (a *App) recoverInterruptedProtoImportSwapLocked(connId uint) {
	dir := a.protoImportDir(connId)
	asideDir := dir + ".previous"
	if _, err := os.Stat(asideDir); err == nil {
		if _, err := os.Stat(dir); errors.Is(err, fs.ErrNotExist) {
			if err := os.Rename(asideDir, dir); err != nil {
				slog.Error("failed to restore interrupted proto import", "connectionId", connId, "error", err)
			}
		} else if err == nil {
			if err := os.RemoveAll(asideDir); err != nil {
				slog.Error("failed to remove stale proto import dir", "connectionId", connId, "path", asideDir, "error", err)
			}
		}
	}
	staging, _ := filepath.Glob(filepath.Join(filepath.Dir(dir), protoImportStagingPattern(connId)))
	for _, path := range staging {
		if err := os.RemoveAll(path); err != nil {
			slog.Error("failed to remove stale proto import staging dir", "connectionId", connId, "path", path, "error", err)
		}
	}
}

// removeProtoImportDirs deletes a connection's import dir plus any aside or
// staging dirs an interrupted swap left next to it. The caller holds the
// import lock, so no staging dir of this connection is in use.
func (a *App) removeProtoImportDirs(connId uint) {
	dir := a.protoImportDir(connId)
	paths := []string{dir, dir + ".previous"}
	staging, _ := filepath.Glob(filepath.Join(filepath.Dir(dir), protoImportStagingPattern(connId)))
	paths = append(paths, staging...)
	for _, path := range paths {
		if err := os.RemoveAll(path); err != nil {
			slog.Error("failed to remove proto import dir", "connectionId", connId, "path", path, "error", err)
		}
	}
}

// setProtoRegDir writes Connection.ProtoRegDir directly (rather than going
// through UpdateConnection, which no longer manages this column at all): dir
// nil clears it.
func (a *App) setProtoRegDir(connId uint, dir *string) error {
	return a.Db.Model(&models.Connection{}).Where("id = ?", connId).Update("proto_reg_dir", dir).Error
}

// refreshProtoImportStateLocked (re)compiles the connection's internal proto
// import dir and swaps the result into its live protoState, emitting
// ProtoStateChanged. When nothing has been imported (the internal dir simply
// doesn't exist), protoState is cleared rather than reporting an error. An
// already-broken dir (found at startup, say) records its compile error as
// protoState's load error. The caller holds the import lock.
func (a *App) refreshProtoImportStateLocked(connId uint, appConnection *AppConnection) {
	dir := a.protoImportDir(connId)
	if _, err := os.Stat(dir); err != nil {
		appConnection.ProtoState.Clear()
	} else {
		registry, loadErr, dirMissing := compileProtoRegistry(dir)
		appConnection.ProtoState.SetRegistry(registry, dir, loadErr, dirMissing)
	}
	a.emitProtoStateChanged(connId)
}

// withoutPath strips the absolute path an *fs.PathError or *os.LinkError
// carries, leaving only its cause (permission denied, file name too long),
// so an import error never shows the data-dir path. Callers name the file by
// its relative path themselves.
func withoutPath(err error) error {
	var pathErr *fs.PathError
	if errors.As(err, &pathErr) {
		return pathErr.Err
	}
	var linkErr *os.LinkError
	if errors.As(err, &linkErr) {
		return linkErr.Err
	}
	return err
}
