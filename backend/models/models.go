package models

import (
	"time"

	"gopkg.in/guregu/null.v4"
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
	ClientId             null.String      `json:"clientId"`
	Protocol             string           `json:"protocol"`
	Host                 string           `json:"host"`
	Port                 int              `json:"port"`
	WebsocketPath        string           `json:"websocketPath"`
	Username             null.String      `json:"username"`
	Password             null.String      `json:"password"`
	IsProtoEnabled       *bool            `json:"isProtoEnabled"`
	IsCertsEnabled       *bool            `json:"isCertsEnabled"`
	SkipCertVerification *bool            `json:"skipCertVerification"`
	CertCa               null.String      `json:"certCa"`
	CertClient           null.String      `json:"certClient"`
	CertClientKey        null.String      `json:"certClientKey"`
	Subscriptions        []Subscription   `json:"subscriptions"`
	LastConnectedAt      null.Time        `json:"lastConnectedAt"`
	CustomIconSeed       null.String      `json:"customIconSeed"`
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
