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
  try {
    window.addEventListener("resize", debouncedCheckFullscreen, true);
    const info = await System.Environment();
    const env = {
      buildType: info.Debug ? "dev" : "production",
      platform: info.OS,
      arch: info.Arch,
    };
    const isFullscreen = await Window.IsFullscreen();
    const configuredEnv = await GetEnvInfo();
    set({
      env,
      isFullscreen,
      version: configuredEnv.version,
      isMac: env.platform === "darwin",
      isWindows: env.platform === "windows",
      isLinux: env.platform === "linux",
      isBeta: IS_BETA,
    });
  } catch (e) {
    console.error(e);
  }
};

export default {
  subscribe,
  init,
};
