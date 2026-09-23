package app

import "mqtt-viewer/backend/env"

type EnvInfo struct {
	IsDev         bool   `json:"isDev"`
	ServerAddress string `json:"serverAddress"`
	Version       string `json:"version"`
	IsServerMode  bool   `json:"isServerMode"`
}

func (a *App) GetEnvInfo() EnvInfo {
	return EnvInfo{
		IsDev:         env.IsDev,
		ServerAddress: env.ServerAddress,
		Version:       env.Version,
		IsServerMode:  env.IsServerBuild,
	}
}
