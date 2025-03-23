package main

import (
	"fmt"
	"io"
	"os"

	"mqtt-viewer/backend/models"

	"ariga.io/atlas-provider-gorm/gormschema"
)

// Used to generate migrations using atlas
// see justfile in the root directory for migration commands

func main() {
	stmts, err := gormschema.New("sqlite").Load(
		&models.Connection{},
		&models.Tab{},
		&models.Subscription{},
		&models.SortState{},
		&models.FilterHistory{},
		&models.PanelSize{},
		&models.PublishHistory{},
		&models.Global{},
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load gorm schema: %v\n", err)
		os.Exit(1)
	}
	io.WriteString(os.Stdout, stmts)
}
