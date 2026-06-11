package db

import (
	"embed"
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/cryptography"
	"mqtt-viewer/backend/env"
	"mqtt-viewer/backend/models"
	"strings"

	"gorm.io/gorm"
)

//go:embed migrations
var migrationsDir embed.FS

func (db *DB) Migrate() error {
	slog.Info("running migrations")
	if err := db.AutoMigrate(&models.Migration{}); err != nil {
		return err
	}
	migrations, err := migrationsDir.ReadDir("migrations")
	if err != nil {
		return err
	}

	appliedMigrations, err := db.getAppliedMigrations()
	if err != nil {
		return err
	}

	migrationsApplied := 0
	// Pin a single connection so the foreign_keys pragma applies to every
	// migration transaction (SQLite ignores it inside an open transaction).
	err = db.Connection(func(conn *gorm.DB) error {
		if err := conn.Exec("PRAGMA foreign_keys = OFF").Error; err != nil {
			return err
		}
		for _, migration := range migrations {
			// ignore non-sql files
			if !strings.HasSuffix(migration.Name(), ".sql") {
				continue
			}
			filename := strings.Replace(migration.Name(), ".sql", "", 1)
			if _, ok := appliedMigrations[filename]; ok {
				continue
			}
			migrationContent, err := migrationsDir.ReadFile("migrations/" + migration.Name())
			if err != nil {
				return err
			}
			// Apply the migration and record it atomically so a failure can
			// never leave the schema ahead of the migrations table.
			if err := conn.Transaction(func(tx *gorm.DB) error {
				if err := tx.Exec(string(migrationContent)).Error; err != nil {
					return err
				}
				return tx.Create(&models.Migration{MigrationFileName: filename}).Error
			}); err != nil {
				return fmt.Errorf("applying migration %s: %w", filename, err)
			}
			migrationsApplied++
			slog.Info("applied migration " + filename)

			// special case to encrypt existing plaintext passwords
			if migration.Name() == "20250320051532_add-global-and-encrypt-passwords.sql" {
				slog.Info("encrypting existing passwords")
				if err := db.encryptExistingPasswords(); err != nil {
					return err
				}
			}
		}
		return conn.Exec("PRAGMA foreign_keys = ON").Error
	})
	if err != nil {
		return err
	}
	slog.Info("applied " + fmt.Sprint(migrationsApplied) + " migrations")
	return nil
}

func (db *DB) getAppliedMigrations() (map[string]bool, error) {
	var appliedMigrations []string
	if err := db.Model(&models.Migration{}).Pluck("migration_file_name", &appliedMigrations).Error; err != nil {
		return nil, err
	}

	appliedMigrationsMap := make(map[string]bool)
	for _, migration := range appliedMigrations {
		appliedMigrationsMap[migration] = true
	}

	return appliedMigrationsMap, nil
}

func (db *DB) encryptExistingPasswords() error {
	type conn struct {
		ID       uint
		Password string
	}

	err := db.Transaction(func(tx *gorm.DB) error {
		var result []conn
		tx.Raw("SELECT id, password FROM connections").Scan(&result)
		for _, c := range result {
			if c.Password == "" {
				continue
			}
			encryptedPassword, err := cryptography.EncryptBytesForMachine(env.MachineId, []byte(c.Password))
			if err != nil {
				return err
			}
			slog.Info(fmt.Sprintf("encrypting password from %s to %s", c.Password, string(encryptedPassword)))
			if err := tx.Exec("UPDATE connections SET password = ? WHERE id = ?", string(encryptedPassword), c.ID).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return err
}
