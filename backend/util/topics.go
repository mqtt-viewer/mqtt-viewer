package util

import "strings"

// Using functions from https://github.com/eclipse/paho.mqtt.golang/blob/master/router.go#L42
func RouteMatchesTopic(route, topic string) bool {
	return match(routeSplit(route), strings.Split(topic, "/"))
}

func match(route []string, topic []string) bool {
	if len(route) == 0 {
		return len(topic) == 0
	}

	if len(topic) == 0 {
		return route[0] == "#"
	}

	if route[0] == "#" {
		return true
	}

	if (route[0] == "+") || (route[0] == topic[0]) {
		return match(route[1:], topic[1:])
	}
	return false
}

// removes $share and sharename when splitting the route to allow
// shared subscription routes to correctly match the topic. Only a real
// shared subscription ($share/<group>/<filter>, so at least three segments)
// is stripped; "$share", "$share/group" or "$shareX/a/b" are matched as
// ordinary filters.
func routeSplit(route string) []string {
	result := strings.Split(route, "/")
	if len(result) >= 3 && result[0] == "$share" {
		return result[2:]
	}
	return result
}
