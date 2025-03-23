package machine

import (
	mid "github.com/denisbrodbeck/machineid"
)

var (
	TMachineIdLicenseValid        = "KAIUHIGA55DFYG66DGHJVDAFFF-valid"
	TMachineIdLicenseTrial        = "KAIUHIGA55DFYG66DGHJVDAFFF-trial"
	TMachineIdLicenseTrialExpired = "KAIUHIGA55DFYG66DG-trial-expired"
	TMachineIdLicenseInvalid      = "KAIUHIGA55DFYG66DGHJVDAF-invalid"
	TMachineIdLicenseExpired      = "KAIUHIGA55DFYG66DGHJVDAF-expired"
	TMachineIdLicenseUsed1        = "KAIUHIGA55DFYG66DGHJVDAFFF-used1"
	TMachineIdLicenseUsed2        = "KAIUHIGA55DFYG66DGHJVDAFFF-used2"
)

func GetMachineId(protectStr string) (string, error) {
	id, err := mid.ProtectedID(protectStr)
	if err != nil {
		return "", err
	}
	return id, nil
}
