//go:build server

package env

// The whole binary is compiled with -tags server in server mode (the same tag
// Wails uses for its headless build), so our code rides the same tag.
func init() {
	IsServerBuild = true
}
