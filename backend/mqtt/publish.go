package mqtt

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/eclipse/paho.golang/paho"
)

type MqttPublishParams struct {
	Topic      string             `json:"topic"`
	QoS        int                `json:"qos"`
	Payload    []byte             `json:"payloadBytes"`
	Retain     bool               `json:"retain"`
	Properties *MessageProperties `json:"properties"`
}

func (mm *MqttManager) Publish(message MqttPublishParams) error {
	slog.DebugContext(mm.ctx, "publishing message", slog.String("topic", message.Topic))
	if mm.ConnectionState != ConnectionStates.Connected ||
		mm.connection == nil {
		return fmt.Errorf("no connection to broker")
	}
	if len(mm.middleware.BeforePublish) > 0 {
		err := handlePublishMiddleware(&message, mm.middleware.BeforePublish)
		if err != nil {
			return newPublishError(fmt.Errorf("before publish: %w", err))
		}
	}

	var err error
	if mm.connection == nil {
		return fmt.Errorf("no connection to broker")
	}
	if mm.connection.mqttVersion == "3" {
		err = mm.publishV3(message)
	} else {
		err = mm.publishV5(message)
	}
	if err != nil {
		return newPublishError(err)
	}

	mm.stats.SendMessageToStats(message)

	if len(mm.middleware.AfterPublish) > 0 {
		err := handlePublishMiddleware(&message, mm.middleware.AfterPublish)
		if err != nil {
			return newPublishError(fmt.Errorf("after publish: %w", err))
		}
	}

	return nil
}

func (mm *MqttManager) publishV3(params MqttPublishParams) error {
	if mm.connection.v3Connection == nil {
		return fmt.Errorf("no v3 connection to broker")
	}
	qos := byte(params.QoS)
	t := (*mm.connection.v3Connection).Publish(params.Topic, qos, params.Retain, params.Payload)
	sent := t.WaitTimeout(time.Second * 2)
	if !sent {
		return fmt.Errorf("timeout while publishing message")
	}
	if t.Error() != nil {
		return t.Error()
	}
	return nil
}

func (mm *MqttManager) publishV5(params MqttPublishParams) error {
	if mm.connection.v5Connection == nil {
		return fmt.Errorf("no v5 connection to broker")
	}
	var publishProperties *paho.PublishProperties
	if params.Properties != nil {
		publishProperties = &paho.PublishProperties{
			CorrelationData: params.Properties.CorrelationData,
			ContentType:     params.Properties.ContentType,
			ResponseTopic:   params.Properties.ResponseTopic,
			PayloadFormat:   params.Properties.PayloadFormat,
			MessageExpiry:   params.Properties.MessageExpiry,
			TopicAlias:      params.Properties.TopicAlias,
		}

		if params.Properties.SubscriptionIdentifier != nil && *params.Properties.SubscriptionIdentifier != 0 {
			publishProperties.SubscriptionIdentifier = params.Properties.SubscriptionIdentifier
		}

		if params.Properties.UserProperties != nil {
			userProperties := paho.UserProperties{}
			for key, value := range params.Properties.UserProperties {
				userProperties = append(userProperties, paho.UserProperty{
					Key:   key,
					Value: value,
				})
			}
			publishProperties.User = userProperties
		}

	}

	timeout, cancelFunc := context.WithTimeout(context.Background(), time.Second*2)
	defer cancelFunc()
	_, err := mm.connection.v5Connection.Publish(
		timeout,
		&paho.Publish{
			Topic:      params.Topic,
			QoS:        byte(params.QoS),
			Retain:     params.Retain,
			Payload:    params.Payload,
			Properties: publishProperties,
		},
	)
	if err != nil {
		return err
	}
	return nil
}

func newPublishError(err error) error {
	return fmt.Errorf("publish: %w", err)
}
