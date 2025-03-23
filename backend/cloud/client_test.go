package cloud

import (
	"encoding/json"
	"testing"
)

type expectedAuthCheckRes struct {
	Status string `json:"status"`
}

func TestClientIsAuthorised(t *testing.T) {
	client := GetClient()
	if client == nil {
		t.Errorf("Error getting client")
	}
	res, err := client.R().Get("/api/cv1/auth-check")
	if err != nil {
		t.Errorf("Error getting response: %v", err)
	}
	if res.StatusCode() != 200 {
		t.Errorf("Expected status code 200, got %v", res.StatusCode())
	}

	expectedRes := expectedAuthCheckRes{}
	err = json.Unmarshal(res.Body(), &expectedRes)
	if err != nil {
		t.Errorf("Error unmarshalling response: %v", err)
	}

	if expectedRes.Status != "ok" {
		t.Errorf("Expected status ok, got %v", expectedRes.Status)
	}

}
