import { get, writable } from "svelte/store";
import { System, Window } from "@wailsio/runtime";
import _ from "lodash";
import { GetEnvInfo } from "bindings/mqtt-viewer/backend/app/app";

// 1.0 shipped — the BETA badge is retired.
const IS_BETA = false;

interface EnvStore {
  env: {
    buildType: string;
    platform: string;
    arch: string;
  };
  version: string;
  isMac: boolean;
  isWindows: boolean;
  isLinux: boolean;
  isFullscreen: boolean;
  isBeta: boolean;
  isServerMode: boolean;
}

const { subscribe, set, update } = writable<EnvStore>({
  env: {
    buildType: "",
    platform: "",
    arch: "",
  },
  version: "",
  isMac: false,
  isWindows: false,
  isLinux: false,
  isFullscreen: false,
  isBeta: IS_BETA,
  isServerMode: false,
});

const debouncedCheckFullscreen = _.debounce(async () => {
  const isFullscreen = await Window.IsFullscreen();
  update((store) => {
    return {
      ...store,
      isFullscreen,
    };
  });
}, 100);

const init = async () => {
  window.addEventListener("resize", debouncedCheckFullscreen, true);

  // GetEnvInfo carries version + isServerMode and must land in the store even
  // if the native Window/System calls below fail. In a browser (server mode)
  // those native calls reject, and a single try/catch around everything would
  // otherwise leave version and isServerMode unset.
  let isServerMode = false;
  try {
    const configuredEnv = await GetEnvInfo();
    isServerMode = configuredEnv.isServerMode;
    update((store) => ({
      ...store,
      version: configuredEnv.version,
      isServerMode: configuredEnv.isServerMode,
    }));
  } catch (e) {
    console.error(e);
  }

  // Native environment probing. Headless in server mode these are no-ops that
  // reject, so keep them in their own try/catch with sensible fallbacks.
  try {
    const info = await System.Environment();
    const platform = info.OS;
    const isFullscreen = await Window.IsFullscreen();
    update((store) => ({
      ...store,
      env: {
        buildType: info.Debug ? "dev" : "production",
        platform,
        arch: info.Arch,
      },
      isFullscreen,
      isMac: platform === "darwin",
      isWindows: platform === "windows",
      isLinux: platform === "linux",
    }));
  } catch (e) {
    console.error(e);
  }
};

export default {
  subscribe,
  init,
};
