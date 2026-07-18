package sparkplug

import "testing"

func TestParseTopic(t *testing.T) {
	cases := []struct {
		name  string
		topic string
		want  TopicInfo
		ok    bool
	}{
		{
			name:  "NBIRTH",
			topic: "spBv1.0/EnergyCo/NBIRTH/substation-7",
			want:  TopicInfo{Group: "EnergyCo", Type: MessageTypeNBirth, EdgeNode: "substation-7"},
			ok:    true,
		},
		{
			name:  "NDEATH",
			topic: "spBv1.0/EnergyCo/NDEATH/substation-7",
			want:  TopicInfo{Group: "EnergyCo", Type: MessageTypeNDeath, EdgeNode: "substation-7"},
			ok:    true,
		},
		{
			name:  "NDATA",
			topic: "spBv1.0/EnergyCo/NDATA/substation-7",
			want:  TopicInfo{Group: "EnergyCo", Type: MessageTypeNData, EdgeNode: "substation-7"},
			ok:    true,
		},
		{
			name:  "NCMD",
			topic: "spBv1.0/EnergyCo/NCMD/substation-7",
			want:  TopicInfo{Group: "EnergyCo", Type: MessageTypeNCmd, EdgeNode: "substation-7"},
			ok:    true,
		},
		{
			name:  "DBIRTH",
			topic: "spBv1.0/EnergyCo/DBIRTH/substation-7/meter-01",
			want:  TopicInfo{Group: "EnergyCo", Type: MessageTypeDBirth, EdgeNode: "substation-7", Device: "meter-01"},
			ok:    true,
		},
		{
			name:  "DDEATH",
			topic: "spBv1.0/EnergyCo/DDEATH/substation-7/meter-01",
			want:  TopicInfo{Group: "EnergyCo", Type: MessageTypeDDeath, EdgeNode: "substation-7", Device: "meter-01"},
			ok:    true,
		},
		{
			name:  "DDATA",
			topic: "spBv1.0/EnergyCo/DDATA/substation-7/meter-01",
			want:  TopicInfo{Group: "EnergyCo", Type: MessageTypeDData, EdgeNode: "substation-7", Device: "meter-01"},
			ok:    true,
		},
		{
			name:  "DCMD",
			topic: "spBv1.0/EnergyCo/DCMD/substation-7/meter-01",
			want:  TopicInfo{Group: "EnergyCo", Type: MessageTypeDCmd, EdgeNode: "substation-7", Device: "meter-01"},
			ok:    true,
		},
		{
			name:  "STATE 3.0 form",
			topic: "spBv1.0/STATE/scada-primary",
			want:  TopicInfo{Type: MessageTypeState, HostID: "scada-primary"},
			ok:    true,
		},
		{
			name:  "STATE legacy 2.2 form",
			topic: "STATE/scada-primary",
			want:  TopicInfo{Type: MessageTypeState, HostID: "scada-primary"},
			ok:    true,
		},
		{name: "N type with device segment", topic: "spBv1.0/EnergyCo/NDATA/substation-7/meter-01"},
		{name: "D type without device segment", topic: "spBv1.0/EnergyCo/DDATA/substation-7"},
		{name: "STATE in 4-segment position", topic: "spBv1.0/EnergyCo/STATE/substation-7"},
		{name: "unknown message type", topic: "spBv1.0/EnergyCo/NBOOM/substation-7"},
		{name: "lowercase message type", topic: "spBv1.0/EnergyCo/nbirth/substation-7"},
		{name: "empty group segment", topic: "spBv1.0//NBIRTH/substation-7"},
		{name: "empty edge node segment", topic: "spBv1.0/EnergyCo/NBIRTH/"},
		{name: "empty device segment", topic: "spBv1.0/EnergyCo/DBIRTH/substation-7/"},
		{name: "too many segments", topic: "spBv1.0/EnergyCo/DBIRTH/substation-7/meter-01/extra"},
		{name: "bare STATE", topic: "STATE"},
		{name: "empty legacy host id", topic: "STATE/"},
		{name: "STATE 3.0 with extra segment", topic: "spBv1.0/STATE/scada-primary/extra"},
		{name: "wrong namespace", topic: "spAv1.0/EnergyCo/NBIRTH/substation-7"},
		{name: "non-sparkplug topic", topic: "sensors/temperature"},
		{name: "empty topic", topic: ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := ParseTopic(tc.topic)
			if ok != tc.ok {
				t.Fatalf("ParseTopic(%q) ok = %v, want %v", tc.topic, ok, tc.ok)
			}
			if got != tc.want {
				t.Errorf("ParseTopic(%q) = %+v, want %+v", tc.topic, got, tc.want)
			}
		})
	}
}
