import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEnvInfo: vi.fn(),
  getPanelSizes: vi.fn(),
  systemEnvironment: vi.fn(),
  windowIsFullscreen: vi.fn(),
  windowSize: vi.fn(),
  otherStoreInit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  GetEnvInfo: (...args: unknown[]) => mocks.getEnvInfo(...args),
  GetPanelSizes: (...args: unknown[]) => mocks.getPanelSizes(...args),
  UpdatePanelSize: vi.fn(),
}));

vi.mock("@wailsio/runtime", () => ({
  System: { Environment: mocks.systemEnvironment },
  Window: {
    IsFullscreen: mocks.windowIsFullscreen,
    Size: mocks.windowSize,
  },
}));

vi.mock("./connections", () => ({
  default: { init: mocks.otherStoreInit },
}));
vi.mock("./tabs", () => ({ default: { init: mocks.otherStoreInit } }));
vi.mock("./subscriptions", () => ({
  default: { init: mocks.otherStoreInit },
}));
vi.mock("./default-sorts", () => ({
  default: { init: mocks.otherStoreInit },
}));
vi.mock("./chart-windows", () => ({
  default: { init: mocks.otherStoreInit },
}));
vi.mock("./topic-panel-dock", () => ({
  default: { init: mocks.otherStoreInit },
}));

describe("startup initialization", () => {
  it("initializes server environment before panels without native calls", async () => {
    let resolveEnv!: (value: {
      isServerMode: boolean;
      isDev: boolean;
      version: string;
    }) => void;
    mocks.getEnvInfo.mockReturnValue(
      new Promise((resolve) => {
        resolveEnv = resolve;
      })
    );
    mocks.getPanelSizes.mockResolvedValue([
      { id: "topic-tree", size: 360, isOpen: true },
    ]);
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0", platform: "Linux" });
    vi.stubGlobal("window", { innerWidth: 1440, innerHeight: 900 });

    const initialization = (await import("./initialization")).default;
    const panelSizes = (await import("./panel-sizes")).default;
    const init = initialization.init();

    await vi.waitFor(() => expect(mocks.getEnvInfo).toHaveBeenCalledOnce());
    expect(mocks.getPanelSizes).not.toHaveBeenCalled();

    resolveEnv({ isServerMode: true, isDev: false, version: "1.2.3" });
    await init;

    expect(mocks.systemEnvironment).not.toHaveBeenCalled();
    expect(mocks.windowIsFullscreen).not.toHaveBeenCalled();
    expect(mocks.windowSize).not.toHaveBeenCalled();
    expect(mocks.getPanelSizes).toHaveBeenCalledOnce();
    expect(get(panelSizes)).toEqual({
      rootWindowWidth: 1440,
      rootWindowHeight: 900,
      resizablePanelSizes: {
        "topic-tree": { size: 360, isOpen: true },
      },
    });
    expect(get(initialization)).toEqual({ appIsReady: true });

    vi.unstubAllGlobals();
  });

  it("rejects and stays not ready when the environment cannot be read", async () => {
    const failure = new Error("GetEnvInfo failed");
    mocks.getEnvInfo.mockRejectedValue(failure);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0", platform: "Linux" });
    vi.stubGlobal("window", {
      innerWidth: 1440,
      innerHeight: 900,
      addEventListener: vi.fn(),
    });

    // The first test left the cached module's store at appIsReady: true, so
    // start from a fresh module instance.
    vi.resetModules();
    const initialization = (await import("./initialization")).default;

    await expect(initialization.init()).rejects.toBe(failure);
    expect(get(initialization)).toEqual({ appIsReady: false });
    expect(consoleError).toHaveBeenCalledWith(failure);

    consoleError.mockRestore();
    vi.unstubAllGlobals();
  });
});
