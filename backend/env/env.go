package env

import (
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/machine"
	"os"
	"strings"
)

const (
	prodServerAddress      = "https://cloud.mqttviewer.app"
	serverAddressEnvVarKey = "MQTT_VIEWER_SERVER_ADDRESS"
)

var (
	IsDev                  = true
	ServerAddress          = "http://localhost:8090"
	Version                = "0.0.0-dev"
	MachineIdProtectString = "dev-protect-string" // Hashes the machine id to protect anonymity
	MachineId              = ""
	CloudUsername          = "dev-username"
	CloudPassword          = "dev-password"
	IsAppImage             = "false"
)

func init() {
	if !strings.Contains(Version, "-dev") {
		IsDev = false
	}
	ServerAddress = resolveServerAddress(IsDev, ServerAddress, os.Getenv(serverAddressEnvVarKey))
	if !IsDev {
		slog.Info("running in prod mode")
	} else {
		slog.Info("running in dev mode")
	}
	if MachineIdProtectString == "" {
		panic("MachineIdProtectString must be set")
	}
	mid, err := machine.GetMachineId(MachineIdProtectString)
	if err != nil {
		slog.Error(fmt.Sprintf("error getting machine id: %v", err))
		panic(fmt.Sprintf("error getting machine id: %v", err))
	} else {
		MachineId = mid
	}

	slog.Info(fmt.Sprintf("using server address %s", ServerAddress))
}

// resolveServerAddress picks the portal address. The env var override only
// applies to dev builds so prod binaries always talk to the real portal.
func resolveServerAddress(isDev bool, devDefault string, devOverride string) string {
	if !isDev {
		return prodServerAddress
	}
	if devOverride != "" {
		return devOverride
	}
	return devDefault
}
