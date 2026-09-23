{
  lib,
  buildGoModule,
  fetchzip,
  pkg-config,
  gtk3,
  webkitgtk_4_1,
  libsoup_3,
  glib,
}:

let
  # go.mod pins the fork tag v3.0.0-alpha.98-tui, and that tag has since been
  # DELETED from github.com/wailsapp/wails, so fetchFromGitHub cannot resolve
  # it. proxy.golang.org keeps module zips permanently once published, so fetch
  # the module zip from there instead. (This is also why `go install ...@tag`
  # still works while `git checkout tag` does not.)
  goModPath = "github.com/wailsapp/wails/v3@v3.0.0-alpha.98-tui";

  src = fetchzip {
    url = "https://proxy.golang.org/github.com/wailsapp/wails/v3/@v/v3.0.0-alpha.98-tui.zip";
    hash = "sha256-1/pt6p1pUp1HgWlEKym+5Ix9f2M0uwPZn7Uh/Ta2cAo=";
    # The zip already contains the full module path as directory levels.
    stripRoot = false;
    extension = "zip";
  };
in

buildGoModule {
  pname = "wails3";
  # `wails3 version` reports v3.0.0-alpha.98 because the fork tag never bumped
  # internal/version/version.txt. The real module version is the -tui tag.
  version = "3.0.0-alpha.98-tui";

  # Caveat on CLAUDE.md's alignment check. Because this builds from an
  # extracted module zip rather than `go install module@version`, Go cannot
  # stamp a module version, so
  #   go version -m "$(which wails3)" | grep -E '^\s+mod\s'
  # reports `github.com/wailsapp/wails/v3 (devel)`, not the -tui tag. The
  # source is still exactly the pinned tag, guaranteed by the fixed-output
  # hash on `src` below rather than by the binary's own metadata.

  inherit src;
  sourceRoot = "${src.name}/${goModPath}";

  # `go mod vendor` walks every module in the graph and resolves //go:embed
  # patterns for all platforms, which trips over
  # github.com/wailsapp/wails/webview2/webviewloader: its module zip does not
  # ship the prebuilt arm64/WebView2Loader.dll the package embeds. proxyVendor
  # keeps the module download cache instead of vendoring, so embeds are only
  # resolved for the packages actually built here.
  proxyVendor = true;
  vendorHash = "sha256-Moerz6qIC9NMjl09FT1nzcuDjoeVHLeJLPL44H5ECro=";

  subPackages = [ "cmd/wails3" ];

  # Without -tags gtk3 the CLI's cgo pulls in the GTK4 headers; the repo's CI
  # and build tasks pass gtk3 for the same reason.
  tags = [ "gtk3" ];

  nativeBuildInputs = [ pkg-config ];
  buildInputs = [
    gtk3
    webkitgtk_4_1
    libsoup_3
    glib
  ];

  doCheck = false;

  meta = {
    description = "Wails v3 CLI, pinned to the -tui fork tag used by MQTT Viewer's go.mod";
    homepage = "https://wails.io";
    license = lib.licenses.mit;
    mainProgram = "wails3";
    platforms = lib.platforms.linux;
    maintainers = [ ];
  };
}
