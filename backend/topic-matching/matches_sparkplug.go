package topicmatching

var sparkplugAPrefix = "spAv1.0/"
var sparkplugBPrefix = "spBv1.0/"

func MatchesSparkplugBPrefix(topic string) bool {
	return topic[0:8] == sparkplugBPrefix
}

func MatchesSparkplugAPrefix(topic string) bool {
	return topic[0:8] == sparkplugAPrefix
}
