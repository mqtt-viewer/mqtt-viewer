package app

import (
	"fmt"
	"mqtt-viewer/backend/matchers"
	"mqtt-viewer/backend/protobuf"
)

type LoadedProtoRegistryResult struct {
	Dir                            string              `json:"dir"`
	LoadedFileNamesWithDescriptors map[string][]string `json:"loadedFileNamesWithDescriptors"`
}

func (a *App) LoadProtoRegistry(connId uint) (*LoadedProtoRegistryResult, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return nil, fmt.Errorf("connection not found")
	}

	if !*appConnection.Connection.IsProtoEnabled {
		return nil, fmt.Errorf("proto registry is not enabled")
	}

	if !appConnection.Connection.ProtoRegDir.Valid {
		return nil, fmt.Errorf("proto registry dir is not set")
	}

	protoPath := appConnection.Connection.ProtoRegDir.String

	protoReg, err := protobuf.LoadProtoRegistry(protoPath)
	if err != nil {
		return nil, err
	}

	appConnection.LoadedProtoRegistry = protoReg
	appConnection.ProtoMatcher = matchers.NewProtoMatcher(*appConnection.ctx, appConnection.SubscriptionMatcher, *protoReg.LoadedDescriptorsNameMap)

	result := LoadedProtoRegistryResult{
		Dir:                            protoPath,
		LoadedFileNamesWithDescriptors: *protoReg.LoadedFilesWithDescriptorsMap,
	}
	return &result, nil
}

func (a *App) GetMatchingProtoDescriptorForTopic(connId uint, topic string) (string, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return "", fmt.Errorf("connection not found")
	}
	protoMatcher := appConnection.ProtoMatcher
	if protoMatcher == nil {
		return "", nil
	}

	descriptorName := protoMatcher.GetMatchingProtoDescriptorName(topic)
	return descriptorName, nil
}
