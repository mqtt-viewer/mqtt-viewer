package models

import (
	"time"
)

type Global struct {
	ID                      uint  `json:"id" gorm:"primaryKey"`
	LocalPasswordsEncrypted *bool `json:"localPasswordsEncrypted"`
}

type Connection struct {
	ID                   uint             `json:"id" gorm:"primaryKey"`
	CreatedAt            time.Time        `json:"createdAt"`
	UpdatedAt            time.Time        `json:"updatedAt"`
	Name                 string           `json:"name"`
	MqttVersion          string           `json:"mqttVersion"`
	HasCustomClientId    *bool            `json:"hasCustomClientId"`
	ClientId             *string          `json:"clientId"`
	Protocol             string           `json:"protocol"`
	Host                 string           `json:"host"`
	Port                 int              `json:"port"`
	WebsocketPath        string           `json:"websocketPath"`
	Username             *string          `json:"username"`
	Password             *string          `json:"password"`
	IsProtoEnabled       *bool            `json:"isProtoEnabled"`
	IsCertsEnabled       *bool            `json:"isCertsEnabled"`
	SkipCertVerification *bool            `json:"skipCertVerification"`
	CertCa               *string          `json:"certCa"`
	CertClient           *string          `json:"certClient"`
	CertClientKey        *string          `json:"certClientKey"`
	Subscriptions        []Subscription   `json:"subscriptions"`
	LastConnectedAt      *time.Time       `json:"lastConnectedAt"`
	CustomIconSeed       *string          `json:"customIconSeed"`
	FilterHistories      []FilterHistory  `json:"filterHistories"`
	PublishHistories     []PublishHistory `json:"publishHistories"`
}

type FilterHistory struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	ConnectionID uint      `json:"connectionId" gorm:"index:conn;index:conn_filter"`
	Text         string    `json:"text" gorm:"index:conn_filter"`
	LastUsed     time.Time `json:"lastUsed"`
}

type PublishHistory struct {
	ID           uint   `json:"id" gorm:"primaryKey"`
	ConnectionID uint   `json:"connectionId" gorm:"index:publish_history_connid"`
	Topic        string `json:"topic"`
	QoS          uint   `json:"qos"`
	Retain       bool   `json:"retain"`
	Payload      string `json:"payload"`
	Encoding     string `json:"encoding"`
	Format       string `json:"format"`
	//JSON key-value properties stored as string
	UserProperties               *string   `json:"userProperties"`
	HeaderContentType            *string   `json:"headerContentType"`
	HeaderResponseTopic          *string   `json:"headerResponseTopic"`
	HeaderCorrelationData        *string   `json:"headerCorrelationData"`
	HeaderPayloadFormatIndicator *bool     `json:"headerPayloadFormatIndicator"`
	HeaderMessageExpiryInterval  *int32    `json:"headerMessageExpiryInterval"`
	HeaderTopicAlias             *int32    `json:"headerTopicAlias"`
	HeaderSubscriptionIdentifier *int32    `json:"headerSubscriptionIdentifier"`
	PublishedAt                  time.Time `json:"publishedAt"`
}

type Collection struct {
	ID uint `json:"id" gorm:"primaryKey"`
	// nil = global collection, available on all connections
	ConnectionID *uint               `json:"connectionId" gorm:"index:collections_connid"`
	Name         string              `json:"name"`
	CreatedAt    time.Time           `json:"createdAt"`
	UpdatedAt    time.Time           `json:"updatedAt"`
	Messages     []CollectionMessage `json:"messages"`
}

type CollectionMessage struct {
	ID           uint   `json:"id" gorm:"primaryKey"`
	CollectionID uint   `json:"collectionId" gorm:"index:collection_messages_collid"`
	Name         string `json:"name"`
	Topic        string `json:"topic"`
	QoS          uint   `json:"qos"`
	Retain       bool   `json:"retain"`
	Payload      string `json:"payload"`
	Encoding     string `json:"encoding"`
	Format       string `json:"format"`
	//JSON key-value properties stored as string
	UserProperties               *string   `json:"userProperties"`
	HeaderContentType            *string   `json:"headerContentType"`
	HeaderResponseTopic          *string   `json:"headerResponseTopic"`
	HeaderCorrelationData        *string   `json:"headerCorrelationData"`
	HeaderPayloadFormatIndicator *bool     `json:"headerPayloadFormatIndicator"`
	HeaderMessageExpiryInterval  *int32    `json:"headerMessageExpiryInterval"`
	HeaderTopicAlias             *int32    `json:"headerTopicAlias"`
	HeaderSubscriptionIdentifier *int32    `json:"headerSubscriptionIdentifier"`
	CreatedAt                    time.Time `json:"createdAt"`
	UpdatedAt                    time.Time `json:"updatedAt"`
}

type Tab struct {
	ID           uint       `json:"id" gorm:"primaryKey"`
	TabIndex     uint       `json:"tabIndex"`
	ConnectionID uint       `json:"connectionId"`
	Connection   Connection `json:"connection"`
}

type Subscription struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
	ConnectionID uint      `json:"connectionId"`
	QoS          *uint     `json:"qos"`
	Topic        string    `json:"topic"`
}

type PanelSize struct {
	ID     string `json:"id" gorm:"primaryKey"`
	Size   uint   `json:"size"`
	IsOpen bool   `json:"isOpen"`
}

type SortState struct {
	ID            string `json:"id" gorm:"primaryKey"`
	SortCriteria  string `json:"sortCriteria"`
	SortDirection string `json:"sortDirection"`
}

type Migration struct {
	ID                uint      `json:"id" gorm:"primaryKey"`
	MigrationFileName string    `json:"migrationFileName"`
	CreatedAt         time.Time `json:"createdAt"`
}
