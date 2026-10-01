package cryptography

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"errors"
	"fmt"
)

// ErrNotCiphertext means the input could never have come from
// EncryptBytesForMachine: it is not valid base64 or is too short to hold a
// nonce and tag. A value that decodes but fails authentication is a
// different case (encrypted on another machine) and does not wrap this error.
var ErrNotCiphertext = errors.New("not ciphertext")

func DecryptBytesForMachine(machineId string, ciphertext []byte) ([]byte, error) {

	base64DecodedCipher := make([]byte, base64.RawStdEncoding.DecodedLen(len(ciphertext)))
	_, err := base64.RawStdEncoding.Decode(base64DecodedCipher, ciphertext)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrNotCiphertext, err)
	}

	secretKey, err := get32ByteSecretKeyFromMachineId(machineId)
	if err != nil {
		return nil, err
	}
	aes, err := aes.NewCipher([]byte(secretKey))
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(aes)
	if err != nil {
		return nil, err
	}

	// Since we know the ciphertext is actually nonce+ciphertext
	// And len(nonce) == NonceSize(). We can separate the two.
	// Even an empty plaintext seals to nonce+tag, so anything shorter was
	// never ciphertext.
	nonceSize := gcm.NonceSize()
	if len(base64DecodedCipher) < nonceSize+gcm.Overhead() {
		return nil, fmt.Errorf("%w: ciphertext too short", ErrNotCiphertext)
	}
	nonce, base64DecodedCipher := base64DecodedCipher[:nonceSize], base64DecodedCipher[nonceSize:]

	plaintext, err := gcm.Open(nil, []byte(nonce), []byte(base64DecodedCipher), nil)
	if err != nil {
		return nil, err
	}

	return plaintext, nil
}
