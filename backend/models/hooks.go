package models

import (
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/cryptography"
	"mqtt-viewer/backend/env"

	"gorm.io/gorm"
)

// Gorm is...fiddly
// and none of these work as expected despite following the documentation
// so instead passwords are encrypted before saving in the service layer
// func (c *Connection) BeforeSave(tx *gorm.DB) (err error) {
// 	return c.encryptPassword(tx)
// }

// func (c *Connection) BeforeCreate(tx *gorm.DB) (err error) {
// 	return c.encryptPassword(tx)
// }

func (c *Connection) AfterFind(tx *gorm.DB) (err error) {
	return c.decryptPassword(tx)
}

func (c *Connection) encryptPassword(tx *gorm.DB) error {
	if !tx.Statement.Changed("Password") {
		return nil
	}

	incomingPassword := tx.Statement.Dest.(map[string]interface{})["password"].(string)

	if incomingPassword == "" {
		return nil
	}

	encryptedPassword, err := cryptography.EncryptBytesForMachine(env.MachineId, []byte(incomingPassword))
	if err != nil {
		return err
	}

	tx.Statement.SetColumn("password", string(encryptedPassword))
	return nil
}

func (c *Connection) decryptPassword(tx *gorm.DB) error {
	if !c.Password.Valid || c.Password.String == "" {
		return nil
	}

	decryptedPassword, err := cryptography.DecryptBytesForMachine(env.MachineId, []byte(c.Password.String))
	if err != nil {
		slog.Warn(fmt.Sprintf("error decrypting password: %v", err))
		return nil
	}
	c.Password.String = string(decryptedPassword)
	return nil
}
