{
  lib,
  stdenvNoCC,
  nodejs,
  pnpm_10,
  pnpmConfigHook,
  fetchPnpmDeps,
  src,
  version,
}:

# The pnpm store hash below is deliberately NOT keyed per system.
#
# A pnpm store would ordinarily be platform specific, because pnpm resolves the
# optional dependencies of esbuild/rollup (@esbuild/linux-arm64 vs
# @esbuild/linux-x64, @rollup/rollup-linux-*-gnu) for the machine it runs on.
# nixpkgs' fetchPnpmDeps sidesteps that: its installPhase runs
#   pnpm install --force --ignore-scripts --frozen-lockfile
# and `--force` exists precisely so the fetch pulls in every platform's
# optional packages rather than just the host's. The resulting tarball is
# therefore identical across Linux architectures.
#
# Verified, not assumed: building .#packages.<sys>.mqtt-viewer-frontend.pnpmDeps
# on aarch64-linux and again on x86_64-linux reported the same hash
# (sha256-hIQFX+RPOA9ETSWuJM3QcG+dwxZM1tEl0lNxU1kCESw=). Should a future
# fetcherVersion drop --force, this becomes a per-system attrset again.

# frontend/package.json pins packageManager to pnpm@10.28.0 while nixpkgs
# pnpm_10 is currently 10.34.5. Both speak lockfileVersion 9.0, so the
# committed pnpm-lock.yaml installs cleanly; the drift is noted rather than
# worked around (COREPACK_ENABLE_STRICT would need network access).
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "mqtt-viewer-frontend";
  inherit version src;

  # Top-level pnpmConfigHook, not the deprecated pnpm_10.configHook. The hook
  # does not bring its own pnpm, so pnpm_10 goes in alongside it. It links
  # pnpmDeps into a store and runs an offline `pnpm install` rooted at
  # pnpmRoot, which defaults to the source root: hence src being the frontend
  # directory rather than the repo root.
  nativeBuildInputs = [
    nodejs
    pnpm_10
    pnpmConfigHook
  ];

  # Top-level fetchPnpmDeps rather than pnpm_10.fetchDeps: the latter is
  # deprecated. fetcherVersion 1 and 2 were both removed in nixpkgs 26.11, so
  # this is on 4 (the newest the fetcher supports).
  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    pnpm = pnpm_10;
    fetcherVersion = 4;
    hash = "sha256-hIQFX+RPOA9ETSWuJM3QcG+dwxZM1tEl0lNxU1kCESw=";
  };

  # build/Taskfile.yml sets PRODUCTION=true for the frontend build. Nothing in
  # the frontend currently reads it (no import.meta.env.PRODUCTION, no
  # process.env.PRODUCTION), so this is fidelity with the upstream task rather
  # than a functional requirement.
  env.PRODUCTION = "true";

  buildPhase = ''
    runHook preBuild

    # `pnpm run build` is `vite build`; outDir is vite's default, ./dist.
    pnpm run build

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    # main.go embeds this tree with //go:embed all:frontend/dist, and an empty
    # or stub dist compiles perfectly happily into a blank app window. Fail
    # here instead, loudly.
    if [ ! -s dist/index.html ]; then
      echo "error: vite build produced no dist/index.html" >&2
      exit 1
    fi
    if [ -z "$(ls -A dist/assets 2>/dev/null)" ]; then
      echo "error: vite build produced no dist/assets/* bundles" >&2
      exit 1
    fi

    cp -r dist $out

    runHook postInstall
  '';

  meta = {
    description = "Built Svelte frontend assets for MQTT Viewer";
    homepage = "https://mqttviewer.app";
    license = lib.licenses.gpl3Plus;
    platforms = lib.platforms.linux;
    maintainers = [ ];
  };
})
