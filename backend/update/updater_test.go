package update

import (
	"context"
	"mqtt-viewer/backend/env"
	"strings"
	"sync"
	"testing"
	"time"
)

// stubFetch replaces the portal call for the duration of a test and counts how
// often it ran.
func stubFetch(t *testing.T, res *portalCheckResponse, err error) *int {
	t.Helper()
	calls := 0
	prev := fetchUpdate
	fetchUpdate = func(currentVersion string) (*portalCheckResponse, error) {
		calls++
		return res, err
	}
	t.Cleanup(func() { fetchUpdate = prev })
	return &calls
}

func testUpdater() *Updater {
	return &Updater{logCtx: context.Background()}
}

func TestCheckForUpdate_CachesPortalResult(t *testing.T) {
	calls := stubFetch(t, &portalCheckResponse{LatestVersion: "9.9.9", ReleaseNotes: "notes"}, nil)
	u := testUpdater()

	for i := 0; i < 3; i++ {
		res, err := u.CheckForUpdate()
		if err != nil {
			t.Fatalf("check %d failed: %v", i, err)
		}
		if res == nil || res.LatestVersion != "9.9.9" {
			t.Fatalf("check %d: expected 9.9.9, got %+v", i, res)
		}
	}
	if *calls != 1 {
		t.Fatalf("expected one portal request for three checks, got %d", *calls)
	}

	// An expired cache goes back to the portal.
	u.cacheMu.Lock()
	u.cachedAt = time.Now().Add(-checkCacheTTL - time.Second)
	u.cacheMu.Unlock()
	if _, err := u.CheckForUpdate(); err != nil {
		t.Fatalf("check after expiry failed: %v", err)
	}
	if *calls != 2 {
		t.Fatalf("expected a second portal request once the cache expired, got %d", *calls)
	}
}

// "Up to date" must cache too, otherwise the common case is uncached.
func TestCheckForUpdate_CachesUpToDate(t *testing.T) {
	calls := stubFetch(t, &portalCheckResponse{UpToDate: true}, nil)
	u := testUpdater()

	for i := 0; i < 2; i++ {
		res, err := u.CheckForUpdate()
		if err != nil {
			t.Fatalf("check %d failed: %v", i, err)
		}
		if res != nil {
			t.Fatalf("check %d: expected no update, got %+v", i, res)
		}
	}
	if *calls != 1 {
		t.Fatalf("expected one portal request, got %d", *calls)
	}
}

// Several tabs polling at once must still cost one portal request: the fetch
// is serialised and the losers read the cache the winner filled.
func TestCheckForUpdate_ConcurrentCallersShareOneRequest(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	prev := fetchUpdate
	fetchUpdate = func(currentVersion string) (*portalCheckResponse, error) {
		mu.Lock()
		calls++
		mu.Unlock()
		time.Sleep(10 * time.Millisecond)
		return &portalCheckResponse{LatestVersion: "9.9.9"}, nil
	}
	t.Cleanup(func() { fetchUpdate = prev })

	u := testUpdater()
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := u.CheckForUpdate()
			if err != nil {
				t.Errorf("concurrent check failed: %v", err)
			}
			if res == nil || res.LatestVersion != "9.9.9" {
				t.Errorf("concurrent check returned %+v", res)
			}
		}()
	}
	wg.Wait()

	mu.Lock()
	defer mu.Unlock()
	if calls != 1 {
		t.Fatalf("expected one portal request for 20 concurrent checks, got %d", calls)
	}
}

func TestCheckForUpdate_DisabledByEnv(t *testing.T) {
	calls := stubFetch(t, &portalCheckResponse{LatestVersion: "9.9.9"}, nil)
	u := testUpdater()

	for _, value := range []string{"1", "true", "YES", " 1 "} {
		t.Setenv(disableCheckEnv, value)
		res, err := u.CheckForUpdate()
		if err != nil || res != nil {
			t.Fatalf("%q should disable the check, got res=%+v err=%v", value, res, err)
		}
	}
	if *calls != 0 {
		t.Fatalf("a disabled check must not contact the portal, got %d requests", *calls)
	}

	t.Setenv(disableCheckEnv, "0")
	if _, err := u.CheckForUpdate(); err != nil {
		t.Fatalf("check should run when the opt-out is off: %v", err)
	}
	if *calls != 1 {
		t.Fatalf("expected one portal request once re-enabled, got %d", *calls)
	}
}

// withServerBuild sets env.IsServerBuild for the duration of a test and
// restores it afterwards. env.IsServerBuild is a package variable, not an
// environment variable, so t.Setenv cannot manage it.
func withServerBuild(t *testing.T, on bool) {
	t.Helper()
	prev := env.IsServerBuild
	env.IsServerBuild = on
	t.Cleanup(func() { env.IsServerBuild = prev })
}

func TestResolveInstallType_ServerBuilds(t *testing.T) {
	withServerBuild(t, true)

	t.Setenv("MQTT_VIEWER_INSTALL_TYPE", "home-assistant")
	if got := resolveInstallType(); got != installHomeAssistant {
		t.Fatalf("expected home-assistant-addon, got %q", got)
	}

	// Anything else, including unset, is a plain Docker run. A desktop-only
	// signal like FLATPAK_ID must not leak through in a server build.
	t.Setenv("MQTT_VIEWER_INSTALL_TYPE", "")
	t.Setenv("FLATPAK_ID", "app.mqttviewer.MQTTViewer")
	if got := resolveInstallType(); got != installDocker {
		t.Fatalf("expected docker when install type unset, got %q", got)
	}

	t.Setenv("MQTT_VIEWER_INSTALL_TYPE", "something-else")
	if got := resolveInstallType(); got != installDocker {
		t.Fatalf("expected docker for unknown install type, got %q", got)
	}
}

// The value is typed by hand into an add-on config or a compose file, and the
// constant name (home-assistant-addon) differs from the documented literal, so
// both spellings and sloppy whitespace or capitals must classify.
func TestResolveInstallType_HomeAssistantIsMatchedLoosely(t *testing.T) {
	withServerBuild(t, true)

	for _, value := range []string{"home-assistant", " Home-Assistant ", "HOME-ASSISTANT", "home-assistant-addon"} {
		t.Setenv("MQTT_VIEWER_INSTALL_TYPE", value)
		if got := resolveInstallType(); got != installHomeAssistant {
			t.Fatalf("%q should classify as home-assistant-addon, got %q", value, got)
		}
	}
}

func TestUpdateGuidance_Docker(t *testing.T) {
	cmd, instructions, url := updateGuidance(installDocker)
	if !strings.Contains(cmd, "docker pull") {
		t.Fatalf("docker command should run `docker pull`, got %q", cmd)
	}
	if instructions == "" {
		t.Fatal("docker should have instructions")
	}
	if url != releasesPageURL {
		t.Fatalf("docker should point at the releases page, got %q", url)
	}
}

func TestUpdateGuidance_HomeAssistant(t *testing.T) {
	cmd, instructions, url := updateGuidance(installHomeAssistant)
	if cmd != "" {
		t.Fatalf("home-assistant should have no command, got %q", cmd)
	}
	if instructions == "" {
		t.Fatal("home-assistant should have instructions")
	}
	if url != "" {
		t.Fatalf("home-assistant updates flow through HA, so no releases URL; got %q", url)
	}
}

func TestCanSelfUpdate_FalseForServerBuilds(t *testing.T) {
	withServerBuild(t, true)
	if canSelfUpdate() {
		t.Fatal("canSelfUpdate must be false for server builds regardless of file permissions")
	}
}

func TestResolveInstallType_FlatpakAndAppImage(t *testing.T) {
	t.Setenv("APPIMAGE", "")
	t.Setenv("FLATPAK_ID", "app.mqttviewer.MQTTViewer")
	if got := resolveInstallType(); got != installFlatpak {
		t.Fatalf("expected flatpak, got %q", got)
	}

	t.Setenv("FLATPAK_ID", "")
	t.Setenv("APPIMAGE", "/tmp/MQTT_Viewer.AppImage")
	if got := resolveInstallType(); got != installAppImage {
		t.Fatalf("expected appimage, got %q", got)
	}
}

func TestUpdateGuidance_Flatpak(t *testing.T) {
	cmd, instructions, url := updateGuidance(installFlatpak)
	if !strings.Contains(cmd, "flatpak update") {
		t.Fatalf("flatpak command should run `flatpak update`, got %q", cmd)
	}
	if instructions == "" {
		t.Fatal("flatpak should have instructions")
	}
	if url != "" {
		t.Fatalf("flatpak should have no releases URL, got %q", url)
	}
}

func TestUpdateGuidance_ManagedDownloads(t *testing.T) {
	for _, it := range []string{installAppImage, installLinuxPackage} {
		cmd, instructions, url := updateGuidance(it)
		if cmd != "" {
			t.Fatalf("%s should have no command, got %q", it, cmd)
		}
		if instructions == "" {
			t.Fatalf("%s should have instructions", it)
		}
		if url != releasesPageURL {
			t.Fatalf("%s should point at the releases page, got %q", it, url)
		}
	}
}

func TestUpdateGuidance_SelfUpdateTypesHaveNoInstructions(t *testing.T) {
	for _, it := range []string{installMacOS, installWindows, installLinuxPortable} {
		cmd, instructions, _ := updateGuidance(it)
		if cmd != "" || instructions != "" {
			t.Fatalf("%s (self-update) should have empty command/instructions, got cmd=%q instructions=%q", it, cmd, instructions)
		}
	}
}

func TestIsFlatpak(t *testing.T) {
	t.Setenv("FLATPAK_ID", "")
	if isFlatpak() {
		t.Fatal("should not detect flatpak when FLATPAK_ID is empty")
	}
	t.Setenv("FLATPAK_ID", "app.mqttviewer.MQTTViewer")
	if !isFlatpak() {
		t.Fatal("should detect flatpak when FLATPAK_ID is set")
	}
}
