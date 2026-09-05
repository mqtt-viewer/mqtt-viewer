package paths

import (
	"errors"
	"os"
	"path"
	"path/filepath"
	"runtime"
)

type Paths struct {
	ResourcePath string
}

func GetPaths() Paths {
	// MQTT_VIEWER_DATA_DIR overrides the per-OS location for containerised/server
	// deployments, where the data lives on a mounted Docker volume.
	if dataDir := os.Getenv("MQTT_VIEWER_DATA_DIR"); dataDir != "" {
		if _, err := os.ReadDir(dataDir); os.IsNotExist(err) {
			os.MkdirAll(dataDir, os.ModePerm)
		}
		return Paths{
			ResourcePath: dataDir,
		}
	}

	homeDir, err := os.UserHomeDir()
	resourcePath := ""
	switch runtime.GOOS {
	case "windows":
		resourcePath = filepath.Join(homeDir, "/AppData/Local/MqttViewer")
	case "darwin":
		resourcePath = filepath.Join(homeDir, "/Library/Application Support/MqttViewer")
	case "linux":
		resourcePath = filepath.Join(homeDir, "/.var/app/app.mqttviewer.MqttViewer/data")
	default:
		err = errors.New("unsupported platform")
	}
	if err != nil {
		panic(err)
	}
	if _, err := os.ReadDir(resourcePath); os.IsNotExist(err) {
		os.MkdirAll(resourcePath, os.ModePerm)
	}
	return Paths{
		ResourcePath: resourcePath,
	}
}

var _, filename, _, _ = runtime.Caller(0)
var configDir = path.Dir(filename)
var devResourcesDir = path.Join(configDir, "../../_dev_resources")

func GetDevPaths() Paths {
	if _, err := os.Stat(devResourcesDir); os.IsNotExist(err) {
		os.MkdirAll(devResourcesDir, os.ModePerm)
	}
	return Paths{
		ResourcePath: devResourcesDir,
	}
}
