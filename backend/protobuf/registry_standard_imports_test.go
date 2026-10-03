package protobuf

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const vendoredTimestamp = `syntax = "proto3";
package google.protobuf;
message Timestamp {
  int64 seconds = 1;
  int32 nanos = 2;
}
`

const readingImportingTimestamp = `syntax = "proto3";
package acme;
import "google/protobuf/timestamp.proto";
message Reading {
  google.protobuf.Timestamp taken_at = 1;
}
`

func writeProtoTree(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for rel, content := range files {
		abs := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestRegistryUsesVendoredWellKnownTypeUnderSubfolder(t *testing.T) {
	root := writeProtoTree(t, map[string]string{
		"third_party/google/protobuf/timestamp.proto": vendoredTimestamp,
		"acme/reading.proto":                          readingImportingTimestamp,
	})
	registry, err := LoadProtoRegistry(root)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if _, ok := registry.GetMessageDescriptorFromName("acme.Reading"); !ok {
		t.Error("Expected acme.Reading to load")
	}
	files := *registry.LoadedFilesWithDescriptorsMap
	if _, ok := files["third_party/google/protobuf/timestamp.proto"]; !ok {
		t.Errorf("Expected the vendored file keyed by its own path, got %v", files)
	}
}

func TestRegistryUsesFlatWellKnownTypeByPackage(t *testing.T) {
	root := writeProtoTree(t, map[string]string{
		"timestamp.proto": vendoredTimestamp,
		"reading.proto":   readingImportingTimestamp,
	})
	registry, err := LoadProtoRegistry(root)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if _, ok := registry.GetMessageDescriptorFromName("acme.Reading"); !ok {
		t.Error("Expected acme.Reading to load")
	}
}

func TestRegistryLoadsUnimportedVendoredWellKnownType(t *testing.T) {
	root := writeProtoTree(t, map[string]string{
		"third_party/google/protobuf/timestamp.proto": vendoredTimestamp,
		"timestamp.proto":  strings.Replace(vendoredTimestamp, "package google.protobuf;", "package flat;", 1),
		"acme/other.proto": "syntax = \"proto3\";\npackage acme;\nimport \"google/protobuf/duration.proto\";\nmessage Other { google.protobuf.Duration d = 1; }\n",
	})
	registry, err := LoadProtoRegistry(root)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if _, ok := registry.GetMessageDescriptorFromName("google.protobuf.Timestamp"); !ok {
		t.Error("Expected the vendored google.protobuf.Timestamp to load")
	}
}

func TestRegistryDoesNotUseSameBasenameFromOtherPackageForStandardImport(t *testing.T) {
	root := writeProtoTree(t, map[string]string{
		"acme/timestamp.proto": "syntax = \"proto3\";\npackage acme;\nmessage Stamp { int64 at = 1; }\n",
		"acme/reading.proto":   readingImportingTimestamp,
	})
	registry, err := LoadProtoRegistry(root)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if _, ok := registry.GetMessageDescriptorFromName("acme.Stamp"); !ok {
		t.Error("Expected acme.Stamp to load")
	}
	reading, ok := registry.GetMessageDescriptorFromName("acme.Reading")
	if !ok {
		t.Fatal("Expected acme.Reading to load")
	}
	field := reading.Fields().ByName("taken_at")
	if got := string(field.Message().FullName()); got != "google.protobuf.Timestamp" {
		t.Errorf("Expected the built-in Timestamp, got %v", got)
	}
	if _, ok := (*registry.LoadedFilesWithDescriptorsMap)["acme/timestamp.proto"]; !ok {
		t.Errorf("Expected acme/timestamp.proto under its own path, got %v", *registry.LoadedFilesWithDescriptorsMap)
	}
}

func TestRegistryPrefersRootWellKnownTypeOverVendored(t *testing.T) {
	root := writeProtoTree(t, map[string]string{
		"google/protobuf/timestamp.proto": vendoredTimestamp,
		"acme/reading.proto":              readingImportingTimestamp,
	})
	if _, err := LoadProtoRegistry(root); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
}

func TestRegistryFallbackNeverResolvesImportToItself(t *testing.T) {
	root := writeProtoTree(t, map[string]string{
		"x/types.proto": "syntax = \"proto3\";\npackage x;\nimport \"y/types.proto\";\nmessage T { int32 a = 1; }\n",
	})
	_, err := LoadProtoRegistry(root)
	if err == nil {
		t.Fatal("Expected an error for the missing import")
	}
	msg := err.Error()
	if strings.Contains(msg, "cycle") {
		t.Errorf("Expected a not-found error, not a cycle, got %v", msg)
	}
	if !strings.Contains(msg, "y/types.proto") {
		t.Errorf("Expected the error to name the missing import, got %v", msg)
	}
}
