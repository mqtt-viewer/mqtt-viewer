package protobuf

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"mqtt-viewer/backend/util"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/bufbuild/protocompile"
	"github.com/bufbuild/protocompile/ast"
	"github.com/bufbuild/protocompile/linker"
	"github.com/bufbuild/protocompile/parser"
	"github.com/bufbuild/protocompile/reporter"
	"google.golang.org/protobuf/reflect/protoreflect"
)

type ProtoRegistry struct {
	Dir                           string
	LoadedFiles                   *linker.Files
	LoadedFileNames               []string
	LoadedFilesWithDescriptorsMap *map[string][]string
	LoadedDescriptors             *[]protoreflect.MessageDescriptor
	LoadedDescriptorsNameMap      *map[string]*protoreflect.MessageDescriptor
}

// LoadProtoRegistry compiles every .proto file under importPath, with
// importPath as the import root and the google/protobuf well-known types
// available. Files are named by their slash-separated path relative to
// importPath, so compile errors and LoadedFilesWithDescriptorsMap keys never
// carry the absolute data-dir path.
//
// An import that doesn't resolve from the root falls back to the unique file
// sharing the most trailing path segments with it (see resolveImportAliases),
// which covers a flat upload of files that import each other by subfolder
// path, a folder picked one level above or below the real proto root, and a
// nested file importing a sibling by bare name.
func LoadProtoRegistry(importPath string) (*ProtoRegistry, error) {
	absPaths := util.FindAllNestedFilesWithExtension(importPath, ".proto")

	// relPath -> file content. Every file is read once, up front, so the
	// import pre-scan and the compile see the same snapshot.
	sources := make(map[string][]byte, len(absPaths))
	relPaths := make([]string, 0, len(absPaths))
	for _, absPath := range absPaths {
		rel, err := filepath.Rel(importPath, absPath)
		if err != nil {
			return nil, fmt.Errorf("%s is outside the import folder", filepath.Base(absPath))
		}
		rel = filepath.ToSlash(rel)
		content, err := os.ReadFile(absPath)
		if err != nil {
			// Name the file by its relative path; the PathError carries the
			// absolute data-dir path.
			var pathErr *fs.PathError
			if errors.As(err, &pathErr) {
				err = pathErr.Err
			}
			return nil, fmt.Errorf("%s can't be read: %w", rel, err)
		}
		sources[rel] = content
		relPaths = append(relPaths, rel)
	}
	sort.Strings(relPaths)

	// canonical compile name -> relPath. One physical file is only ever
	// compiled under one name, else its symbols are defined twice.
	canonical, err := resolveImportAliases(relPaths, sources)
	if err != nil {
		return nil, err
	}
	relToCanonical := make(map[string]string, len(canonical))
	for name, rel := range canonical {
		relToCanonical[rel] = name
	}

	resolver := protocompile.ResolverFunc(func(name string) (protocompile.SearchResult, error) {
		rel, ok := canonical[name]
		if !ok {
			return protocompile.SearchResult{}, fs.ErrNotExist
		}
		return protocompile.SearchResult{Source: bytes.NewReader(sources[rel])}, nil
	})
	compiler := protocompile.Compiler{
		Resolver: protocompile.WithStandardImports(resolver),
	}

	compileNames := make([]string, 0, len(relPaths))
	for _, rel := range relPaths {
		compileNames = append(compileNames, relToCanonical[rel])
	}

	ctx := context.Background()

	compiledFiles, err := compiler.Compile(ctx, compileNames...)
	if err != nil {
		return nil, err
	}

	loadedDescriptors := []protoreflect.MessageDescriptor{}
	loadedFileNames := []string{}
	loadedFilesWithDescriptorsMap := map[string][]string{}
	loadedDescriptorsNameMap := map[string]*protoreflect.MessageDescriptor{}
	for _, file := range compiledFiles {
		messageDescriptors := getMessageDescriptors(&compiledFiles, file.Path())
		messageDescriptorNames := getMessageDescriptorNames(messageDescriptors)
		loadedDescriptors = append(loadedDescriptors, messageDescriptors...)
		rel := canonical[file.Path()]
		loadedFileNames = append(loadedFileNames, path.Base(rel))
		loadedFilesWithDescriptorsMap[rel] = messageDescriptorNames
	}
	for _, descriptor := range loadedDescriptors {
		desc := descriptor
		loadedDescriptorsNameMap[string(descriptor.FullName())] = &desc
	}
	registry := ProtoRegistry{
		Dir:                           importPath,
		LoadedDescriptors:             &loadedDescriptors,
		LoadedFiles:                   &compiledFiles,
		LoadedFileNames:               loadedFileNames,
		LoadedDescriptorsNameMap:      &loadedDescriptorsNameMap,
		LoadedFilesWithDescriptorsMap: &loadedFilesWithDescriptorsMap,
	}

	return &registry, nil
}

// resolveImportAliases decides the name each file is compiled under. By
// default that's its path relative to the import root. Each file's import
// statements are pre-scanned; an import that names neither a file under the
// root nor a standard google/protobuf import resolves to the unique file
// sharing the most trailing path segments with it (basename only being the
// weakest match), and that file is then compiled under the import's name
// instead. A tie is an error naming the import and the candidates, as is one
// file being imported under two different names. Files that fail to parse
// are skipped here; the compile reports their syntax errors.
//
// A user copy of a well-known type that isn't at exactly google/protobuf/ at
// the root (vendored under third_party/, or flat with package
// google.protobuf) is compiled under the standard name, so it replaces the
// built-in rather than defining its symbols a second time (see
// standardImportAliases).
func resolveImportAliases(relPaths []string, sources map[string][]byte) (map[string]string, error) {
	isRel := make(map[string]bool, len(relPaths))
	for _, rel := range relPaths {
		isRel[rel] = true
	}

	scanned := make(map[string]scannedFile, len(relPaths))
	for _, rel := range relPaths {
		file, err := scanFile(rel, sources[rel])
		if err != nil {
			continue
		}
		scanned[rel] = file
	}

	aliasOf := map[string]string{}        // relPath -> import name it's compiled as
	importedDirectly := map[string]bool{} // relPaths some file imports by exact path
	for _, importer := range relPaths {
		file, ok := scanned[importer]
		if !ok {
			continue
		}
		for _, imp := range file.imports {
			if isRel[imp] {
				importedDirectly[imp] = true
				continue
			}
			if isStandardImport(imp) {
				continue
			}
			target, err := fallbackImportTarget(imp, importer, relPaths)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", importer, err)
			}
			if target == "" {
				// Left for the compiler to report as not found.
				continue
			}
			if existing, ok := aliasOf[target]; ok && existing != imp {
				return nil, fmt.Errorf("%s is imported as both %q and %q; use one import path", target, existing, imp)
			}
			aliasOf[target] = imp
		}
	}

	standardAliases, err := standardImportAliases(relPaths, scanned, isRel)
	if err != nil {
		return nil, err
	}
	for rel, std := range standardAliases {
		if importedDirectly[rel] {
			// Imported by its own path; keep that name rather than break it.
			continue
		}
		if existing, ok := aliasOf[rel]; ok && existing != std {
			return nil, fmt.Errorf("%s is imported as both %q and %q; use one import path", rel, existing, std)
		}
		aliasOf[rel] = std
	}

	canonical := make(map[string]string, len(relPaths))
	for _, rel := range relPaths {
		name := rel
		if alias, ok := aliasOf[rel]; ok {
			// Imported both by its own path and by an alias, it would be
			// compiled twice under two names.
			if importedDirectly[rel] {
				return nil, fmt.Errorf("%s is imported as both %q and %q; use one import path", rel, rel, alias)
			}
			name = alias
		}
		canonical[name] = rel
	}
	return canonical, nil
}

// standardImportAliases maps each user file that is a copy of a standard
// google/protobuf import to that standard name, unless a file already sits at
// exactly that path under the root (which the resolver serves first anyway).
// A file qualifies when its path ends with the whole standard path, segment
// aligned, or when it has the standard file's basename and declares package
// google.protobuf. Path matches win over package matches; more than one
// candidate at the winning tier is an error.
func standardImportAliases(relPaths []string, scanned map[string]scannedFile, isRel map[string]bool) (map[string]string, error) {
	type candidates struct{ byPath, byPackage []string }
	perStd := map[string]*candidates{}
	for _, rel := range relPaths {
		std, byPath := standardNameFor(rel, scanned)
		if std == "" || isRel[std] {
			continue
		}
		c := perStd[std]
		if c == nil {
			c = &candidates{}
			perStd[std] = c
		}
		if byPath {
			c.byPath = append(c.byPath, rel)
		} else {
			c.byPackage = append(c.byPackage, rel)
		}
	}

	result := map[string]string{}
	stds := make([]string, 0, len(perStd))
	for std := range perStd {
		stds = append(stds, std)
	}
	sort.Strings(stds)
	for _, std := range stds {
		c := perStd[std]
		chosen := c.byPath
		if len(chosen) == 0 {
			chosen = c.byPackage
		}
		if len(chosen) > 1 {
			return nil, fmt.Errorf("%s is provided by more than one file: %s; keep one copy", std, strings.Join(chosen, ", "))
		}
		result[chosen[0]] = std
	}
	return result, nil
}

// standardNameFor returns the standard import rel is a copy of, if any, and
// whether it matched on its path (rather than basename plus package).
func standardNameFor(rel string, scanned map[string]scannedFile) (string, bool) {
	segments := strings.Split(rel, "/")
	if n := len(segments); n >= 3 && segments[n-3] == "google" && segments[n-2] == "protobuf" {
		std := strings.Join(segments[n-3:], "/")
		if isStandardImport(std) {
			return std, true
		}
	}
	file, ok := scanned[rel]
	if !ok || file.pkg != "google.protobuf" {
		return "", false
	}
	std := "google/protobuf/" + path.Base(rel)
	if isStandardImport(std) {
		return std, false
	}
	return "", false
}

// fallbackImportTarget returns the file other than importer whose path shares
// the most trailing segments with imp, "" when none shares even the basename,
// or an error when the best match is a tie. A file never resolves an import
// to itself; that would surface as a cycle rather than a missing file.
func fallbackImportTarget(imp, importer string, relPaths []string) (string, error) {
	impSegments := strings.Split(imp, "/")
	best := 0
	var candidates []string
	for _, rel := range relPaths {
		if rel == importer {
			continue
		}
		score := commonTrailingSegments(impSegments, strings.Split(rel, "/"))
		if score == 0 || score < best {
			continue
		}
		if score > best {
			best = score
			candidates = candidates[:0]
		}
		candidates = append(candidates, rel)
	}
	if len(candidates) > 1 {
		return "", fmt.Errorf("import %q is ambiguous: it could be %s", imp, strings.Join(candidates, ", "))
	}
	if len(candidates) == 0 {
		return "", nil
	}
	return candidates[0], nil
}

func commonTrailingSegments(a, b []string) int {
	n := 0
	for n < len(a) && n < len(b) && a[len(a)-1-n] == b[len(b)-1-n] {
		n++
	}
	return n
}

type scannedFile struct {
	pkg     string
	imports []string
}

// scanFile parses one file just far enough to read its package and list its
// import paths.
func scanFile(name string, content []byte) (scannedFile, error) {
	fileNode, err := parser.Parse(name, bytes.NewReader(content), reporter.NewHandler(nil))
	if err != nil {
		return scannedFile{}, err
	}
	result := scannedFile{imports: []string{}}
	for _, decl := range fileNode.Decls {
		switch node := decl.(type) {
		case *ast.ImportNode:
			if node.Name != nil {
				result.imports = append(result.imports, node.Name.AsString())
			}
		case *ast.PackageNode:
			if node.Name != nil {
				result.pkg = string(node.Name.AsIdentifier())
			}
		}
	}
	return result, nil
}

var standardImportProbe = protocompile.WithStandardImports(protocompile.ResolverFunc(
	func(string) (protocompile.SearchResult, error) {
		return protocompile.SearchResult{}, fs.ErrNotExist
	},
))

func isStandardImport(name string) bool {
	_, err := standardImportProbe.FindFileByPath(name)
	return err == nil
}

func (r *ProtoRegistry) GetLoadedDescriptorNames() []string {
	keys := make([]string, len(*r.LoadedDescriptorsNameMap))
	i := 0
	for fullName := range *r.LoadedDescriptorsNameMap {
		keys[i] = fullName
		i++
	}
	return keys
}

func (r *ProtoRegistry) GetMessageDescriptorFromName(name string) (protoreflect.MessageDescriptor, bool) {
	if r.LoadedDescriptorsNameMap == nil {
		return nil, false
	}
	descriptor, ok := (*r.LoadedDescriptorsNameMap)[name]
	if !ok || descriptor == nil {
		return nil, false
	}
	return *descriptor, true
}

func getMessageDescriptors(compiledFiles *linker.Files, filePath string) []protoreflect.MessageDescriptor {
	result := []protoreflect.MessageDescriptor{}
	compiledFile := compiledFiles.FindFileByPath(filePath)
	if compiledFile == nil {
		return result
	}
	return appendNestedMessageDescriptors(result, compiledFile.Messages())
}

// appendNestedMessageDescriptors recurses into nested message types so a
// type like acme.Envelope.Inner is discoverable alongside its parent.
// Map fields synthesize a MapEntry message per entry; those aren't
// user-selectable types and are skipped.
func appendNestedMessageDescriptors(result []protoreflect.MessageDescriptor, messages protoreflect.MessageDescriptors) []protoreflect.MessageDescriptor {
	for i := 0; i < messages.Len(); i++ {
		message := messages.Get(i)
		if message.IsMapEntry() {
			continue
		}
		result = append(result, message)
		result = appendNestedMessageDescriptors(result, message.Messages())
	}
	return result
}

func getMessageDescriptorNames(descriptors []protoreflect.MessageDescriptor) []string {
	result := []string{}
	for _, descriptor := range descriptors {
		result = append(result, string(descriptor.FullName()))
	}
	return result
}
