package app

import "testing"

func TestUpdateChartWindowInsertsThenUpdatesSameId(t *testing.T) {
	app := getTestApp(t)

	if err := app.UpdateChartWindow("conn-1", 300); err != nil {
		t.Fatalf("inserting chart window: %v", err)
	}
	rows, err := app.GetChartWindows()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(rows) != 1 || rows[0].ID != "conn-1" || rows[0].WindowSeconds != 300 {
		t.Fatalf("expected [{conn-1 300}], got %+v", rows)
	}

	if err := app.UpdateChartWindow("conn-1", 7200); err != nil {
		t.Fatalf("updating chart window: %v", err)
	}
	rows, err = app.GetChartWindows()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(rows) != 1 || rows[0].ID != "conn-1" || rows[0].WindowSeconds != 7200 {
		t.Fatalf("expected update in place [{conn-1 7200}], got %+v", rows)
	}
}

func TestGetChartWindowsReturnsAllRowsIndependentPerConnection(t *testing.T) {
	app := getTestApp(t)

	if err := app.UpdateChartWindow("conn-1", 300); err != nil {
		t.Fatalf("inserting conn-1: %v", err)
	}
	if err := app.UpdateChartWindow("conn-2", 43200); err != nil {
		t.Fatalf("inserting conn-2: %v", err)
	}

	rows, err := app.GetChartWindows()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d: %+v", len(rows), rows)
	}
	byId := map[string]int64{}
	for _, row := range rows {
		byId[row.ID] = row.WindowSeconds
	}
	if byId["conn-1"] != 300 {
		t.Errorf("expected conn-1 = 300, got %d", byId["conn-1"])
	}
	if byId["conn-2"] != 43200 {
		t.Errorf("expected conn-2 = 43200, got %d", byId["conn-2"])
	}
}
