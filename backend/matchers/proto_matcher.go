package matchers

import (
	"context"
	"sync"

	"google.golang.org/protobuf/reflect/protoreflect"
)

type ProtoMatcher struct {
	ctx                          context.Context
	subscriptionMatcher          *SubscriptionMatcher
	descriptors                  map[string]*protoreflect.MessageDescriptor // descriptor name -> descriptor
	matchingProtoDescriptorCache map[string]*protoreflect.MessageDescriptor // topic -> descriptor
	cacheMutex                   *sync.Mutex
}

func NewProtoMatcher(ctx context.Context, subscriptionMatcher *SubscriptionMatcher, descriptors map[string]*protoreflect.MessageDescriptor) *ProtoMatcher {
	return &ProtoMatcher{
		ctx:                          ctx,
		subscriptionMatcher:          subscriptionMatcher,
		descriptors:                  descriptors,
		matchingProtoDescriptorCache: make(map[string]*protoreflect.MessageDescriptor),
		cacheMutex:                   &sync.Mutex{},
	}
}

func (pm *ProtoMatcher) GetMatchingProtoDescriptorName(topic string) string {
	pm.cacheMutex.Lock()
	if descriptor, ok := pm.matchingProtoDescriptorCache[topic]; ok {
		return string((*descriptor).FullName())
	}
	pm.cacheMutex.Unlock()
	descriptor := pm.GetMatchingProtoDescriptor(topic)
	if descriptor == nil {
		return ""
	}
	return string((descriptor).FullName())
}

func (pm *ProtoMatcher) GetMatchingProtoDescriptor(topic string) protoreflect.MessageDescriptor {
	pm.cacheMutex.Lock()
	descriptor, ok := pm.matchingProtoDescriptorCache[topic]
	pm.cacheMutex.Unlock()
	if ok {
		return *descriptor
	}
	if matchingSub := pm.subscriptionMatcher.GetMatchingSubscription(topic); matchingSub != nil && matchingSub.ProtoDescriptor.Valid {
		descriptor, ok := pm.descriptors[matchingSub.ProtoDescriptor.String]
		if !ok {
			return nil
		}
		pm.matchingProtoDescriptorCache[topic] = descriptor
		return *descriptor
	}
	return nil
}
