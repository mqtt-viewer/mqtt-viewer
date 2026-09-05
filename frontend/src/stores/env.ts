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

// In server mode System.Environment() reports the container's GOOS, which is
// always linux and says nothing about the machine the browser is running on.
// The platform booleans drive OS-specific UI (macOS traffic-light padding, a
// GTK resize workaround), so in the browser they have to come from the browser.
const platformFromNavigator = (): string => {
  const hint = `${navigator.userAgent} ${navigator.platform ?? ""}`;
  if (/Mac|iPhone|iPad|iPod/i.test(hint)) return "darwin";
  if (/Win/i.test(hint)) return "windows";
  return "linux";
};

const init = async () => {
  // GetEnvInfo is a normal binding in both modes. Read it before touching
  // native Window/System APIs so browser mode never makes calls that can only
  // fail in Wails' headless server.
  try {
    const configuredEnv = await GetEnvInfo();
    if (configuredEnv.isServerMode) {
      const platform = platformFromNavigator();
      update((store) => ({
        ...store,
        env: {
          buildType: configuredEnv.isDev ? "dev" : "production",
          platform,
          arch: "",
        },
        version: configuredEnv.version,
        isServerMode: true,
        isMac: platform === "darwin",
        isWindows: platform === "windows",
        isLinux: platform === "linux",
      }));
      return;
    }
    update((store) => ({
      ...store,
      version: configuredEnv.version,
      isServerMode: false,
    }));
  } catch (e) {
    console.error(e);
  }

  window.addEventListener("resize", debouncedCheckFullscreen, true);
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
