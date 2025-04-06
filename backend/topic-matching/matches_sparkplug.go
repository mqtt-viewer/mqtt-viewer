package topicmatching

var sparkplugAPrefix = "spAv1.0/"
var sparkplugBPrefix = "spBv1.0/"

func MatchesSparkplugBPrefix(topic string) bool {
	if len(topic) < 8 {
		return false
	}
	return topic[0:8] == sparkplugBPrefix
}

func MatchesSparkplugAPrefix(topic string) bool {
	if len(topic) < 8 {
		return false
	}
	return topic[0:8] == sparkplugAPrefix
}
