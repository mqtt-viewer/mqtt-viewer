package db

import (
	"context"
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/logging"
)

type DbProdLogger struct {
	logCtx context.Context
}

func NewDbProdLogger() *DbProdLogger {
	return &DbProdLogger{
		logCtx: logging.AppendCtx(context.Background(), slog.String("module", "db-internal")),
	}
}

func (l *DbProdLogger) Printf(s string, i ...interface{}) {
	slog.ErrorContext(l.logCtx, fmt.Sprintf(s, i...))
}
