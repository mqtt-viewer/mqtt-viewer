package protobuf

import (
	_ "embed"
	"os"
	"path"
)

//go:embed sparkplugB.proto
var embeddedSparkplugB []byte

var fileName = "sparkplugB.proto"

var ProtoResourceDirName = "protobuf"

func WriteSparkplugBProtoFile(resourcePath string) error {
	protoFilePath := path.Join(resourcePath, ProtoResourceDirName, fileName)

	// Check if the directory exists
	if _, err := os.Stat(path.Dir(protoFilePath)); os.IsNotExist(err) {
		// Create the directory if it doesn't exist
		if err := os.MkdirAll(path.Dir(protoFilePath), 0755); err != nil {
			return err
		}
	}

	// Check if the file already exists
	if _, err := os.Stat(protoFilePath); err == nil {
		// File exists, return without writing
		return nil
	}

	// Write the embedded file to the specified path
	if err := os.WriteFile(protoFilePath, embeddedSparkplugB, 0644); err != nil {
		return err
	}

	return nil
}
