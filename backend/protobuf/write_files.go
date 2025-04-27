package protobuf

import (
	_ "embed"
	"os"
	"path"
)

//go:embed spAv1.proto
var embeddedSparkplugA []byte
var sparkplugAFilename = "spAv1.proto"

//go:embed spBv1.proto
var embeddedSparkplugB []byte
var sparkplugBFilename = "spBv1.proto"

var ProtoResourceDirName = "protobuf"

func WriteSparkplugProtoFiles(resourcePath string) error {
	protoDirPath := path.Join(resourcePath, ProtoResourceDirName)

	// Check if the directory exists
	if _, err := os.Stat(protoDirPath); os.IsNotExist(err) {
		// Create the directory if it doesn't exist
		if err := os.MkdirAll(protoDirPath, os.ModePerm); err != nil {
			return err
		}
	}

	protoAFilePath := path.Join(protoDirPath, sparkplugAFilename)
	protoBFilePath := path.Join(protoDirPath, sparkplugBFilename)

	err := writeFile(protoAFilePath, embeddedSparkplugA)
	if err != nil {
		return err
	}

	err = writeFile(protoBFilePath, embeddedSparkplugB)
	if err != nil {
		return err
	}
	return nil
}

func writeFile(path string, bytes []byte) error {
	// Check if the file already exists
	if _, err := os.Stat(path); err == nil {
		// File exists, return without writing
		return nil
	}

	// Write the embedded file to the specified path
	if err := os.WriteFile(path, bytes, os.ModePerm); err != nil {
		return err
	}
	return nil
}
