package matchers

import (
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/util"
	"sync"
)

type SubscriptionMatcher struct {
	subscriptions []models.Subscription
	matchedCache  map[string]*models.Subscription
	cacheMutex    *sync.Mutex
}

func NewSubscriptionMatcher(subscriptions []models.Subscription) *SubscriptionMatcher {
	return &SubscriptionMatcher{
		subscriptions: subscriptions,
		matchedCache:  make(map[string]*models.Subscription),
		cacheMutex:    &sync.Mutex{},
	}
}

func (sm *SubscriptionMatcher) GetMatchingSubscription(topic string) *models.Subscription {
	sm.cacheMutex.Lock()
	defer sm.cacheMutex.Unlock()
	if matched, ok := sm.matchedCache[topic]; ok {
		return matched
	}

	for _, s := range sm.subscriptions {
		if util.RouteMatchesTopic(s.Topic, topic) {
			sm.matchedCache[topic] = &s
			return &s
		}
	}

	sm.matchedCache[topic] = nil
	return nil
}
