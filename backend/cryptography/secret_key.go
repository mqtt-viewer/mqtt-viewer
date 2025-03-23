package cryptography

import "fmt"

func get32ByteSecretKeyFromMachineId(machineId string) ([]byte, error) {
	if machineId == "" {
		return []byte{}, fmt.Errorf("machine id is empty")
	}
	var result []byte
	for i := range 32 {
		result = append(result, machineId[i%len(machineId)])
	}
	return result, nil
}
