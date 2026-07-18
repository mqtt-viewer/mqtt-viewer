// Package sparkplug implements stateful Sparkplug B session tracking:
// strict topic grammar parsing, per-connection birth/alias state, and
// alias-to-name resolution for data messages.
package sparkplug

import "strings"

// MessageType is a Sparkplug B message type taken from the topic, never from
// the payload.
type MessageType string

const (
	MessageTypeNBirth MessageType = "NBIRTH"
	MessageTypeNDeath MessageType = "NDEATH"
	MessageTypeDBirth MessageType = "DBIRTH"
	MessageTypeDDeath MessageType = "DDEATH"
	MessageTypeNData  MessageType = "NDATA"
	MessageTypeDData  MessageType = "DDATA"
	MessageTypeNCmd   MessageType = "NCMD"
	MessageTypeDCmd   MessageType = "DCMD"
	MessageTypeState  MessageType = "STATE"
)

const sparkplugBNamespace = "spBv1.0"

// TopicInfo is the parsed form of a Sparkplug topic. Device is set only for
// D* types; HostID only for STATE.
type TopicInfo struct {
	Group    string
	EdgeNode string
	Device   string
	HostID   string
	Type     MessageType
}

// ParseTopic applies the strict Sparkplug B topic grammar:
//
//	spBv1.0/{group}/{N-type}/{edgeNode}          (exactly 4 segments)
//	spBv1.0/{group}/{D-type}/{edgeNode}/{device} (exactly 5 segments)
//	spBv1.0/STATE/{hostId}                       (Sparkplug 3.0 host state)
//	STATE/{hostId}                               (legacy 2.2 host state)
//
// Message types come from an exact whitelist and the payload is never
// sniffed — loose detection is what makes other clients mis-decode plain
// text. Empty segments are invalid.
func ParseTopic(topic string) (TopicInfo, bool) {
	segments := strings.Split(topic, "/")
	for _, segment := range segments {
		if segment == "" {
			return TopicInfo{}, false
		}
	}

	switch len(segments) {
	case 2:
		if segments[0] != string(MessageTypeState) {
			return TopicInfo{}, false
		}
		return TopicInfo{Type: MessageTypeState, HostID: segments[1]}, true
	case 3:
		if segments[0] != sparkplugBNamespace || segments[1] != string(MessageTypeState) {
			return TopicInfo{}, false
		}
		return TopicInfo{Type: MessageTypeState, HostID: segments[2]}, true
	case 4:
		if segments[0] != sparkplugBNamespace {
			return TopicInfo{}, false
		}
		msgType := MessageType(segments[2])
		switch msgType {
		case MessageTypeNBirth, MessageTypeNDeath, MessageTypeNData, MessageTypeNCmd:
			return TopicInfo{Group: segments[1], Type: msgType, EdgeNode: segments[3]}, true
		}
		return TopicInfo{}, false
	case 5:
		if segments[0] != sparkplugBNamespace {
			return TopicInfo{}, false
		}
		msgType := MessageType(segments[2])
		switch msgType {
		case MessageTypeDBirth, MessageTypeDDeath, MessageTypeDData, MessageTypeDCmd:
			return TopicInfo{Group: segments[1], Type: msgType, EdgeNode: segments[3], Device: segments[4]}, true
		}
		return TopicInfo{}, false
	}
	return TopicInfo{}, false
}
