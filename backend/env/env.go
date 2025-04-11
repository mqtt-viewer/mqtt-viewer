package env

import (
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/machine"
	"strings"
)

var (
	IsDev                  = true
	ServerAddress          = "http://localhost:8090"
	Version                = "0.0.0-dev"
	MachineIdProtectString = "dev-protect-string" // Hashes the machine id to protect anonymity
	MachineId              = ""
	CloudUsername          = "dev-username"
	CloudPassword          = "dev-password"
)

func init() {
	if !strings.Contains(Version, "-dev") {
		IsDev = false
	}
	if !IsDev {
		ServerAddress = "https://cloud.mqttviewer.app"
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
