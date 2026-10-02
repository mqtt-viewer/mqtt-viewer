package protobuf

import (
	"bytes"
	"context"
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
			return nil, err
		}
		rel = filepath.ToSlash(rel)
		content, err := os.ReadFile(absPath)
		if err != nil {
			return nil, err
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
func resolveImportAliases(relPaths []string, sources map[string][]byte) (map[string]string, error) {
	isRel := make(map[string]bool, len(relPaths))
	for _, rel := range relPaths {
		isRel[rel] = true
	}

	aliasOf := map[string]string{}        // relPath -> import name it's compiled as
	importedDirectly := map[string]bool{} // relPaths some file imports by exact path
	for _, importer := range relPaths {
		imports, err := scanImports(importer, sources[importer])
		if err != nil {
			continue
		}
		for _, imp := range imports {
			if isRel[imp] {
				importedDirectly[imp] = true
				continue
			}
			if isStandardImport(imp) {
				continue
			}
			target, err := fallbackImportTarget(imp, relPaths)
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

// fallbackImportTarget returns the file whose path shares the most trailing
// segments with imp, "" when none shares even the basename, or an error when
// the best match is a tie.
func fallbackImportTarget(imp string, relPaths []string) (string, error) {
	impSegments := strings.Split(imp, "/")
	best := 0
	var candidates []string
	for _, rel := range relPaths {
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

// scanImports parses one file just far enough to list its import paths.
func scanImports(name string, content []byte) ([]string, error) {
	fileNode, err := parser.Parse(name, bytes.NewReader(content), reporter.NewHandler(nil))
	if err != nil {
		return nil, err
	}
	imports := []string{}
	for _, decl := range fileNode.Decls {
		if importNode, ok := decl.(*ast.ImportNode); ok && importNode.Name != nil {
			imports = append(imports, importNode.Name.AsString())
		}
	}
	return imports, nil
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
