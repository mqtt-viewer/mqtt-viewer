package cryptography

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"fmt"
)

func DecryptBytesForMachine(machineId string, ciphertext []byte) ([]byte, error) {

	base64DecodedCipher := make([]byte, base64.RawStdEncoding.DecodedLen(len(ciphertext)))
	_, err := base64.RawStdEncoding.Decode(base64DecodedCipher, ciphertext)
	if err != nil {
		return nil, err
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
	nonceSize := gcm.NonceSize()
	if len(base64DecodedCipher) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}
	nonce, base64DecodedCipher := base64DecodedCipher[:nonceSize], base64DecodedCipher[nonceSize:]

	plaintext, err := gcm.Open(nil, []byte(nonce), []byte(base64DecodedCipher), nil)
	if err != nil {
		return nil, err
	}

	return plaintext, nil
}
