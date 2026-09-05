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
  # Fetch the module zip from proxy.golang.org rather than the git repo: the
  # v3 module lives in a subdirectory of a large repo, and the zip is only the
  # module tree, exactly as `go install ...@tag` sees it.
  goModPath = "github.com/wailsapp/wails/v3@v3.0.0-beta.16";

  src = fetchzip {
    url = "https://proxy.golang.org/github.com/wailsapp/wails/v3/@v/v3.0.0-beta.16.zip";
    # TODO: regenerate. nix was not available when the pin moved to beta.16;
    # build once with this placeholder and paste the hash nix reports.
    hash = lib.fakeHash;
    # The zip already contains the full module path as directory levels.
    stripRoot = false;
    extension = "zip";
  };
in

buildGoModule {
  pname = "wails3";
  version = "3.0.0-beta.16";

  # Caveat on CLAUDE.md's alignment check. Because this builds from an
  # extracted module zip rather than `go install module@version`, Go cannot
  # stamp a module version, so
  #   go version -m "$(which wails3)" | grep -E '^\s+mod\s'
  # reports `github.com/wailsapp/wails/v3 (devel)`, not the tag. The
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
  # TODO: regenerate alongside the `src` hash above.
  vendorHash = lib.fakeHash;

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
    description = "Wails v3 CLI, pinned to the tag used by MQTT Viewer's go.mod";
    homepage = "https://wails.io";
    license = lib.licenses.mit;
    mainProgram = "wails3";
    platforms = lib.platforms.linux;
    maintainers = [ ];
  };
}
