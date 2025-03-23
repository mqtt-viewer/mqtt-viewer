package security

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"log/slog"
	"os"
)

type BuildTlsParams struct {
	SkipCertVerification bool
	CertCaPath           string
	CertClientPath       string
	CertClientKeyPath    string
}

func BuildTlsConfig(params BuildTlsParams) (*tls.Config, error) {
	slog.Debug(fmt.Sprintf("Building tls config with params %+v", params))
	res := tls.Config{
		Certificates: []tls.Certificate{},
	}
	if params.CertClientPath != "" && params.CertClientKeyPath != "" {
		clientCert, err := tls.LoadX509KeyPair(
			params.CertClientPath,
			params.CertClientKeyPath,
		)
		if err != nil {
			return nil, newBuildTlsConfigError(err)
		}
		res.Certificates = append(res.Certificates, clientCert)
	} else if params.CertClientPath != "" || params.CertClientKeyPath != "" {
		return nil, newBuildTlsConfigError(errors.New("both client cert and client key must be provided"))
	}

	if params.CertCaPath != "" {
		rootCertPEM, err := os.ReadFile(params.CertCaPath)
		if err != nil {
			return nil, newBuildTlsConfigError(err)
		}
		certPool := x509.NewCertPool()
		ok := certPool.AppendCertsFromPEM(rootCertPEM)
		if !ok {
			return nil, newBuildTlsConfigError(errors.New("failed to parse ca certificate"))
		}
		res.RootCAs = certPool
	}
	if params.SkipCertVerification {
		res.InsecureSkipVerify = true
	}

	return &res, nil
}

func newBuildTlsConfigError(err error) error {
	return errors.New("failed to build tls config: " + err.Error())
}
