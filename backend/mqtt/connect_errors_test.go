package mqtt

import (
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"syscall"
	"testing"

	"github.com/eclipse/paho.golang/autopaho"
	"github.com/eclipse/paho.golang/paho"
	"github.com/eclipse/paho.mqtt.golang/packets"
)

func TestFriendlyConnectErrorNil(t *testing.T) {
	if got := friendlyConnectError(nil, false); got != nil {
		t.Errorf("expected nil, got %v", got)
	}
}

func TestFriendlyConnectErrorDnsFailure(t *testing.T) {
	// Shape produced by net.Dial when the host doesn't resolve, and how both
	// client libraries wrap it (v3: "%w : %w" with packets.ErrorNetworkError;
	// v5: "failed to connect to %s: %w").
	dnsErr := &net.DNSError{Err: "no such host", Name: "badhost", IsNotFound: true}
	wrapped := fmt.Errorf("%w : %w", packets.ErrorNetworkError, &net.OpError{Op: "dial", Err: dnsErr})

	got := friendlyConnectError(wrapped, false)
	want := `could not resolve "badhost": check the host name`
	if got.Error() != want {
		t.Errorf("got %q, want %q", got.Error(), want)
	}
}

func TestFriendlyConnectErrorConnectionRefused(t *testing.T) {
	refused := &net.OpError{Op: "dial", Err: &os.SyscallError{Syscall: "connect", Err: syscall.ECONNREFUSED}}
	wrapped := fmt.Errorf("failed to connect to tcp://127.0.0.1:1: %w", refused)

	got := friendlyConnectError(wrapped, false)
	want := "the broker refused the connection: check the host and port"
	if got.Error() != want {
		t.Errorf("got %q, want %q", got.Error(), want)
	}
}

func TestFriendlyConnectErrorV3AuthRejection(t *testing.T) {
	got := friendlyConnectError(packets.ErrorRefusedNotAuthorised, false)
	want := "the broker rejected the connection: not authorised"
	if got.Error() != want {
		t.Errorf("got %q, want %q", got.Error(), want)
	}
}

func TestFriendlyConnectErrorV3BadCredentials(t *testing.T) {
	got := friendlyConnectError(packets.ErrorRefusedBadUsernameOrPassword, false)
	want := "the broker rejected the username or password"
	if got.Error() != want {
		t.Errorf("got %q, want %q", got.Error(), want)
	}
}

func TestFriendlyConnectErrorV5ConnackRejection(t *testing.T) {
	connackErr := autopaho.NewConnackError(nil, &paho.Connack{ReasonCode: 135})

	got := friendlyConnectError(connackErr, false)
	want := "the broker rejected the connection: not authorised"
	if got.Error() != want {
		t.Errorf("got %q, want %q", got.Error(), want)
	}
}

func TestFriendlyConnectErrorV5ConnackUnknownReasonCode(t *testing.T) {
	connackErr := autopaho.NewConnackError(nil, &paho.Connack{ReasonCode: 200})

	got := friendlyConnectError(connackErr, false)
	want := "the broker refused the connection (reason code 200)"
	if got.Error() != want {
		t.Errorf("got %q, want %q", got.Error(), want)
	}
}

func TestFriendlyConnectErrorTlsRecordHeader(t *testing.T) {
	var recordHeaderErr tls.RecordHeaderError
	got := friendlyConnectError(recordHeaderErr, true)
	want := "TLS handshake failed: check the broker's certificate and your TLS settings"
	if got.Error() != want {
		t.Errorf("got %q, want %q", got.Error(), want)
	}
}

func TestFriendlyConnectErrorEofOnlyTreatedAsTlsFailureWhenTlsInUse(t *testing.T) {
	if got := friendlyConnectError(io.EOF, false); got != io.EOF {
		t.Errorf("expected a plain EOF to pass through unchanged on a non-TLS connection, got %v", got)
	}

	got := friendlyConnectError(io.EOF, true)
	want := "TLS handshake failed: check the broker's certificate and your TLS settings"
	if got.Error() != want {
		t.Errorf("got %q, want %q", got.Error(), want)
	}
}

func TestFriendlyConnectErrorUnrecognisedPassesThrough(t *testing.T) {
	original := errors.New("some brand new failure mode")
	got := friendlyConnectError(original, false)
	if got != original {
		t.Errorf("expected the original error to pass through unchanged, got %v", got)
	}
}
