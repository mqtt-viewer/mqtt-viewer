{
  description = "MQTT Viewer: a fast and feature-rich MQTT visualisation and debugging tool";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;

      # Latest release tag is v1.0.0. The ldflag value keeps the leading "v"
      # (backend/env flips IsDev when Version contains "-dev", so a plain
      # release tag gives us a production build).
      version = "1.0.0";

      # Wails on Linux needs the GTK/WebKit stack, so only Linux gets packages.
      # The dev shell is offered everywhere so a mac checkout can still get Go,
      # pnpm and the task runners from the flake.
      linuxSystems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      # aarch64-darwin only, no x86_64-darwin: nixpkgs 26.11 (which
      # nixos-unstable now is) dropped that platform outright, and merely
      # naming it here makes `nix eval` on the dev shell throw
      #   error: Nixpkgs 26.11 has dropped support for x86_64-darwin.
      # An Intel mac would need the input switched to nixpkgs-26.05-darwin.
      allSystems = linuxSystems ++ [ "aarch64-darwin" ];

      # Tiny stand-in for flake-utils.eachSystem: no extra flake input needed.
      forSystems = systems: f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # Two independently filtered sources. The Go build and the frontend build
      # are separate derivations (see nix/package.nix), so keeping their inputs
      # disjoint means editing a .go file does not invalidate the pnpm/vite
      # build and editing a .svelte file does not invalidate the Go build.
      goSrc = lib.fileset.toSource {
        root = ./.;
        fileset = lib.fileset.unions [
          ./go.mod
          ./go.sum
          ./main.go
          ./tools.go
          ./backend
          ./events
          ./loader
          # Consumed by the package's postInstall to install the app icon.
          ./build/appicon.png
        ];
      };

      # fileset.toSource copies whatever is on disk, and on a dev machine
      # frontend/node_modules and frontend/dist very much exist. Subtract every
      # generated tree explicitly; maybeMissing keeps this working on a clean
      # checkout where none of them are present.
      frontendSrc =
        (lib.fileset.toSource {
          root = ./.;
          fileset = lib.fileset.difference ./frontend (
            lib.fileset.unions (
              map lib.fileset.maybeMissing [
                ./frontend/node_modules
                ./frontend/dist
                ./frontend/storybook-static
                ./frontend/coverage
                ./frontend/.svelte-kit
                ./frontend/.task
              ]
            )
          );
        })
        # pnpmConfigHook defaults pnpmRoot to the source root, so hand the
        # frontend directory itself to the derivation rather than the repo root.
        + "/frontend";
    in
    {
      packages = forSystems linuxSystems (pkgs: rec {
        default = mqtt-viewer;

        mqtt-viewer = pkgs.callPackage ./nix/package.nix {
          inherit version mqtt-viewer-frontend;
          src = goSrc;
        };

        mqtt-viewer-frontend = pkgs.callPackage ./nix/frontend.nix {
          inherit version;
          src = frontendSrc;
        };

        # Dev-shell tool only. packages.default never invokes the wails3 CLI:
        # frontend/bindings/ is committed and a CLI from a different tag
        # rewrites every file in it.
        wails3 = pkgs.callPackage ./nix/wails3.nix { };
      });

      devShells = forSystems allSystems (
        pkgs:
        let
          inherit (pkgs) stdenv;
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.go
              pkgs.pnpm_10
              pkgs.nodejs
              pkgs.just
              pkgs.tparse
              pkgs.atlas
              pkgs.git
            ]
            ++ lib.optional stdenv.isLinux self.packages.${stdenv.hostPlatform.system}.wails3;

            # pkg-config discovery for cgo needs these as real build inputs, not
            # as `packages` (which land in PATH but not in the pkg-config path).
            nativeBuildInputs = lib.optionals stdenv.isLinux [ pkgs.pkg-config ];
            buildInputs = lib.optionals stdenv.isLinux [
              pkgs.gtk3
              pkgs.webkitgtk_4_1
              pkgs.libsoup_3
              pkgs.glib
              pkgs.glib-networking
              pkgs.gsettings-desktop-schemas
            ];

            # Untagged, wails v3 selects its GTK4/WebKitGTK 6.0 backend, so a
            # bare `go build ./...` asks pkg-config for gtk4 + webkitgtk-6.0 and
            # fails against the gtk3 stack above. Default the whole shell to the
            # tag the project actually ships (build/linux/Taskfile.yml pins
            # gtk3 for Ubuntu 22.04-era compatibility) so the commands in
            # CLAUDE.md work verbatim. GOFLAGS is only a default: an explicit
            # `-tags production,gtk3` on a command line still wins, so
            # `wails3 dev` and the Taskfile builds are unaffected.
            env.GOFLAGS = lib.optionalString stdenv.isLinux "-tags=gtk3";

            # On darwin the GTK stack does not apply and wails3 itself wants the
            # Xcode frameworks, so getting the CLI there is left to
            #   go install -tags gtk3 github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.16
            shellHook = ''
              # main.go has //go:embed all:frontend/dist, so `go build ./...`
              # fails outright on a fresh checkout. Stub it once, and never
              # touch a real build (vite empties dist on every build, so the
              # stub cannot be committed). Same workaround as CLAUDE.md and
              # build/Taskfile.yml's generate:bindings task.
              if [ ! -d frontend/dist ]; then
                mkdir -p frontend/dist
                echo "<html></html>" > frontend/dist/index.html
                echo "nix: stubbed frontend/dist/index.html so go build works; run 'pnpm build' in frontend/ for the real thing"
              fi
              echo "nix: dev shell ready${lib.optionalString stdenv.isLinux " (GOFLAGS=-tags=gtk3)"}; 'just dev' to run the app"
            '';
          };
        }
      );

      checks = forSystems linuxSystems (
        pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;
          inherit (self.packages.${system}) mqtt-viewer mqtt-viewer-frontend wails3;
        in
        {
          package = mqtt-viewer;
          frontend = mqtt-viewer-frontend;
          inherit wails3;

          # There is deliberately no `go-tests` check. `go test ./...` is not
          # hermetic in a Nix sandbox, for two independent reasons:
          #
          #  1. backend/env's init() panics when /etc/machine-id is absent,
          #     which it is in the sandbox (and /etc there is read-only, so it
          #     cannot be faked). Every package that transitively imports
          #     backend/env therefore dies at init: backend/app, backend/cloud,
          #     backend/db, backend/env, backend/models, backend/update.
          #  2. backend/mqtt's TestConnectV3/V5, TestV3ConnectWs and
          #     TestV3PubSub/V5PubSub dial a live broker on localhost:1883.
          #
          # backend/util's TestDownloadFile also fetches over HTTPS, so it only
          # passes where the sandbox leaks network. Run the suite with
          # `just test` (or `nix develop -c just test`) against a real broker
          # instead. go-vet below covers compile-time correctness.
          #
          # go-vet reuses the package's goModules, buildInputs and preBuild
          # (frontend/dist has to exist before anything can typecheck the
          # //go:embed) and only swaps the build phase. nativeBuildInputs is
          # deliberately left alone: overriding it drops the Go toolchain that
          # buildGoModule injects. The GTK install hooks are disabled instead,
          # since this derivation produces a stamp file, not an app.
          go-vet = mqtt-viewer.overrideAttrs (_: {
            pname = "mqtt-viewer-go-vet";
            # Renaming pname would otherwise rename the goModules fixed-output
            # derivation too, refetching the whole module cache under a new
            # store path for identical content. Pin it to the package's own.
            goModules = mqtt-viewer.goModules;
            desktopItems = [ ];
            dontWrapGApps = true;
            buildPhase = ''
              runHook preBuild
              go vet -tags production,gtk3 ./...
              runHook postBuild
            '';
            doCheck = false;
            installPhase = ''
              runHook preInstall
              touch $out
              runHook postInstall
            '';
            postInstall = "";
            # $out here is a stamp file, not a directory, so the package's
            # libexec/ relocation (see nix/package.nix postFixup) would fail
            # with "mkdir: cannot create directory: Not a directory".
            postFixup = "";
          });

          # Both frontend checks pin pnpmDeps for the same reason go-vet pins
          # goModules: pnpmDeps is derived from finalAttrs.pname, so renaming
          # the derivation would refetch the entire pnpm store under a new name.
          svelte-check = mqtt-viewer-frontend.overrideAttrs (_: {
            pname = "mqtt-viewer-svelte-check";
            pnpmDeps = mqtt-viewer-frontend.pnpmDeps;
            buildPhase = ''
              runHook preBuild
              pnpm run check
              runHook postBuild
            '';
            installPhase = ''
              runHook preInstall
              touch $out
              runHook postInstall
            '';
          });

          # vitest's "unit" project only. The "storybook" project is
          # deliberately excluded: it drives a real Chromium through
          # Playwright, which is not hermetic here.
          frontend-tests = mqtt-viewer-frontend.overrideAttrs (_: {
            pname = "mqtt-viewer-frontend-tests";
            pnpmDeps = mqtt-viewer-frontend.pnpmDeps;
            buildPhase = ''
              runHook preBuild
              pnpm run test:run
              runHook postBuild
            '';
            installPhase = ''
              runHook preInstall
              touch $out
              runHook postInstall
            '';
          });
        }
      );

      # pkgs.nixfmt is the RFC-style formatter now; nixfmt-rfc-style still
      # resolves but warns that it is the same derivation.
      formatter = forSystems allSystems (pkgs: pkgs.nixfmt);
    };
}
