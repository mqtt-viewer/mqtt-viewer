package protobuf

import (
	"fmt"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

func DecodeFromProtoBytes(protoBytes []byte, descriptor protoreflect.MessageDescriptor) ([]byte, error) {
	msg := dynamicpb.NewMessage(descriptor)
	err := proto.Unmarshal(protoBytes, msg)
	if err != nil {
		return nil, fmt.Errorf("error unmarshalling proto bytes: %w", err)
	}
	jsonBytes, err := protojson.Marshal(msg)
	if err != nil {
		return nil, fmt.Errorf("error marshalling json bytes: %w", err)
	}
	return jsonBytes, nil
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
