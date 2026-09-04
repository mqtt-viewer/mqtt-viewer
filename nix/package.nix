{
  lib,
  buildGoModule,
  pkg-config,
  wrapGAppsHook3,
  copyDesktopItems,
  makeDesktopItem,
  gtk3,
  webkitgtk_4_1,
  libsoup_3,
  glib,
  glib-networking,
  gsettings-desktop-schemas,
  mqtt-viewer-frontend,
  src,
  version,
}:

# Notes for upstreaming this to nixpkgs, where a flake-local filtered source is
# not available:
#   * `src` becomes `fetchFromGitHub { owner = "mqtt-viewer"; repo =
#     "mqtt-viewer"; tag = "v${version}"; hash = ...; }`.
#   * The two filesets in flake.nix collapse into that single src. The frontend
#     derivation then takes the same src with `sourceRoot = "${src.name}/frontend"`
#     instead of being handed a pre-filtered subdirectory.
#   * `version` and the frontend derivation stop being callPackage arguments:
#     version is set inline and the frontend is a `passthru`/`let`-bound
#     derivation in the same file (the usual nixpkgs shape for a two-stage
#     build).
buildGoModule (finalAttrs: {
  pname = "mqtt-viewer";
  inherit version src;

  # buildGoModule's default `go mod vendor` cannot work on this dependency
  # graph. Vendoring resolves //go:embed patterns for every platform, and
  # github.com/wailsapp/wails/webview2/webviewloader embeds
  # arm64/WebView2Loader.dll, a prebuilt Windows binary that is absent from the
  # published module zip:
  #   go: resolving embeds in github.com/wailsapp/wails/webview2/webviewloader:
  #       pattern arm64/WebView2Loader.dll: no matching files found
  # proxyVendor keeps the module download cache instead, so embeds are only
  # resolved for the packages this build actually compiles.
  proxyVendor = true;
  vendorHash = "sha256-+PDkkQRRg4RSegjFZXxitF0tdEzNUDmuIf97f0ALrro=";

  # Mirrors build/linux/Taskfile.yml's production build:
  #   -tags production,gtk3, CGO_ENABLED=1, -ldflags "-w -s -X ...env.Version"
  # gtk3 keeps the app on the WebKit2GTK 4.1 stack, matching upstream's
  # Ubuntu 22.04-era compatibility choice.
  tags = [
    "production"
    "gtk3"
  ];

  ldflags = [
    "-s"
    "-w"
    "-X"
    "mqtt-viewer/backend/env.Version=v${finalAttrs.version}"
  ];

  # loader/ is an Atlas schema-dump helper and tools.go is build-tagged; only
  # the root package is the shipped app.
  subPackages = [ "." ];

  # doCheck is left at buildGoModule's default (true), but because subPackages
  # narrows the build to ".", checkPhase only ever reports
  #   ? mqtt-viewer [no test files]
  # The suite proper is not runnable in a sandbox; see the comment on `checks`
  # in flake.nix for why, and use `just test` against a live broker.

  nativeBuildInputs = [
    pkg-config
    # Wraps bin/mqtt-viewer so GTK finds its runtime data: the observed wrapper
    # prefixes GIO_EXTRA_MODULES (dconf + glib-networking) and XDG_DATA_DIRS
    # (gsettings-desktop-schemas, gtk+3 schemas, and this package's own share/).
    wrapGAppsHook3
    copyDesktopItems
  ];

  buildInputs = [
    # cgo pkg-config set for -tags gtk3: gtk+-3.0, gdk-3.0, webkit2gtk-4.1,
    # gio-unix-2.0, libsoup-3.0.
    gtk3
    webkitgtk_4_1
    libsoup_3
    glib
    # libsoup has no TLS of its own; glib-networking supplies the GIO TLS
    # backend, without which every wss:// / mqtts:// fetch inside the webview
    # fails. Picked up via GIO_EXTRA_MODULES by wrapGAppsHook3.
    glib-networking
    # The stock GSettings schemas (org.gnome.desktop.interface and friends)
    # that GTK reads on startup; wrapGAppsHook3 puts them on
    # GSETTINGS_SCHEMA_DIR.
    gsettings-desktop-schemas
  ];

  # main.go has //go:embed all:frontend/dist, so the built frontend has to be
  # in place before the Go compiler runs. This is the whole reason the build is
  # split in two.
  preBuild = ''
    mkdir -p frontend
    # Store paths are read-only; the Go toolchain does not need to write here
    # but keeping the tree writable avoids surprises in later phases.
    cp -r --no-preserve=mode,ownership ${mqtt-viewer-frontend} frontend/dist
  '';

  postInstall = ''
    install -Dm444 build/appicon.png \
      $out/share/icons/hicolor/512x512/apps/mqtt-viewer.png
  '';

  # GTK takes WM_CLASS from argv[0], because main.go never sets
  # Linux.ProgramName. wrapGAppsHook3's in-place wrapping renames the real ELF
  # to .mqtt-viewer-wrapped, so the window came up as
  #   0x200002 "MQTT Viewer": (".mqtt-viewer-wrapped" ".mqtt-viewer-wrapped")
  # and never matched the StartupWMClass below, leaving the running app detached
  # from its own launcher icon (verified under Xvfb with xwininfo).
  #
  # A wrapper --argv0 does not fix it: main.go runs under panicwrap, which
  # re-execs the binary through os.Executable(), and it is that child process
  # which owns the window. So the real ELF's own basename has to be
  # "mqtt-viewer". Keep it under libexec/ and put the wrapper in bin/ instead of
  # wrapping in place.
  dontWrapGApps = true;
  postFixup = ''
    mkdir -p $out/libexec/mqtt-viewer
    mv $out/bin/mqtt-viewer $out/libexec/mqtt-viewer/mqtt-viewer
    makeWrapper $out/libexec/mqtt-viewer/mqtt-viewer $out/bin/mqtt-viewer \
      "''${gappsWrapperArgs[@]}"
  '';

  # Mirrors build/linux/flatpak/app.mqttviewer.MQTTViewer.desktop, except the
  # icon/name use the plain binary name rather than the Flatpak app ID.
  desktopItems = [
    (makeDesktopItem {
      name = "mqtt-viewer";
      desktopName = "MQTT Viewer";
      comment = "A fast and feature-rich MQTT visualization and debugging tool";
      exec = "mqtt-viewer";
      icon = "mqtt-viewer";
      terminal = false;
      categories = [
        "Development"
        "Utility"
        "Network"
      ];
      keywords = [
        "MQTT"
        "IoT"
        "broker"
        "messaging"
        "Sparkplug"
      ];
      startupWMClass = "mqtt-viewer";
    })
  ];

  meta = {
    description = "Fast and feature-rich MQTT visualisation and debugging tool";
    homepage = "https://mqttviewer.app";
    license = lib.licenses.gpl3Plus;
    mainProgram = "mqtt-viewer";
    platforms = lib.platforms.linux;
    maintainers = [ ];
    sourceProvenance = [ lib.sourceTypes.fromSource ];
  };
})
