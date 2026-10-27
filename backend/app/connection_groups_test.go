package app

import (
	"mqtt-viewer/backend/models"
	"testing"
)

func mustNewGroup(t *testing.T, app *App, name string) models.ConnectionGroup {
	t.Helper()
	group, err := app.NewConnectionGroup(name)
	if err != nil {
		t.Fatalf("creating group %q: %v", name, err)
	}
	return group
}

func loadConnection(t *testing.T, app *App, id uint) models.Connection {
	t.Helper()
	var conn models.Connection
	if err := app.Db.First(&conn, id).Error; err != nil {
		t.Fatalf("loading connection %d: %v", id, err)
	}
	return conn
}

func TestNewConnectionGroupTrimsName(t *testing.T) {
	app := getTestApp(t)
	group := mustNewGroup(t, app, "  Site A  ")
	if group.Name != "Site A" {
		t.Errorf("name = %q, want %q", group.Name, "Site A")
	}
	if group.Collapsed {
		t.Error("new group should not be collapsed")
	}
	if group.ID == 0 {
		t.Error("new group should have an id")
	}
}

func TestNewConnectionGroupRejectsEmptyName(t *testing.T) {
	app := getTestApp(t)
	if _, err := app.NewConnectionGroup("   "); err == nil {
		t.Fatal("expected an error for a blank name")
	}
	groups, err := app.GetConnectionGroups()
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 0 {
		t.Errorf("got %d groups, want 0", len(groups))
	}
}

func TestGetConnectionGroupsSortsByNameIgnoringCase(t *testing.T) {
	app := getTestApp(t)
	mustNewGroup(t, app, "beta")
	mustNewGroup(t, app, "Alpha")
	mustNewGroup(t, app, "alpha")
	groups, err := app.GetConnectionGroups()
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, g := range groups {
		names = append(names, g.Name)
	}
	want := []string{"Alpha", "alpha", "beta"}
	if len(names) != len(want) {
		t.Fatalf("names = %v, want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("names = %v, want %v", names, want)
		}
	}
}

func TestRenameConnectionGroup(t *testing.T) {
	app := getTestApp(t)
	group := mustNewGroup(t, app, "Site A")

	renamed, err := app.RenameConnectionGroup(group.ID, " Site B ")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Name != "Site B" {
		t.Errorf("returned name = %q, want %q", renamed.Name, "Site B")
	}
	groups, _ := app.GetConnectionGroups()
	if groups[0].Name != "Site B" {
		t.Errorf("persisted name = %q, want %q", groups[0].Name, "Site B")
	}

	if _, err := app.RenameConnectionGroup(group.ID, ""); err == nil {
		t.Error("expected an error renaming to an empty name")
	}
	groups, _ = app.GetConnectionGroups()
	if groups[0].Name != "Site B" {
		t.Errorf("name after failed rename = %q, want %q", groups[0].Name, "Site B")
	}

	if _, err := app.RenameConnectionGroup(999, "Nope"); err == nil {
		t.Error("expected an error renaming a missing group")
	}
}

func TestSetConnectionGroupCollapsedPersists(t *testing.T) {
	app := getTestApp(t)
	group := mustNewGroup(t, app, "Site A")

	if err := app.SetConnectionGroupCollapsed(group.ID, true); err != nil {
		t.Fatal(err)
	}
	groups, _ := app.GetConnectionGroups()
	if !groups[0].Collapsed {
		t.Error("group should be collapsed")
	}
	if err := app.SetConnectionGroupCollapsed(group.ID, false); err != nil {
		t.Fatal(err)
	}
	groups, _ = app.GetConnectionGroups()
	if groups[0].Collapsed {
		t.Error("group should be expanded")
	}
}

func TestSetConnectionGroupAssignsAndClears(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	group := mustNewGroup(t, app, "Site A")

	if err := app.SetConnectionGroup(connID, &group.ID); err != nil {
		t.Fatal(err)
	}
	if got := loadConnection(t, app, connID).GroupID; got == nil || *got != group.ID {
		t.Errorf("GroupID = %v, want %d", got, group.ID)
	}

	if err := app.SetConnectionGroup(connID, nil); err != nil {
		t.Fatal(err)
	}
	if got := loadConnection(t, app, connID).GroupID; got != nil {
		t.Errorf("GroupID = %v, want nil", *got)
	}
}

func TestSetConnectionGroupRejectsMissingGroupOrConnection(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	group := mustNewGroup(t, app, "Site A")

	if err := app.SetConnectionGroup(connID, uintPtr(999)); err == nil {
		t.Error("expected an error for a missing group")
	}
	if got := loadConnection(t, app, connID).GroupID; got != nil {
		t.Errorf("GroupID = %v, want nil", *got)
	}
	if err := app.SetConnectionGroup(999, &group.ID); err == nil {
		t.Error("expected an error for a missing connection")
	}
}

func TestDeleteConnectionGroupUngroupsConnections(t *testing.T) {
	app, connA := getTestAppWithConnection(t)
	second, err := app.NewConnection()
	if err != nil {
		t.Fatal(err)
	}
	connB := second.ConnectionDetails.ID
	group := mustNewGroup(t, app, "Site A")
	for _, id := range []uint{connA, connB} {
		if err := app.SetConnectionGroup(id, &group.ID); err != nil {
			t.Fatal(err)
		}
	}

	if err := app.DeleteConnectionGroup(group.ID); err != nil {
		t.Fatal(err)
	}

	groups, _ := app.GetConnectionGroups()
	if len(groups) != 0 {
		t.Errorf("got %d groups, want 0", len(groups))
	}
	for _, id := range []uint{connA, connB} {
		if got := loadConnection(t, app, id).GroupID; got != nil {
			t.Errorf("connection %d GroupID = %d, want nil", id, *got)
		}
	}
}

func TestUpdateConnectionLeavesGroupAlone(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	groupA := mustNewGroup(t, app, "A")
	groupB := mustNewGroup(t, app, "B")
	if err := app.SetConnectionGroup(connID, &groupA.ID); err != nil {
		t.Fatal(err)
	}

	for i, stale := range []*uint{nil, &groupB.ID} {
		conn := loadConnection(t, app, connID)
		conn.Name = []string{"First", "Second"}[i]
		conn.GroupID = stale
		if err := app.UpdateConnection(&conn); err != nil {
			t.Fatal(err)
		}
		got := loadConnection(t, app, connID)
		if got.Name != conn.Name {
			t.Errorf("name = %q, want %q", got.Name, conn.Name)
		}
		if got.GroupID == nil || *got.GroupID != groupA.ID {
			t.Errorf("GroupID = %v, want %d", got.GroupID, groupA.ID)
		}
	}
}

func TestNewConnectionIsUngrouped(t *testing.T) {
	app := getTestApp(t)
	mustNewGroup(t, app, "A")
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatal(err)
	}
	if conn.ConnectionDetails.GroupID != nil {
		t.Errorf("GroupID = %d, want nil", *conn.ConnectionDetails.GroupID)
	}
}
