package topicmatching

import (
	"fmt"
	"testing"

	"mqtt-viewer/backend/models"
)

func rule(id uint, filter, msgType string, sortOrder int) models.ProtoBindingRule {
	return models.ProtoBindingRule{ID: id, TopicFilter: filter, MessageType: msgType, SortOrder: sortOrder}
}

func TestMatchSpecificity(t *testing.T) {
	tests := []struct {
		name       string
		rules      []models.ProtoBindingRule
		topic      string
		wantType   string
		wantFilter string
		wantSource string
	}{
		{
			name: "literal segment beats single-level wildcard",
			rules: []models.ProtoBindingRule{
				rule(1, "sensors/#", "TypeHash", 0),
				rule(2, "sensors/+/telemetry", "TypePlus", 0),
			},
			topic:      "sensors/room1/telemetry",
			wantType:   "TypePlus",
			wantFilter: "sensors/+/telemetry",
			wantSource: SourceRule,
		},
		{
			name: "literal beats plus",
			rules: []models.ProtoBindingRule{
				rule(1, "sensors/+/telemetry", "TypePlus", 0),
				rule(2, "sensors/room1/telemetry", "TypeLiteral", 0),
			},
			topic:      "sensors/room1/telemetry",
			wantType:   "TypeLiteral",
			wantFilter: "sensors/room1/telemetry",
			wantSource: SourceRule,
		},
		{
			name: "a/+/+ beats a/#",
			rules: []models.ProtoBindingRule{
				rule(1, "a/#", "TypeHash", 0),
				rule(2, "a/+/+", "TypePlusPlus", 0),
			},
			topic:      "a/b/c",
			wantType:   "TypePlusPlus",
			wantFilter: "a/+/+",
			wantSource: SourceRule,
		},
		{
			name: "tie broken by sort order",
			rules: []models.ProtoBindingRule{
				rule(1, "a/b", "TypeSecond", 5),
				rule(2, "a/b", "TypeFirst", 1),
			},
			topic:      "a/b",
			wantType:   "TypeFirst",
			wantFilter: "a/b",
			wantSource: SourceRule,
		},
		{
			name: "tie broken by id when sort order equal",
			rules: []models.ProtoBindingRule{
				rule(9, "a/b", "TypeHigherID", 1),
				rule(3, "a/b", "TypeLowerID", 1),
			},
			topic:      "a/b",
			wantType:   "TypeLowerID",
			wantFilter: "a/b",
			wantSource: SourceRule,
		},
		{
			name: "sport/# matches bare topic sport (util semantics)",
			rules: []models.ProtoBindingRule{
				rule(1, "sport/#", "TypeSport", 0),
			},
			topic:      "sport",
			wantType:   "TypeSport",
			wantFilter: "sport/#",
			wantSource: SourceRule,
		},
		{
			name: "ranking stays coherent with sport/# vs sport/+",
			rules: []models.ProtoBindingRule{
				rule(1, "sport/#", "TypeHash", 0),
				rule(2, "sport/tennis", "TypeLiteral", 0),
			},
			topic:      "sport/tennis",
			wantType:   "TypeLiteral",
			wantFilter: "sport/tennis",
			wantSource: SourceRule,
		},
		{
			name: "bare hash user rule does not match dollar topic",
			rules: []models.ProtoBindingRule{
				rule(1, "#", "TypeAll", 0),
			},
			topic:      "$SYS/broker/uptime",
			wantType:   "",
			wantFilter: "",
			wantSource: "",
		},
		{
			name: "explicit dollar sys filter with literal first segment matches",
			rules: []models.ProtoBindingRule{
				rule(1, "$SYS/#", "TypeSys", 0),
			},
			topic:      "$SYS/broker/uptime",
			wantType:   "TypeSys",
			wantFilter: "$SYS/#",
			wantSource: SourceRule,
		},
		{
			name: "implicit sparkplug B resolves with no user rules present but other rules exist",
			rules: []models.ProtoBindingRule{
				rule(1, "unrelated/topic", "TypeUnrelated", 0),
			},
			topic:      "spBv1.0/G/NBIRTH/N",
			wantType:   sparkplugBMessageType,
			wantFilter: sparkplugBFilter,
			wantSource: SourceSparkplug,
		},
		{
			name: "explicit user rule on spBv1.0/# outranks implicit sparkplug on sort order tie",
			rules: []models.ProtoBindingRule{
				rule(1, sparkplugBFilter, "CustomSparkplugB", 0),
			},
			topic:      "spBv1.0/G/NBIRTH/N",
			wantType:   "CustomSparkplugB",
			wantFilter: sparkplugBFilter,
			wantSource: SourceRule,
		},
		{
			name: "bare hash user rule loses to implicit sparkplug on sparkplug topics",
			rules: []models.ProtoBindingRule{
				rule(1, "#", "TypeAll", 0),
			},
			topic:      "spBv1.0/G/NBIRTH/N",
			wantType:   sparkplugBMessageType,
			wantFilter: sparkplugBFilter,
			wantSource: SourceSparkplug,
		},
		{
			name: "bare hash user rule wins on non-sparkplug topics",
			rules: []models.ProtoBindingRule{
				rule(1, "#", "TypeAll", 0),
			},
			topic:      "foo/bar",
			wantType:   "TypeAll",
			wantFilter: "#",
			wantSource: SourceRule,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := NewProtoBindingMatcher(tt.rules)
			got := m.Match(tt.topic)
			want := ProtoBindingMatch{MessageType: tt.wantType, Filter: tt.wantFilter, Source: tt.wantSource}
			if got != want {
				t.Errorf("Match(%q) = %+v, want %+v", tt.topic, got, want)
			}
		})
	}
}

func TestMatchImplicitSparkplugRankingNoUserRules(t *testing.T) {
	m := NewProtoBindingMatcher(nil)

	got := m.Match("spBv1.0/G/NBIRTH/N")
	want := ProtoBindingMatch{MessageType: sparkplugBMessageType, Filter: sparkplugBFilter, Source: SourceSparkplug}
	if got != want {
		t.Errorf("Match(spBv1.0/...) = %+v, want %+v", got, want)
	}

	gotA := m.Match("spAv1.0/G/DBIRTH/N")
	wantA := ProtoBindingMatch{MessageType: sparkplugAMessageType, Filter: sparkplugAFilter, Source: SourceSparkplug}
	if gotA != wantA {
		t.Errorf("Match(spAv1.0/...) = %+v, want %+v", gotA, wantA)
	}

	gotNone := m.Match("foo/bar")
	if gotNone != (ProtoBindingMatch{}) {
		t.Errorf("Match(foo/bar) = %+v, want zero value", gotNone)
	}
}

func TestSetRulesClearsCache(t *testing.T) {
	m := NewProtoBindingMatcher([]models.ProtoBindingRule{
		rule(1, "a/b", "TypeOld", 0),
	})

	got := m.Match("a/b")
	want := ProtoBindingMatch{MessageType: "TypeOld", Filter: "a/b", Source: SourceRule}
	if got != want {
		t.Fatalf("Match before SetRules = %+v, want %+v", got, want)
	}

	// Without SetRules, a stale cache entry would keep returning TypeOld.
	m.SetRules([]models.ProtoBindingRule{
		rule(2, "a/b", "TypeNew", 0),
	})

	got = m.Match("a/b")
	want = ProtoBindingMatch{MessageType: "TypeNew", Filter: "a/b", Source: SourceRule}
	if got != want {
		t.Errorf("Match after SetRules = %+v, want %+v", got, want)
	}
}

func TestMatchCacheOverflowClearsAndStaysCorrect(t *testing.T) {
	m := NewProtoBindingMatcher([]models.ProtoBindingRule{
		rule(1, "sensors/+/telemetry", "TypePlus", 0),
		rule(2, "sensors/room1/telemetry", "TypeLiteral", 0),
	})

	for i := 0; i < maxCacheEntries+500; i++ {
		topic := fmt.Sprintf("filler/%d", i)
		m.Match(topic)
	}

	if len(m.cache) > maxCacheEntries {
		t.Errorf("Expected cache to have been cleared on overflow, len=%v", len(m.cache))
	}

	got := m.Match("sensors/room1/telemetry")
	want := ProtoBindingMatch{MessageType: "TypeLiteral", Filter: "sensors/room1/telemetry", Source: SourceRule}
	if got != want {
		t.Errorf("Match after cache overflow = %+v, want %+v", got, want)
	}

	gotPlus := m.Match("sensors/room2/telemetry")
	wantPlus := ProtoBindingMatch{MessageType: "TypePlus", Filter: "sensors/+/telemetry", Source: SourceRule}
	if gotPlus != wantPlus {
		t.Errorf("Match after cache overflow = %+v, want %+v", gotPlus, wantPlus)
	}
}

func TestMatchUncachedDoesNotPopulateCache(t *testing.T) {
	m := NewProtoBindingMatcher([]models.ProtoBindingRule{
		rule(1, "a/b", "TypeA", 0),
	})

	m.MatchUncached("a/b")
	if len(m.cache) != 0 {
		t.Errorf("Expected cache to stay empty after MatchUncached, len=%v", len(m.cache))
	}

	got := m.MatchUncached("a/b")
	want := ProtoBindingMatch{MessageType: "TypeA", Filter: "a/b", Source: SourceRule}
	if got != want {
		t.Errorf("MatchUncached = %+v, want %+v", got, want)
	}
}

func TestMatchEmptyRulesShortCircuitResolvesSparkplug(t *testing.T) {
	m := NewProtoBindingMatcher(nil)

	got := m.Match("spBv1.0/G/NBIRTH/N")
	want := ProtoBindingMatch{MessageType: sparkplugBMessageType, Filter: sparkplugBFilter, Source: SourceSparkplug}
	if got != want {
		t.Errorf("Match = %+v, want %+v", got, want)
	}
	if len(m.cache) != 0 {
		t.Errorf("Expected no cache writes with empty rules, len=%v", len(m.cache))
	}

	m.Match("foo/bar")
	if len(m.cache) != 0 {
		t.Errorf("Expected no cache writes with empty rules for non-sparkplug topics, len=%v", len(m.cache))
	}
}

func TestValidateTopicFilter(t *testing.T) {
	valid := []string{
		"#",
		"a/b/+",
		"+/b/#",
		"a//b",
	}
	for _, filter := range valid {
		t.Run("valid_"+filter, func(t *testing.T) {
			if err := ValidateTopicFilter(filter); err != nil {
				t.Errorf("ValidateTopicFilter(%q) = %v, want nil", filter, err)
			}
		})
	}

	invalid := []string{
		"",
		"a/#/b",
		"a#",
		"+a/b",
		"$share/g/topic",
		" a",
		"a ",
	}
	for _, filter := range invalid {
		t.Run(fmt.Sprintf("invalid_%q", filter), func(t *testing.T) {
			if err := ValidateTopicFilter(filter); err == nil {
				t.Errorf("ValidateTopicFilter(%q) = nil, want error", filter)
			}
		})
	}
}
