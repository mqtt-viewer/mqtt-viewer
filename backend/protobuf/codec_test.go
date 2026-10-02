package protobuf

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeMismatchRegistry compiles a two-message registry into a temp dir: A
// and B share no field numbers, so bytes of one unmarshalled against the
// other's descriptor land entirely in unknown fields.
func writeMismatchRegistry(t *testing.T) *ProtoRegistry {
	t.Helper()
	tmpDir := t.TempDir()
	protoSrc := `syntax = "proto3";
package mismatch;

message A {
  string code = 1;
  bool active = 2;
}

message B {
  double temperature = 11;
  int64 uptime = 12;
}
`
	if err := os.WriteFile(filepath.Join(tmpDir, "mismatch.proto"), []byte(protoSrc), 0o644); err != nil {
		t.Fatalf("writing test proto: %v", err)
	}
	registry, err := LoadProtoRegistry(tmpDir)
	if err != nil {
		t.Fatalf("loading test registry: %v", err)
	}
	return registry
}

func TestDecodeFromProtoBytesRejectsWrongTypeWithAllUnknownFields(t *testing.T) {
	registry := writeMismatchRegistry(t)
	descA, ok := registry.GetMessageDescriptorFromName("mismatch.A")
	if !ok {
		t.Fatal("expected mismatch.A to resolve")
	}
	descB, ok := registry.GetMessageDescriptorFromName("mismatch.B")
	if !ok {
		t.Fatal("expected mismatch.B to resolve")
	}

	aBytes, err := EncodeFromJSONBytes([]byte(`{"code":"x","active":true}`), descA)
	if err != nil {
		t.Fatalf("encoding A: %v", err)
	}

	_, err = DecodeFromProtoBytes(aBytes, descB)
	if err == nil {
		t.Fatal("expected an error decoding A's bytes against B's descriptor, got nil")
	}
	if !strings.Contains(err.Error(), "mismatch.B") {
		t.Errorf("expected error to mention mismatch.B, got %v", err)
	}
}

func TestDecodeFromProtoBytesRoundTripsSameType(t *testing.T) {
	registry := writeMismatchRegistry(t)
	descA, ok := registry.GetMessageDescriptorFromName("mismatch.A")
	if !ok {
		t.Fatal("expected mismatch.A to resolve")
	}

	aBytes, err := EncodeFromJSONBytes([]byte(`{"code":"x","active":true}`), descA)
	if err != nil {
		t.Fatalf("encoding A: %v", err)
	}

	jsonBytes, err := DecodeFromProtoBytes(aBytes, descA)
	if err != nil {
		t.Fatalf("expected no error round-tripping A, got %v", err)
	}
	got := string(jsonBytes)
	if !strings.Contains(got, `"code":"x"`) || !strings.Contains(got, `"active":true`) {
		t.Errorf("expected round-tripped JSON to contain both fields, got %v", got)
	}
}

func TestDecodeFromProtoBytesEmptyPayloadStillSucceeds(t *testing.T) {
	registry := writeMismatchRegistry(t)
	descB, ok := registry.GetMessageDescriptorFromName("mismatch.B")
	if !ok {
		t.Fatal("expected mismatch.B to resolve")
	}

	jsonBytes, err := DecodeFromProtoBytes([]byte{}, descB)
	if err != nil {
		t.Fatalf("expected no error decoding an empty payload, got %v", err)
	}
	if string(jsonBytes) != "{}" {
		t.Errorf("expected {}, got %v", string(jsonBytes))
	}
}

func TestDecodeFromProtoBytesKnownFieldSetSucceedsDespiteUnknownBytes(t *testing.T) {
	registry := writeMismatchRegistry(t)
	descA, ok := registry.GetMessageDescriptorFromName("mismatch.A")
	if !ok {
		t.Fatal("expected mismatch.A to resolve")
	}

	aBytes, err := EncodeFromJSONBytes([]byte(`{"code":"x","active":true}`), descA)
	if err != nil {
		t.Fatalf("encoding A: %v", err)
	}
	// Append an unknown field (field number 15, varint wire type; the tag
	// 15<<3|0 = 120 fits in a single varint byte) so the message carries both
	// a known field and unknown bytes; the guard must not fire since a known
	// field is populated.
	unknownFieldTag := byte(15<<3 | 0)
	aBytesWithUnknown := append(aBytes, unknownFieldTag, 0x01)

	jsonBytes, err := DecodeFromProtoBytes(aBytesWithUnknown, descA)
	if err != nil {
		t.Fatalf("expected no error when a known field is set, got %v", err)
	}
	got := string(jsonBytes)
	if !strings.Contains(got, `"code":"x"`) {
		t.Errorf("expected decoded JSON to contain the known field, got %v", got)
	}
}
