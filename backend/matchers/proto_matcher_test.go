package matchers

import "testing"

func TestProtoMatcherDoesNotMatch(t *testing.T) {
	pm := GetTestProtoMatcher(t)
	topic := "topic/no-proto"
	if pm.GetMatchingProtoDescriptor(topic) != nil {
		t.Errorf("Expected no match, got match")
	}
	topic = "kwhbkw"
	if pm.GetMatchingProtoDescriptor(topic) != nil {
		t.Errorf("Expected no match, got match")
	}
}

func TestProtoMatcherDoesMatch(t *testing.T) {
	pm := GetTestProtoMatcher(t)
	topic := "topic/proto"
	descriptor := pm.GetMatchingProtoDescriptor(topic)
	if descriptor == nil {
		t.Errorf("Expected match, got no match")
	}
	if descriptor.FullName() != "test.HelloMessage" {
		t.Errorf("Expected match for test.HelloMessage, got %s", descriptor.FullName())
	}
	topic = "topic/proto/complex"
	descriptor = pm.GetMatchingProtoDescriptor(topic)
	if descriptor == nil {
		t.Errorf("Expected match, got no match")
	}
	if descriptor.FullName() != "complex.Employee" {
		t.Errorf("Expected match for test.ComplexMessage, got %s", descriptor.FullName())
	}

	descriptor = pm.GetMatchingProtoDescriptor(topic)
	if descriptor == nil {
		t.Errorf("Expected match, got no match")
	}
	if descriptor.FullName() != "complex.Employee" {
		t.Errorf("Expected match for test.ComplexMessage, got %s", descriptor.FullName())
	}

	descriptor = pm.GetMatchingProtoDescriptor(topic)
	if descriptor == nil {
		t.Errorf("Expected match, got no match")
	}
	if descriptor.FullName() != "complex.Employee" {
		t.Errorf("Expected match for test.ComplexMessage, got %s", descriptor.FullName())
	}

}
