package cloud

import (
	"mqtt-viewer/backend/env"
	"time"

	"github.com/go-resty/resty/v2"
)

// requestTimeout bounds every portal call. Without it a blackholed or
// captive-portal network leaves requests pending indefinitely, and a
// long-lived install (a container polling for updates every 10 minutes)
// accumulates a goroutine and a socket per check.
const requestTimeout = 10 * time.Second

var client *resty.Client

func GetClient() *resty.Client {
	if client == nil {
		url := env.ServerAddress
		client = resty.New().
			SetBaseURL(url).
			SetBasicAuth(env.CloudUsername, env.CloudPassword).
			SetTimeout(requestTimeout)
	}
	return client
}
