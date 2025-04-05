package protobuf

import (
	"context"
	"mqtt-viewer/backend/util"
	"path/filepath"

	"github.com/bufbuild/protocompile"
	"github.com/bufbuild/protocompile/linker"
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

func LoadProtoRegistry(importPath string) (*ProtoRegistry, error) {
	compiler := protocompile.Compiler{
		Resolver: &protocompile.SourceResolver{},
	}

	protoFiles := util.FindAllNestedFilesWithExtension(importPath, ".proto")

	ctx := context.Background()

	compiledFiles, err := compiler.Compile(ctx, protoFiles...)
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
		loadedFileNames = append(loadedFileNames, filepath.Base(file.Path()))
		loadedFilesWithDescriptorsMap[file.Path()] = messageDescriptorNames
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
	messages := compiledFile.Messages()
	for i := 0; i < messages.Len(); i++ {
		message := messages.Get(i)
		result = append(result, message)
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
