package cryptography

import "testing"

func TestEncryptedStringCanBeDecryptedWithSameMachineId(t *testing.T) {
	machineId := "machineId"
	plaintext := "plaintext"

	encrypted, err := EncryptBytesForMachine(machineId, []byte(plaintext))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	decrypted, err := DecryptBytesForMachine(machineId, []byte(encrypted))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if string(decrypted) != plaintext {
		t.Errorf("expected decrypted to be %s, got %s", plaintext, decrypted)
	}
}

func TestEncryptedStringCannotBeDecryptedWithWrongMachineId(t *testing.T) {
	machineId := "machineId"
	plaintext := "plaintext"

	encrypted, err := EncryptBytesForMachine(machineId, []byte(plaintext))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	decrypted, err := DecryptBytesForMachine("wrongMachineId", []byte(encrypted))
	if err == nil {
		t.Fatalf("expected error, got nil")
	}

	if string(decrypted) == plaintext {

	}
}
