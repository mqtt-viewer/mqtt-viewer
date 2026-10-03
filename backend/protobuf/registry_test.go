package protobuf

import (
	"path"
	"runtime"
	"strings"
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
	if len(*registry.LoadedDescriptors) != 7 {
		t.Errorf("Expected 7 descriptors, got %v", len(*registry.LoadedDescriptors))
	}
	if len(*registry.LoadedFiles) != 3 {
		t.Errorf("Expected 3 file names, got %v", len(*registry.LoadedFiles))
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
	if len(*registry.LoadedDescriptorsNameMap) != 7 {
		t.Errorf("Expected 7 descriptors in name map, got %v", len(*registry.LoadedDescriptorsNameMap))
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

func TestRegistryRecursesNestedMessages(t *testing.T) {
	registry, err := LoadProtoRegistry(path.Join(dir, "./test-protos/test-protos-nested"))
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
		return
	}
	// Outer and Outer.Inner; the map field's synthetic MapEntry message is skipped.
	if len(*registry.LoadedDescriptors) != 2 {
		t.Errorf("Expected 2 descriptors, got %v", len(*registry.LoadedDescriptors))
	}

	names := registry.GetLoadedDescriptorNames()
	found := false
	for _, name := range names {
		if name == "nested.Outer.Inner" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("Expected %v to contain nested.Outer.Inner, got %v", names, names)
	}

	for _, name := range names {
		if strings.Contains(name, "Entry") {
			t.Errorf("Expected no map-entry synthetic message in %v, got %v", names, name)
		}
	}

	descriptor, ok := registry.GetMessageDescriptorFromName("nested.Outer.Inner")
	if !ok {
		t.Error("Expected nested.Outer.Inner to resolve via GetMessageDescriptorFromName")
		return
	}
	if string(descriptor.FullName()) != "nested.Outer.Inner" {
		t.Errorf("Expected full name nested.Outer.Inner, got %v", descriptor.FullName())
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

func TestRegistryResolvesImportsFromRoot(t *testing.T) {
	registry, err := LoadProtoRegistry(path.Join(dir, "./test-protos/test-protos-imports-root"))
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if _, ok := registry.GetMessageDescriptorFromName("acme.Reading"); !ok {
		t.Error("Expected acme.Reading to load")
	}
	files := *registry.LoadedFilesWithDescriptorsMap
	for _, want := range []string{"acme/device.proto", "common/units.proto"} {
		if _, ok := files[want]; !ok {
			t.Errorf("Expected file key %q, got %v", want, files)
		}
	}
	for key := range files {
		if strings.HasPrefix(key, "/") || strings.Contains(key, "test-protos-imports-root") {
			t.Errorf("Expected relative file keys, got %q", key)
		}
	}
}

func TestRegistryResolvesWellKnownTypeAndRoundTrips(t *testing.T) {
	registry, err := LoadProtoRegistry(path.Join(dir, "./test-protos/test-protos-imports-root"))
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	descriptor, ok := registry.GetMessageDescriptorFromName("acme.Reading")
	if !ok {
		t.Fatal("Expected acme.Reading to load")
	}
	in := []byte(`{"value":1.5,"units":{"symbol":"C"},"takenAt":"2026-10-03T12:00:00Z"}`)
	wire, err := EncodeFromJSONBytes(in, descriptor)
	if err != nil {
		t.Fatalf("Expected encode to succeed, got %v", err)
	}
	out, err := DecodeFromProtoBytes(wire, descriptor)
	if err != nil {
		t.Fatalf("Expected decode to succeed, got %v", err)
	}
	if !strings.Contains(string(out), `"2026-10-03T12:00:00Z"`) {
		t.Errorf("Expected the Timestamp to round trip, got %s", out)
	}
}

func TestRegistryResolvesSubfolderImportsInFlatUpload(t *testing.T) {
	registry, err := LoadProtoRegistry(path.Join(dir, "./test-protos/test-protos-imports-flat"))
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if _, ok := registry.GetMessageDescriptorFromName("acme.Reading"); !ok {
		t.Error("Expected acme.Reading to load")
	}
	if len(*registry.LoadedDescriptorsNameMap) != 2 {
		t.Errorf("Expected 2 descriptors (no duplicate compile), got %v", registry.GetLoadedDescriptorNames())
	}
	files := *registry.LoadedFilesWithDescriptorsMap
	if _, ok := files["units.proto"]; !ok {
		t.Errorf("Expected the aliased file keyed by its own path, got %v", files)
	}
}

func TestRegistryResolvesImportsFromFolderAboveRoot(t *testing.T) {
	registry, err := LoadProtoRegistry(path.Join(dir, "./test-protos/test-protos-imports-above"))
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if _, ok := registry.GetMessageDescriptorFromName("acme.Reading"); !ok {
		t.Error("Expected acme.Reading to load")
	}
}

func TestRegistryResolvesSiblingBareNameImport(t *testing.T) {
	registry, err := LoadProtoRegistry(path.Join(dir, "./test-protos/test-protos-imports-sibling"))
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if _, ok := registry.GetMessageDescriptorFromName("acme.Reading"); !ok {
		t.Error("Expected acme.Reading to load")
	}
}

func TestRegistryAmbiguousImportFallbackErrors(t *testing.T) {
	_, err := LoadProtoRegistry(path.Join(dir, "./test-protos/test-protos-imports-ambiguous"))
	if err == nil {
		t.Fatal("Expected an ambiguous import error")
	}
	msg := err.Error()
	for _, want := range []string{`"units.proto"`, "ambiguous", "x/units.proto", "y/units.proto"} {
		if !strings.Contains(msg, want) {
			t.Errorf("Expected error to contain %q, got %v", want, msg)
		}
	}
}

func TestRegistrySyntaxErrorUsesRelativePath(t *testing.T) {
	_, err := LoadProtoRegistry(path.Join(dir, "./test-protos/test-protos-syntax-error-nested"))
	if err == nil {
		t.Fatal("Expected a syntax error")
	}
	msg := err.Error()
	if !strings.HasPrefix(msg, "sub/bad.proto:") {
		t.Errorf("Expected error to start with the relative path, got %v", msg)
	}
	if strings.Contains(msg, dir) {
		t.Errorf("Expected no absolute path in the error, got %v", msg)
	}
}

func TestRegistryLoadsEdition2023(t *testing.T) {
	registry, err := LoadProtoRegistry(path.Join(dir, "./test-protos/test-protos-edition"))
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if _, ok := registry.GetMessageDescriptorFromName("editions.Sensor"); !ok {
		t.Error("Expected editions.Sensor to load")
	}
}
