package app

import (
	"errors"
	"mqtt-viewer/backend/cryptography"
	"mqtt-viewer/backend/env"
	"testing"
)

func storedPassword(t *testing.T, app *App, id uint) string {
	t.Helper()
	var password string
	if err := app.Db.Raw("SELECT password FROM connections WHERE id = ?", id).Scan(&password).Error; err != nil {
		t.Fatalf("reading stored password: %v", err)
	}
	return password
}

func assertStoredPasswordEncrypts(t *testing.T, app *App, id uint, plaintext string) {
	t.Helper()
	stored := storedPassword(t, app, id)
	if stored == plaintext {
		t.Fatalf("password stored in plaintext")
	}
	decrypted, err := cryptography.DecryptBytesForMachine(env.MachineId, []byte(stored))
	if err != nil {
		t.Fatalf("stored password does not decrypt: %v", err)
	}
	if string(decrypted) != plaintext {
		t.Fatalf("expected stored password to decrypt to %q, got %q", plaintext, decrypted)
	}
}

// The frontend holds the decrypted password and sends it back on every save,
// so saving a connection without touching its password (a rename, say) must
// still store it encrypted.
func TestUpdateConnectionKeepsUnchangedPasswordEncrypted(t *testing.T) {
	app := getTestApp(t)
	created, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	id := created.ConnectionDetails.ID
	// Starts with a character outside the base64 alphabet, which is what
	// produced "illegal base64 data at input byte 0" in the v1.0.0 log.
	const password = "!s3cret"

	conn := app.GetAllConnections().Connections[id].ConnectionDetails
	pw := password
	conn.Password = &pw
	if err := app.UpdateConnection(&conn); err != nil {
		t.Fatalf("setting password: %v", err)
	}
	assertStoredPasswordEncrypts(t, app, id, password)

	conn = app.GetAllConnections().Connections[id].ConnectionDetails
	if conn.Password == nil || *conn.Password != password {
		t.Fatalf("expected loaded password %q, got %v", password, conn.Password)
	}
	conn.Name = "Renamed"
	if err := app.UpdateConnection(&conn); err != nil {
		t.Fatalf("renaming connection: %v", err)
	}
	assertStoredPasswordEncrypts(t, app, id, password)

	conn = app.GetAllConnections().Connections[id].ConnectionDetails
	if conn.Password == nil || *conn.Password != password {
		t.Fatalf("expected loaded password %q after rename, got %v", password, conn.Password)
	}
}

// Rows already written in the clear by the old UpdateConnection are encrypted
// on the next start, and still load with the right password.
func TestPlaintextPasswordsAreEncryptedOnStartup(t *testing.T) {
	app := getTestApp(t)
	cases := map[string]uint{}
	for _, password := range []string{"!s3cret", "password123", "a-much-longer-passphrase-with-symbols!"} {
		created, err := app.NewConnection()
		if err != nil {
			t.Fatalf("creating connection: %v", err)
		}
		id := created.ConnectionDetails.ID
		if err := app.Db.Exec("UPDATE connections SET password = ? WHERE id = ?", password, id).Error; err != nil {
			t.Fatalf("writing plaintext password: %v", err)
		}
		cases[password] = id
	}

	app2 := reopenTestApp(t, app)
	conns := app2.GetAllConnections().Connections
	for password, id := range cases {
		assertStoredPasswordEncrypts(t, app2, id, password)
		loaded := conns[id].ConnectionDetails.Password
		if loaded == nil || *loaded != password {
			t.Errorf("expected loaded password %q, got %v", password, loaded)
		}
	}
}

// A password encrypted on another machine cannot be recovered here, and must
// not be encrypted a second time on top, on startup or on save.
func TestForeignCiphertextIsLeftAloneOnStartup(t *testing.T) {
	app := getTestApp(t)
	created, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	id := created.ConnectionDetails.ID
	foreign, err := cryptography.EncryptBytesForMachine("another-machine", []byte("secret"))
	if err != nil {
		t.Fatalf("encrypting: %v", err)
	}
	if err := app.Db.Exec("UPDATE connections SET password = ? WHERE id = ?", foreign, id).Error; err != nil {
		t.Fatalf("writing foreign ciphertext: %v", err)
	}

	app2 := reopenTestApp(t, app)
	if stored := storedPassword(t, app2, id); stored != foreign {
		t.Fatalf("expected foreign ciphertext to be left unchanged on startup, got %q", stored)
	}

	// Saving the connection sends the undecryptable value straight back.
	conn := app2.GetAllConnections().Connections[id].ConnectionDetails
	conn.Name = "Renamed"
	if err := app2.UpdateConnection(&conn); err != nil {
		t.Fatalf("renaming connection: %v", err)
	}
	if stored := storedPassword(t, app2, id); stored != foreign {
		t.Fatalf("expected foreign ciphertext to be left unchanged on save, got %q", stored)
	}
}

// Known limit, kept as documentation rather than a fix. A plaintext password
// of 38 or more characters drawn only from the base64 alphabet (at a length
// that decodes as unpadded base64, so not 41, 45, ...), written in
// the clear before 1.2, decodes as base64 to at least a nonce and a tag, then
// fails authentication: exactly what ciphertext from another machine does.
// Without that machine's key the two cannot be told apart, so it is left in
// the clear on startup and on an unchanged save. It still loads and connects
// with the right password, and is encrypted once the password is changed.
func TestBase64LookingPlaintextPasswordStaysInTheClear(t *testing.T) {
	app := getTestApp(t)
	created, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	id := created.ConnectionDetails.ID
	const password = "Abcdefghijklmnopqrstuvwxyz0123456789ABCD" // 40 chars
	if err := app.Db.Exec("UPDATE connections SET password = ? WHERE id = ?", password, id).Error; err != nil {
		t.Fatalf("writing plaintext password: %v", err)
	}
	if _, err := cryptography.DecryptBytesForMachine(env.MachineId, []byte(password)); err == nil ||
		errors.Is(err, cryptography.ErrNotCiphertext) {
		t.Fatalf("expected the password to look like foreign ciphertext, got %v", err)
	}

	app2 := reopenTestApp(t, app)
	if stored := storedPassword(t, app2, id); stored != password {
		t.Fatalf("expected startup to leave it alone, got %q", stored)
	}

	conn := app2.GetAllConnections().Connections[id].ConnectionDetails
	if conn.Password == nil || *conn.Password != password {
		t.Fatalf("expected loaded password %q, got %v", password, conn.Password)
	}
	conn.Name = "Renamed"
	if err := app2.UpdateConnection(&conn); err != nil {
		t.Fatalf("renaming connection: %v", err)
	}
	if stored := storedPassword(t, app2, id); stored != password {
		t.Fatalf("expected an unchanged save to leave it alone, got %q", stored)
	}

	// Changing it encrypts it.
	const changed = password + "EF"
	pw := changed
	conn.Password = &pw
	if err := app2.UpdateConnection(&conn); err != nil {
		t.Fatalf("changing password: %v", err)
	}
	assertStoredPasswordEncrypts(t, app2, id, changed)
}
