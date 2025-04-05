// MQTT integration tests
// Need to have a local MQTT broker running for these to work
package app

import (
	"context"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	"testing"
	"time"
)

func TestMqttV3Connects(t *testing.T) {
	app := getTestApp(t)
	localConnection := getNewConnectionWithCustomProperties(app, &models.Connection{
		MqttVersion: "3",
	})

	err := app.ConnectMqtt(localConnection.ConnectionId)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
}

func TestMqttV5Connects(t *testing.T) {
	app := getTestApp(t)
	localConnection := getNewConnectionWithCustomProperties(app, &models.Connection{
		MqttVersion: "5",
	})

	err := app.ConnectMqtt(localConnection.ConnectionId)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
}

func TestMqttV3ConnectFailsWhenWrongHost(t *testing.T) {
	app := getTestApp(t)
	localConnection := getNewConnectionWithCustomProperties(app, &models.Connection{
		Host:        "wronghost",
		MqttVersion: "3",
	})

	err := app.ConnectMqtt(localConnection.ConnectionId)
	if err == nil {
		t.Errorf("Expected error, got none")
	}
}

func TestMqttV5ConnectFailsWhenWrongHost(t *testing.T) {
	app := getTestApp(t)
	localConnection := getNewConnectionWithCustomProperties(app, &models.Connection{
		Host:        "wronghost",
		MqttVersion: "5",
	})

	err := app.ConnectMqtt(localConnection.ConnectionId)
	if err == nil {
		t.Errorf("Expected error, got none")
	}
}

func TestMqttV3ConnectFailsWhenWrongPort(t *testing.T) {
	app := getTestApp(t)
	port := 1
	localConnection := getNewConnectionWithCustomProperties(app, &models.Connection{
		Port:        port,
		MqttVersion: "3",
	})

	err := app.ConnectMqtt(localConnection.ConnectionId)
	if err == nil {
		t.Errorf("Expected error, got none")
	}
}

func TestMqttV5ConnectFailsWhenWrongPort(t *testing.T) {
	app := getTestApp(t)
	port := 1
	localConnection := getNewConnectionWithCustomProperties(app, &models.Connection{
		Port:        port,
		MqttVersion: "5",
	})

	err := app.ConnectMqtt(localConnection.ConnectionId)
	if err == nil {
		t.Errorf("Expected error, got none")
	}
}

func TestMqttV3ConnectFailsWhenWrongProtocol(t *testing.T) {
	app := getTestApp(t)
	localConnection := getNewConnectionWithCustomProperties(app, &models.Connection{
		Protocol:    "mqtts",
		MqttVersion: "3",
	})

	err := app.ConnectMqtt(localConnection.ConnectionId)
	if err == nil {
		t.Errorf("Expected error, got none")
	}
}

func TestMqttV5SubscribesCorrectly(t *testing.T) {
	app := getTestApp(t)
	localConnection := getNewConnectionWithCustomProperties(app, &models.Connection{
		Protocol:    "mqtts",
		MqttVersion: "5",
	})

	err := app.ConnectMqtt(localConnection.ConnectionId)
	if err == nil {
		t.Errorf("Expected error, got none")
	}
}

func TestMqttV5PubsAndSubsCorrectlyWithNoProperties(t *testing.T) {
	MqttPubAndSubIntegrationTest(t, "5", nil)
}

func TestMqttV5PubsAndSubsCorrectlyWithAllProperties(t *testing.T) {
	publishProperties := PublishProperties{
		ContentType:            "application/json",
		ResponseTopic:          "response",
		PayloadFormatIndicator: true,
		MessageExpiryInterval:  100,
		TopicAlias:             1,
		SubscriptionIdentifier: 2,
	}
	MqttPubAndSubIntegrationTest(t, "5", &publishProperties)
}

func TestMqttV5PubsAndSubsCorrectlyWithNoAlias(t *testing.T) {
	publishProperties := PublishProperties{
		ContentType:            "application/json",
		ResponseTopic:          "response",
		PayloadFormatIndicator: true,
		MessageExpiryInterval:  100,
		// TopicAlias:             1,
		SubscriptionIdentifier: 2,
	}
	MqttPubAndSubIntegrationTest(t, "5", &publishProperties)
}

func TestMqttV3PubsAndSubsCorrectly(t *testing.T) {
	MqttPubAndSubIntegrationTest(t, "3", nil)
}

func MqttPubAndSubIntegrationTest(t *testing.T, mqttVersion string, publishProperties *PublishProperties) {
	app := getTestApp(t)
	localConnection := getNewConnectionWithCustomProperties(app, &models.Connection{
		MqttVersion: mqttVersion,
	})
	connId := localConnection.ConnectionId

	appConnection := app.AppConnections[connId]

	err := app.ConnectMqtt(connId)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	defer app.DisconnectMqtt(connId)

	ctx, cancelFunc := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFunc()
	topic := t.Name()
	payload := t.Name() + "-payload"
	publishParams := PublishParams{
		Topic:   topic,
		Payload: payload,
		QoS:     1,
		Retain:  false,
	}
	if publishProperties != nil {
		publishParams.Properties = *publishProperties
	}
	err = app.PublishMqtt(connId, publishParams)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
		return
	}
	t.Logf("Published message")

	// Check if the message was received every 100ms until the context is done
	for {
		select {
		case <-ctx.Done():
			t.Errorf("Expected message, got none")
			return
		default:
			t.Logf("Checking for message...")
			messages, err := appConnection.MqttManager.MessageHistory.GetTopicHistory(topic)
			if err != nil {
				// Topic hasn't arrived yet
			} else {
				if len(messages) > 0 {
					if string(messages[0].Payload) != payload {
						t.Errorf("Expected message %v, got %v", payload, string(messages[0].Payload))
					}
					return
				}
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
}

func TestProtoEnabledWithoutProtoRegDir(t *testing.T) {
	app := getTestApp(t)
	trueVal := true
	localConnection := getNewConnectionWithCustomProperties(app, &models.Connection{
		IsProtoEnabled: &trueVal,
	})
	connId := localConnection.ConnectionId

	err := app.ConnectMqtt(connId)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
}

func getNewConnectionWithCustomProperties(app *App, customDetails *models.Connection) *AppConnection {
	newConnection, _ := app.NewConnection()
	port := 1883

	newConnection.ConnectionDetails.Protocol = "mqtt"
	newConnection.ConnectionDetails.Host = "localhost"
	newConnection.ConnectionDetails.Port = port
	newConnection.ConnectionDetails.Subscriptions = []models.Subscription{}

	if customDetails != nil {
		if customDetails.Protocol != "" {
			newConnection.ConnectionDetails.Protocol = customDetails.Protocol
		}
		if customDetails.Host != "" {
			newConnection.ConnectionDetails.Host = customDetails.Host
		}
		if customDetails.Port != 0 {
			newConnection.ConnectionDetails.Port = customDetails.Port
		}
		if customDetails.Subscriptions != nil {
			newConnection.ConnectionDetails.Subscriptions = customDetails.Subscriptions
		}
		if customDetails.MqttVersion != "" {
			newConnection.ConnectionDetails.MqttVersion = customDetails.MqttVersion
		}
		if customDetails.HasCustomClientId != nil && *customDetails.HasCustomClientId != false {
			newConnection.ConnectionDetails.HasCustomClientId = customDetails.HasCustomClientId
		}
		if customDetails.HasCustomClientId != nil && *customDetails.IsProtoEnabled != false {
			newConnection.ConnectionDetails.IsProtoEnabled = customDetails.IsProtoEnabled
		}
		if customDetails.IsProtoEnabled != nil {
			newConnection.ConnectionDetails.IsProtoEnabled = customDetails.IsProtoEnabled
		}
		if customDetails.IsCertsEnabled != nil {
			newConnection.ConnectionDetails.IsCertsEnabled = customDetails.IsCertsEnabled
		}
	}

	app.UpdateConnection(&newConnection.ConnectionDetails)
	newSubLen := len(newConnection.ConnectionDetails.Subscriptions)
	if newSubLen > 0 {
		for i, sub := range newConnection.ConnectionDetails.Subscriptions {
			sub.ConnectionID = newConnection.ConnectionDetails.ID
			if i > 2 {
				app.AddSubscription(newConnection.ConnectionDetails.ID)
			}
			app.UpdateSubscription(newConnection.ConnectionDetails.ID, sub)
		}
	}

	appConnection := app.AppConnections[newConnection.ConnectionDetails.ID]
	// Override onConnectUp and onConnectDown handlers to avoid wails runtime errors
	appConnection.MqttManager.SetConnectionCallbacks(mqtt.MqttConnectionCallbacks{
		OnConnecting: func() {
		},
		OnConnectionUp: func() {},
		OnConnectionDown: func(reason *error) {
		},
		OnReconnecting:    func(reason *error) {},
		OnConnectionError: func(reason *error) {},
	})

	return appConnection
}

func TestMakePublishProperties(t *testing.T) {
	userProperties := make(map[string]string)
	userProperties["key"] = "value"
	publishProperties := &PublishProperties{
		ContentType:            "application/json",
		PayloadFormatIndicator: true,
		MessageExpiryInterval:  100,
		ResponseTopic:          "response/topic",
		CorrelationData:        "correlation data",
		TopicAlias:             1,
		SubscriptionIdentifier: 2,
		UserProperties:         userProperties,
	}

	messageProperties, err := makePublishProperties(publishProperties)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if messageProperties.ContentType != publishProperties.ContentType {
		t.Errorf("Expected ContentType %v, got %v", publishProperties.ContentType, messageProperties.ContentType)
	}
	if *messageProperties.PayloadFormat != 1 {
		t.Errorf("Expected PayloadFormat 1, got %v", *messageProperties.PayloadFormat)
	}
	if *messageProperties.MessageExpiry != 100 {
		t.Errorf("Expected MessageExpiry 100, got %v", *messageProperties.MessageExpiry)
	}
	if messageProperties.ResponseTopic != publishProperties.ResponseTopic {
		t.Errorf("Expected ResponseTopic %v, got %v", publishProperties.ResponseTopic, messageProperties.ResponseTopic)
	}
	if string(messageProperties.CorrelationData) != publishProperties.CorrelationData {
		t.Errorf("Expected CorrelationData %v, got %v", publishProperties.CorrelationData, string(messageProperties.CorrelationData))
	}
	if *messageProperties.TopicAlias != 1 {
		t.Errorf("Expected TopicAlias 1, got %v", *messageProperties.TopicAlias)
	}
	if *messageProperties.SubscriptionIdentifier != 2 {
		t.Errorf("Expected SubscriptionIdentifier 2, got %v", *messageProperties.SubscriptionIdentifier)
	}
	if len(messageProperties.UserProperties) != 1 {
		t.Errorf("Expected 1 user property, got %v", len(messageProperties.UserProperties))
	}
	if val, ok := messageProperties.UserProperties["key"]; !ok || val != "value" {
		t.Errorf("Expected user property key 'key' with value 'value', got %v", messageProperties.UserProperties)
	}

}
