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
	isNewFile := false

	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		// remove stale sidecar files left behind by a deleted db so they
		// can't be replayed into the new empty file
		for _, sfx := range []string{"-journal", "-wal", "-shm"} {
			if os.Remove(dbPath+sfx) == nil {
				slog.Warn("removed stale sqlite sidecar file " + dbPath + sfx)
			}
		}
		slog.Info("creating db file at " + dbPath)
		file, err := os.Create(dbPath)
		if err != nil {
			return nil, err
		}
		file.Close()
		isNewFile = true
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
	// WAL + synchronous=NORMAL let writes and reads proceed concurrently and
	// avoid an fsync per transaction, which matters once received messages are
	// persisted in batches at broker rates. busy_timeout keeps writers waiting
	// rather than erroring under contention.
	dsn := dbPath + "?_pragma=busy_timeout(5000)" +
		"&_pragma=journal_mode(WAL)" +
		"&_pragma=synchronous(NORMAL)"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: newLogger,
	})
	if err != nil {
		return nil, err
	}
	if res := db.Exec("PRAGMA foreign_keys = ON"); res.Error != nil {
		return nil, res.Error
	}
	// auto_vacuum can only be changed on a database with no tables (then it
	// persists in the header). Set it on freshly created files and VACUUM to
	// commit it, so pruned message pages can later be released to the OS via
	// PRAGMA incremental_vacuum. Existing databases keep their current mode.
	if isNewFile {
		if res := db.Exec("PRAGMA auto_vacuum = INCREMENTAL"); res.Error != nil {
			return nil, res.Error
		}
		if res := db.Exec("VACUUM"); res.Error != nil {
			return nil, res.Error
		}
	}
	slog.Info("connected to database at " + dbPath)

	return &DB{*db}, nil
}
