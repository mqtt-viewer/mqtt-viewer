package models

import (
	"mqtt-viewer/backend/cryptography"
	"mqtt-viewer/backend/env"
	"testing"
)

func TestDecryptPasswordRoundTrip(t *testing.T) {
	plaintext := "super-secret"
	encrypted, err := cryptography.EncryptBytesForMachine(env.MachineId, []byte(plaintext))
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}

	conn := Connection{Password: &encrypted}
	if err := conn.decryptPassword(nil); err != nil {
		t.Fatalf("decryptPassword failed: %v", err)
	}
	if conn.Password == nil || *conn.Password != plaintext {
		t.Fatalf("expected decrypted password %q, got %v", plaintext, conn.Password)
	}
}

func TestDecryptPasswordNilAndEmpty(t *testing.T) {
	conn := Connection{Password: nil}
	if err := conn.decryptPassword(nil); err != nil {
		t.Fatalf("nil password should be a no-op, got error: %v", err)
	}
	if conn.Password != nil {
		t.Fatalf("nil password should stay nil, got %v", *conn.Password)
	}

	empty := ""
	conn = Connection{Password: &empty}
	if err := conn.decryptPassword(nil); err != nil {
		t.Fatalf("empty password should be a no-op, got error: %v", err)
	}
	if conn.Password == nil || *conn.Password != "" {
		t.Fatalf("empty password should stay empty, got %v", conn.Password)
	}
}
