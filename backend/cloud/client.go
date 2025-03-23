package cloud

import (
	"mqtt-viewer/backend/env"

	"github.com/go-resty/resty/v2"
)

var client *resty.Client

func GetClient() *resty.Client {
	if client == nil {
		url := env.ServerAddress
		client = resty.New().SetBaseURL(url).SetBasicAuth(env.CloudUsername, env.CloudPassword)
	}
	return client
}
