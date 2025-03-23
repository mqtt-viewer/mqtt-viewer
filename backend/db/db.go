package db

import (
	"log"
	"log/slog"
	"os"
	"path"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	logger "gorm.io/gorm/logger"
)

type DB struct {
	gorm.DB
}

type NewDbOptions struct {
	Name                 string
	EnableConsoleLogging bool
	LogLevel             logger.LogLevel
}

func NewDb(resourcePath string, options *NewDbOptions) (*DB, error) {
	name := "MqttViewer.db"
	if options != nil && options.Name != "" {
		name = options.Name
	}
	dbPath := path.Join(resourcePath, name)

	var err error

	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		slog.Info("creating db file at " + dbPath)
		file, err := os.Create(dbPath)
		if err != nil {
			return nil, err
		}
		file.Close()
	} else if err != nil {
		return nil, err
	}

	var newLogger logger.Interface
	if options != nil && options.EnableConsoleLogging {
		loggerConfig := logger.Config{
			SlowThreshold:             100 * time.Millisecond,
			LogLevel:                  logger.Info,
			IgnoreRecordNotFoundError: true,
			ParameterizedQueries:      false,
			Colorful:                  true,
		}
		if options.LogLevel != 0 {
			loggerConfig.LogLevel = options.LogLevel
		}
		newLogger = logger.New(
			log.New(os.Stdout, "\r\n", log.LstdFlags),
			loggerConfig,
		)
	} else {
		dbProdLogger := NewDbProdLogger()
		loggerConfig := logger.Config{
			SlowThreshold:             500 * time.Millisecond,
			LogLevel:                  logger.Warn,
			IgnoreRecordNotFoundError: true,
		}
		newLogger = logger.New(
			dbProdLogger,
			loggerConfig,
		)
	}
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: newLogger,
	})
	if err != nil {
		return nil, err
	}
	if res := db.Exec("PRAGMA foreign_keys = ON"); res.Error != nil {
		return nil, res.Error
	}
	slog.Info("connected to database at " + dbPath)

	return &DB{*db}, nil
}
