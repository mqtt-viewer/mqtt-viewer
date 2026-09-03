package mqtt

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"syscall"

	"github.com/eclipse/paho.golang/autopaho"
	"github.com/eclipse/paho.mqtt.golang/packets"
)

// friendlyConnectError rewrites a connect failure from the underlying MQTT
// client library into a clear, user-facing message. paho.mqtt.golang (v3)
// and paho.golang/autopaho (v5) each report the same handful of failure
// classes in their own wording, e.g. v3's "network Error : dial tcp
// 127.0.0.1:1883: connect: connection refused" or v5's "server denied
// connect (reason: 5): Not authorized". Anything not recognised here is
// returned unchanged, so no information is ever hidden.
func friendlyConnectError(err error, usingTls bool) error {
	if err == nil {
		return nil
	}

	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return fmt.Errorf("could not resolve %q: check the host name", dnsErr.Name)
	}

	if errors.Is(err, syscall.ECONNREFUSED) {
		return errors.New("the broker refused the connection: check the host and port")
	}

	if reason, ok := authFailureReason(err); ok {
		return errors.New(reason)
	}

	if isTlsFailure(err, usingTls) {
		return errors.New("TLS handshake failed: check the broker's certificate and your TLS settings")
	}

	return err
}

// authFailureReason recognises a CONNACK rejection from either client
// library and reports why in plain terms.
func authFailureReason(err error) (string, bool) {
	var connackErr *autopaho.ConnackError
	if errors.As(err, &connackErr) {
		if msg, ok := connackReasonMessages[connackErr.ReasonCode]; ok {
			return msg, true
		}
		return fmt.Sprintf("the broker refused the connection (reason code %d)", connackErr.ReasonCode), true
	}
	switch {
	case errors.Is(err, packets.ErrorRefusedNotAuthorised):
		return "the broker rejected the connection: not authorised", true
	case errors.Is(err, packets.ErrorRefusedBadUsernameOrPassword):
		return "the broker rejected the username or password", true
	case errors.Is(err, packets.ErrorRefusedIDRejected):
		return "the broker rejected the client ID", true
	case errors.Is(err, packets.ErrorRefusedServerUnavailable):
		return "the broker is unavailable", true
	case errors.Is(err, packets.ErrorRefusedBadProtocolVersion):
		return "the broker does not support this MQTT protocol version", true
	}
	return "", false
}

// connackReasonMessages covers the MQTT 5 CONNACK reason codes a
// misconfigured connection is actually likely to hit. Anything else falls
// back to the generic "reason code %d" message in authFailureReason.
var connackReasonMessages = map[byte]string{
	128: "the broker refused the connection",
	133: "the broker refused the connection: implementation specific error",
	134: "the broker rejected the username or password",
	135: "the broker rejected the connection: not authorised",
	138: "the broker has banned this client",
	140: "the broker rejected the authentication method",
}

// isTlsFailure recognises a TLS handshake failure. A bare io.EOF is only
// treated as one when TLS was actually configured for this connection: on a
// plain connection it just means the socket closed, which has nothing to do
// with certificates.
func isTlsFailure(err error, usingTls bool) bool {
	var unknownAuthority x509.UnknownAuthorityError
	var hostnameError x509.HostnameError
	var certInvalid x509.CertificateInvalidError
	var recordHeaderErr tls.RecordHeaderError
	if errors.As(err, &unknownAuthority) ||
		errors.As(err, &hostnameError) ||
		errors.As(err, &certInvalid) ||
		errors.As(err, &recordHeaderErr) {
		return true
	}
	msg := err.Error()
	if strings.Contains(msg, "tls:") || strings.Contains(msg, "x509:") {
		return true
	}
	return usingTls && errors.Is(err, io.EOF)
}
