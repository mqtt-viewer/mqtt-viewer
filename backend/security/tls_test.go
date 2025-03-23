package security

import (
	"path"
	"runtime"
	"testing"
)

var _, filename, _, _ = runtime.Caller(0)
var dir = path.Dir(filename)

func TestBuildTlsConfigWithGoodCerts(t *testing.T) {

	params := BuildTlsParams{
		CertCaPath:        path.Join(dir, "./test-certs/testGoodCa.pem"),
		CertClientPath:    path.Join(dir, "./test-certs/testGoodCert.pem"),
		CertClientKeyPath: path.Join(dir, "./test-certs/testGoodKey.pem"),
	}
	res, err := BuildTlsConfig(params)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
		return
	}
	if len(res.Certificates) != 1 {
		t.Errorf("Expected 1 cert, got %v", len(res.Certificates))
	}
	if res.RootCAs == nil {
		t.Errorf("Expected CA cert, got nil")
	}
}

func TestBuildTlsConfigWithGoodCa(t *testing.T) {

	params := BuildTlsParams{
		CertCaPath: path.Join(dir, "./test-certs/testGoodCa.pem"),
	}
	res, err := BuildTlsConfig(params)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
		return
	}
	if len(res.Certificates) != 0 {
		t.Errorf("Expected no client cert, got %v", res.Certificates)
	}
	if res.RootCAs == nil {
		t.Errorf("Expected CA cert, got nil")
	}
}

func TestBuildTlsConfigWithBadCa(t *testing.T) {
	params := BuildTlsParams{
		CertCaPath: path.Join(dir, "./test-certs/testBadCa.pem"),
	}
	_, err := BuildTlsConfig(params)
	if err == nil {
		t.Errorf("Expected an error, got no error")
	}
}

func TestBuildTlsConfigMissingClientKey(t *testing.T) {
	params := BuildTlsParams{
		CertClientPath: path.Join(dir, "./test-certs/testGoodCert.pem"),
	}
	_, err := BuildTlsConfig(params)
	if err == nil {
		t.Errorf("Expected an error, got no error")
	}
}

func TestBuildTlsConfigMissingClientCert(t *testing.T) {
	params := BuildTlsParams{
		CertClientKeyPath: path.Join(dir, "./test-certs/testGoodKey.pem"),
	}
	_, err := BuildTlsConfig(params)
	if err == nil {
		t.Errorf("Expected an error, got no error")
	}
}

func TestBuildTlsConfigBadCertGoodKey(t *testing.T) {
	params := BuildTlsParams{
		CertClientPath:    path.Join(dir, "./test-certs/testBadCert.pem"),
		CertClientKeyPath: path.Join(dir, "./test-certs/testGoodKey.pem"),
	}
	_, err := BuildTlsConfig(params)
	if err == nil {
		t.Errorf("Expected an error, got no error")
	}
}

func TestBuildTlsConfigGoodCertBadKey(t *testing.T) {
	params := BuildTlsParams{
		CertClientPath:    path.Join(dir, "./test-certs/testGoodCert.pem"),
		CertClientKeyPath: path.Join(dir, "./test-certs/testBadKey.pem"),
	}
	_, err := BuildTlsConfig(params)
	if err == nil {
		t.Errorf("Expected an error, got no error")
	}
}

func TestBuildTlsConfigCaBadPath(t *testing.T) {
	params := BuildTlsParams{
		CertCaPath: path.Join(dir, "./hello-world.pem"),
	}
	_, err := BuildTlsConfig(params)
	if err == nil {
		t.Errorf("Expected an error, got no error")
	}
}

func TestBuildTlsConfigCertBadPath(t *testing.T) {
	params := BuildTlsParams{
		CertCaPath:        path.Join(dir, "./test-certs/testGoodCa.pem"),
		CertClientPath:    path.Join(dir, "./test-certs/testGoodCert.pem"),
		CertClientKeyPath: path.Join(dir, "./test-certs/nofile.pem"),
	}
	_, err := BuildTlsConfig(params)
	if err == nil {
		t.Errorf("Expected an error, got no error")
	}
}

func TestBuildTlsConfigWithNoCerts(t *testing.T) {

	params := BuildTlsParams{}
	_, err := BuildTlsConfig(params)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
}
