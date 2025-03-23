package logging

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path"
	"time"

	"github.com/lmittmann/tint"

	slogmulti "github.com/samber/slog-multi"
	lumberjack "gopkg.in/natefinch/lumberjack.v2"
)

// default for testing
func init() {
	w := os.Stdout
	handlerOptions := tint.Options{
		Level:      slog.LevelDebug,
		TimeFormat: time.RFC822,
	}
	consoleLog := tint.NewHandler(w, &handlerOptions)
	ctxHandler := &ContextHandler{consoleLog}
	slog.SetDefault(slog.New((ctxHandler)))
}

type Logger struct {
	Logger      *slog.Logger
	LogCtx      *context.Context
	logDir      string
	logHandlers []slog.Handler
}

type LoggerParams struct {
	ResourceDir          string
	EnableDebugLogging   bool
	EnableFileLogging    bool
	EnableConsoleLogging bool
}

func InitLogger(params LoggerParams) *Logger {
	l := &Logger{
		logDir:      path.Join(params.ResourceDir, "logs"),
		logHandlers: []slog.Handler{},
		Logger:      nil,
	}

	if params.EnableFileLogging {
		err := l.createLoggingDir()
		if err != nil {
			slog.Error(fmt.Sprintf("error creating logging directory: %v", err))
			params.EnableFileLogging = false
		}
	}

	if params.EnableFileLogging {
		textLogRoller := &lumberjack.Logger{
			Filename:   path.Join(l.logDir, "log.txt"),
			MaxSize:    5, // megabytes
			MaxBackups: 10,
		}
		handlerOptions := &slog.HandlerOptions{
			Level: slog.LevelInfo,
		}
		if params.EnableDebugLogging {
			handlerOptions.Level = slog.LevelDebug
		}

		slogText := slog.NewTextHandler(textLogRoller, handlerOptions)
		ctxHandler := &ContextHandler{slogText}
		l.logHandlers = append(l.logHandlers, ctxHandler)
	}

	if params.EnableConsoleLogging {
		w := os.Stdout
		handlerOptions := tint.Options{
			Level:      slog.LevelInfo,
			TimeFormat: time.RFC822,
		}
		if params.EnableDebugLogging {
			handlerOptions.Level = slog.LevelDebug
		}
		consoleLog := tint.NewHandler(w, &handlerOptions)
		ctxHandler := &ContextHandler{consoleLog}
		l.logHandlers = append(l.logHandlers, ctxHandler)
	}
	logger := slog.New(slogmulti.Fanout(l.logHandlers...))
	slog.SetDefault(logger)
	slog.Info(fmt.Sprintf("logging initalized with debug logging: %v, file logging: %v, console logging: %v", params.EnableDebugLogging, params.EnableFileLogging, params.EnableConsoleLogging))
	l.Logger = logger
	return l
}

func (l *Logger) createLoggingDir() error {
	err := os.MkdirAll(l.logDir, 0755)
	return err
}
