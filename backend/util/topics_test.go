package util

import "testing"

func TestRouteMatchesTopicSharedSubscriptions(t *testing.T) {
	cases := []struct {
		route string
		topic string
		want  bool
	}{
		{"$share/group/a/b", "a/b", true},
		{"$share/group/#", "a/b", true},
		{"$share/group/a/b", "b", false},
		// Not shared subscriptions: matched literally and must never panic.
		{"$share", "a", false},
		{"$share", "$share", true},
		{"$shared", "a", false},
		{"$share/group", "group", false},
		{"$shareX/a/b", "b", false},
		{"$shareX/a/b", "$shareX/a/b", true},
	}
	for _, c := range cases {
		if got := RouteMatchesTopic(c.route, c.topic); got != c.want {
			t.Errorf("RouteMatchesTopic(%q, %q) = %v, want %v", c.route, c.topic, got, c.want)
		}
	}
}
