package mqtt

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/eclipse/paho.golang/autopaho"
	mqttV5 "github.com/eclipse/paho.golang/paho"
	mqttV3 "github.com/eclipse/paho.mqtt.golang"
)

type SubscribeParams struct {
	Topic string
	QoS   int
}

func subscribeV3(ctx context.Context, c mqttV3.Client, subs []SubscribeParams) error {
	for _, sub := range subs {
		if sub.Topic != "" {
			slog.InfoContext(ctx, fmt.Sprintf("subscribing to topic %v with QoS %v", sub.Topic, sub.QoS))
			token := c.Subscribe(sub.Topic, byte(sub.QoS), nil)
			returned := token.WaitTimeout(time.Second * 2)
			if !returned {
				errStr := fmt.Sprintf("timeout while subscribing to topic %v", sub.Topic)
				slog.ErrorContext(ctx, errStr)
				return newSubError(errors.New(errStr))
			}
			if token.Error() != nil {
				return newSubError(token.Error())
			}

			if token := c.Subscribe(sub.Topic, byte(sub.QoS), nil); token.Wait() && token.Error() != nil {
				return newSubError(token.Error())
			}
		}
	}
	return nil
}

func subscribeV5(ctx context.Context, logCtx context.Context, cm *autopaho.ConnectionManager, subs []SubscribeParams) error {
	var nonEmptySubCount = 0
	for _, sub := range subs {
		if sub.Topic != "" {
			nonEmptySubCount++
		}
	}
	var subscriptions = make([]mqttV5.SubscribeOptions, nonEmptySubCount)
	for i, sub := range subs {
		if sub.Topic != "" {
			slog.InfoContext(logCtx, fmt.Sprintf("subscribing to topic %v with QoS %v", sub.Topic, sub.QoS))
			subscriptions[i] = mqttV5.SubscribeOptions{
				Topic:             sub.Topic,
				QoS:               byte(sub.QoS),
				RetainAsPublished: true,
			}
		}
	}
	res, err := cm.Subscribe(ctx, &mqttV5.Subscribe{
		Subscriptions: subscriptions,
	})
	if err != nil {
		return newSubError(err)
	}
	if res == nil {
		return newSubError(fmt.Errorf("v5 sub timeout"))
	}

	return nil
}

func newSubError(err error) error {
	return fmt.Errorf("subscribe: %w", err)
}
