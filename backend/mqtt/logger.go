package mqtt

import (
	"context"
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/logging"
)

type MqttLogger struct {
	ctx context.Context
}

func NewMqttLogger() *MqttLogger {
	return &MqttLogger{
		ctx: logging.AppendCtx(context.Background(), slog.String("module", "mqtt-debug")),
	}
}

func (ml *MqttLogger) Println(v ...interface{}) {
	slog.DebugContext(ml.ctx, fmt.Sprint(v...))
}

func (ml *MqttLogger) Printf(format string, v ...interface{}) {
	slog.DebugContext(ml.ctx, fmt.Sprintf(format, v...))
}
