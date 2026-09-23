package protobuf

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

func DecodeFromProtoBytes(protoBytes []byte, descriptor protoreflect.MessageDescriptor) ([]byte, error) {
	msg, err := UnmarshalToDynamic(protoBytes, descriptor)
	if err != nil {
		return nil, err
	}
	return MarshalDynamicToJSON(msg)
}

// UnmarshalToDynamic decodes protoBytes into a mutable dynamic message so
// callers can inspect or rewrite fields before marshalling to JSON.
func UnmarshalToDynamic(protoBytes []byte, descriptor protoreflect.MessageDescriptor) (*dynamicpb.Message, error) {
	msg := dynamicpb.NewMessage(descriptor)
	err := proto.Unmarshal(protoBytes, msg)
	if err != nil {
		return nil, fmt.Errorf("error unmarshalling proto bytes: %w", err)
	}
	return msg, nil
}

// MarshalDynamicToJSON renders msg as protojson. proto2 schemas (Sparkplug
// among them) let invalid UTF-8 through Unmarshal in string fields, which
// protojson then refuses, so on failure every string in the message is made
// valid (bad bytes become U+FFFD) and the marshal is retried once. A publisher
// with one garbled metric name still gets the rest of its payload decoded.
func MarshalDynamicToJSON(msg *dynamicpb.Message) ([]byte, error) {
	jsonBytes, err := protojson.Marshal(msg)
	if err == nil {
		return jsonBytes, nil
	}
	if !SanitiseInvalidUTF8(msg) {
		return nil, fmt.Errorf("error marshalling json bytes: %w", err)
	}
	jsonBytes, err = protojson.Marshal(msg)
	if err != nil {
		return nil, fmt.Errorf("error marshalling json bytes: %w", err)
	}
	return jsonBytes, nil
}

// SanitiseInvalidUTF8 replaces invalid UTF-8 in every string field of msg,
// recursing into nested messages and lists. Reports whether anything changed.
func SanitiseInvalidUTF8(msg protoreflect.Message) bool {
	// Collect first: protoreflect leaves mutation during Range undefined.
	type field struct {
		fd    protoreflect.FieldDescriptor
		value protoreflect.Value
	}
	fields := []field{}
	msg.Range(func(fd protoreflect.FieldDescriptor, value protoreflect.Value) bool {
		fields = append(fields, field{fd, value})
		return true
	})
	changed := false
	for _, f := range fields {
		fd := f.fd
		isMessage := fd.Kind() == protoreflect.MessageKind || fd.Kind() == protoreflect.GroupKind
		switch {
		case fd.IsMap():
			// No map fields in the schemas this app decodes; left alone.
		case fd.IsList():
			list := f.value.List()
			for i := 0; i < list.Len(); i++ {
				if isMessage {
					if SanitiseInvalidUTF8(list.Get(i).Message()) {
						changed = true
					}
				} else if fd.Kind() == protoreflect.StringKind {
					if s := list.Get(i).String(); !utf8.ValidString(s) {
						list.Set(i, protoreflect.ValueOfString(strings.ToValidUTF8(s, "\uFFFD")))
						changed = true
					}
				}
			}
		case isMessage:
			if SanitiseInvalidUTF8(f.value.Message()) {
				changed = true
			}
		case fd.Kind() == protoreflect.StringKind:
			if s := f.value.String(); !utf8.ValidString(s) {
				msg.Set(fd, protoreflect.ValueOfString(strings.ToValidUTF8(s, "\uFFFD")))
				changed = true
			}
		}
	}
	return changed
}

func EncodeFromJSONBytes(jsonBytes []byte, descriptor protoreflect.MessageDescriptor) ([]byte, error) {
	msg := dynamicpb.NewMessage(descriptor)
	err := protojson.Unmarshal(jsonBytes, msg)
	if err != nil {
		return nil, fmt.Errorf("error unmarshalling json bytes: %w", err)
	}
	protoBytes, err := proto.Marshal(msg)
	if err != nil {
		return nil, fmt.Errorf("error marshalling proto bytes: %w", err)
	}
	return protoBytes, nil
}
