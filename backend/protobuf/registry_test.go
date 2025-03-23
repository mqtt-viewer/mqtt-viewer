package protobuf

import (
	"path"
	"runtime"
	"testing"
)

var _, filename, _, _ = runtime.Caller(0)
var dir = path.Dir(filename)

func TestRegistryLoadsCorrectly(t *testing.T) {
	registry, err := LoadProtoRegistry(path.Join(dir, "./test-protos/test-protos-good"))
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
		return
	}
	if len(*registry.LoadedDescriptors) != 4 {
		t.Errorf("Expected 4 descriptors, got %v", len(*registry.LoadedDescriptors))
	}
	if len(*registry.LoadedFiles) != 2 {
		t.Errorf("Expected 2 file names, got %v", len(registry.LoadedFileNames))
	}
	if !(*registry.LoadedDescriptors)[0].FullName().IsValid() {
		t.Errorf("Expected first descriptor to have a valid full name, got %v", (*registry.LoadedDescriptors)[0].FullName())
	}
	if !(*registry.LoadedDescriptors)[1].FullName().IsValid() {
		t.Errorf("Expected second descriptor to have a valid full name, got %v", (*registry.LoadedDescriptors)[0].FullName())
	}
	if !(*registry.LoadedDescriptors)[2].FullName().IsValid() {
		t.Errorf("Expected third descriptor to have a valid full name, got %v", (*registry.LoadedDescriptors)[0].FullName())
	}
	if len(*registry.LoadedDescriptorsNameMap) != 4 {
		t.Errorf("Expected 4 descriptors in name map, got %v", len(*registry.LoadedDescriptorsNameMap))
	}
}

func TestDescriptorsNameMapIsBuiltCorrectly(t *testing.T) {
	registry, err := LoadProtoRegistry(path.Join(dir, "./test-protos/test-protos-good"))
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
		return
	}
	for k, v := range *registry.LoadedDescriptorsNameMap {
		if k != string((*v).FullName()) {
			t.Errorf("Expected value to be %v, got %v", k, string((*v).FullName()))
		}
	}
}

func TestEmptyRegistryLoadsCorrectly(t *testing.T) {
	registry, err := LoadProtoRegistry(path.Join(dir, "./test-protos/test-protos-empty"))
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
		return
	}
	if len(*registry.LoadedDescriptors) != 0 {
		t.Errorf("Expected 0 descriptors, got %v", len(*registry.LoadedDescriptors))
	}
	if len(registry.LoadedFileNames) != 0 {
		t.Errorf("Expected 0 file names, got %v", len(registry.LoadedFileNames))
	}
	if len(*registry.LoadedDescriptorsNameMap) != 0 {
		t.Errorf("Expected 0 descriptors in name map, got %v", len(*registry.LoadedDescriptorsNameMap))
	}
}

func TestRegistryWithOtherFilesLoadsCorrectly(t *testing.T) {
	registry, err := LoadProtoRegistry(path.Join(dir, "./test-protos/test-protos-other-files"))
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
		return
	}
	if len(*registry.LoadedDescriptors) != 2 {
		t.Errorf("Expected 2 descriptors, got %v", len(*registry.LoadedDescriptors))
	}
	if len(registry.LoadedFileNames) != 1 {
		t.Errorf("Expected 1 file names, got %v", len(registry.LoadedFileNames))
	}
	if len(*registry.LoadedDescriptorsNameMap) != 2 {
		t.Errorf("Expected 2 descriptors in name map, got %v", len(*registry.LoadedDescriptorsNameMap))
	}
}

func TestRegistryWithOneBadProtoFails(t *testing.T) {
	_, err := LoadProtoRegistry(path.Join(dir, "./test-protos/test-protos-one-bad"))
	if err == nil {
		t.Error("Expected an error, got none")
		return
	}
}

func TestRegistryWithProto2LoadsCorrectly(t *testing.T) {
	registry, err := LoadProtoRegistry(path.Join(dir, "./test-protos/test-protos-proto2"))
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
		return
	}
	if len(*registry.LoadedDescriptors) != 1 {
		t.Errorf("Expected 1 descriptors, got %v", len(*registry.LoadedDescriptors))
	}
	if len(registry.LoadedFileNames) != 1 {
		t.Errorf("Expected 1 file names, got %v", len(registry.LoadedFileNames))
	}
	if len(*registry.LoadedDescriptorsNameMap) != 1 {
		t.Errorf("Expected 1 descriptors in name map, got %v", len(*registry.LoadedDescriptorsNameMap))
	}
}

func TestRegistryWithProto2And3LoadsCorrectly(t *testing.T) {
	registry, err := LoadProtoRegistry(path.Join(dir, "./test-protos/test-protos-proto2+3"))
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
		return
	}
	if len(*registry.LoadedDescriptors) != 3 {
		t.Errorf("Expected 3 descriptors, got %v", len(*registry.LoadedDescriptors))
	}
	if len(registry.LoadedFileNames) != 2 {
		t.Errorf("Expected 2 file names, got %v", len(registry.LoadedFileNames))
	}
	if len(*registry.LoadedDescriptorsNameMap) != 3 {
		t.Errorf("Expected 3 descriptors in name map, got %v", len(*registry.LoadedDescriptorsNameMap))
	}
}
