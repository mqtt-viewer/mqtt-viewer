import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Notification } from "./notifications";

const mocks = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
}));

vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  CheckForUpdates: (...args: unknown[]) => mocks.checkForUpdates(...args),
}));

// The store only uses this module for types, but the generated file imports
// @wailsio/runtime, which needs a window at load time.
vi.mock("bindings/mqtt-viewer/backend/update/models", () => ({}));

const DISMISSED_STORAGE_KEY = "mqtt-viewer-dismissed-update";
const POLL_DELAY_MS = 2 * 1000;
const POLL_INTERVAL_MS = 10 * 60 * 1000;

const dockerUpdate = {
  latest_version: "1.2.0",
  release_notes: "notes",
  can_self_update: false,
  install_type: "docker",
  update_command: "docker pull ghcr.io/mqtt-viewer/mqtt-viewer:latest",
  instructions: "Pull the new image and recreate the container:",
  releases_url: "https://github.com/mqtt-viewer/mqtt-viewer/releases",
};

// A minimal Map-backed localStorage for the node test environment. The store
// only uses getItem/setItem/removeItem.
const createLocalStorage = () => {
  const backing = new Map<string, string>();
  return {
    getItem: (key: string): string | null => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backing.set(key, String(value));
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
  };
};

type UpdateStoreModule = typeof import("./update");
type NotificationsModule = typeof import("./notifications");

let unsubscribe: (() => void) | null = null;

// Imports a fresh module graph so the update store's writable and the
// notifications singleton both start clean, then subscribes so polling starts.
const loadStores = async () => {
  vi.resetModules();
  const updateStore = ((await import("./update")) as UpdateStoreModule)
    .default;
  const notifications = ((await import("./notifications")) as NotificationsModule)
    .default;
  unsubscribe = updateStore.subscribe(() => {});
  return { updateStore, notifications };
};

const findNotification = (
  notifications: NotificationsModule["default"],
  version: string
): Notification | undefined =>
  get(notifications).notifications.find(
    (n) => n.id === `available-update-${version}`
  );

describe("update store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", createLocalStorage());
    mocks.checkForUpdates.mockReset();
  });

  afterEach(() => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("server mode: a manual-instruction update shows the command and not the self-update text", async () => {
    mocks.checkForUpdates.mockResolvedValue(dockerUpdate);
    const { updateStore, notifications } = await loadStores();

    expect(mocks.checkForUpdates).not.toHaveBeenCalled();
    expect(get(updateStore).hasCheckedOnce).toBe(false);

    await vi.advanceTimersByTimeAsync(POLL_DELAY_MS);

    // Server builds are polled too: the first check fires after the delay.
    expect(mocks.checkForUpdates).toHaveBeenCalledOnce();

    const state = get(updateStore);
    expect(state.availableUpdate).not.toBeNull();
    expect(state.availableUpdate?.can_self_update).toBe(false);
    expect(state.hasCheckedOnce).toBe(true);

    const notification = findNotification(notifications, "1.2.0");
    expect(notification).toBeDefined();
    expect(notification?.message).toContain(
      "docker pull ghcr.io/mqtt-viewer/mqtt-viewer:latest"
    );
    expect(notification?.message).not.toContain("download and install");
    expect(notification?.seen).toBe(false);
  });

  it("a Home Assistant add-on update has no command and a trailing colon stripped", async () => {
    const instructions =
      "Update the MQTT Viewer add-on from the add-on store in Home Assistant.";
    mocks.checkForUpdates.mockResolvedValue({
      ...dockerUpdate,
      install_type: "home-assistant",
      update_command: "",
      instructions,
    });
    const { notifications } = await loadStores();

    await vi.advanceTimersByTimeAsync(POLL_DELAY_MS);

    const notification = findNotification(notifications, "1.2.0");
    expect(notification).toBeDefined();
    expect(notification?.message).toBe(instructions);
  });

  it("dismissing the notification persists across polls", async () => {
    mocks.checkForUpdates.mockResolvedValue(dockerUpdate);
    const first = await loadStores();

    await vi.advanceTimersByTimeAsync(POLL_DELAY_MS);

    const notification = findNotification(first.notifications, "1.2.0");
    expect(notification?.onDismiss).toBeDefined();
    notification?.onDismiss?.();
    expect(localStorage.getItem(DISMISSED_STORAGE_KEY)).toBe("1.2.0");

    // A fresh module graph simulates a reload: the dismissal must survive it.
    unsubscribe?.();
    unsubscribe = null;
    mocks.checkForUpdates.mockClear();
    const second = await loadStores();

    await vi.advanceTimersByTimeAsync(POLL_DELAY_MS);

    expect(mocks.checkForUpdates).toHaveBeenCalledOnce();
    const reloaded = findNotification(second.notifications, "1.2.0");
    expect(reloaded).toBeDefined();
    expect(reloaded?.seen).toBe(true);
  });

  it("a newer version re-notifies after an older one was dismissed", async () => {
    mocks.checkForUpdates.mockResolvedValueOnce(dockerUpdate);
    const { updateStore, notifications } = await loadStores();

    await vi.advanceTimersByTimeAsync(POLL_DELAY_MS);

    findNotification(notifications, "1.2.0")?.onDismiss?.();
    expect(localStorage.getItem(DISMISSED_STORAGE_KEY)).toBe("1.2.0");

    mocks.checkForUpdates.mockResolvedValueOnce({
      ...dockerUpdate,
      latest_version: "1.3.0",
    });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(get(updateStore).availableUpdate?.latest_version).toBe("1.3.0");
    expect(findNotification(notifications, "1.2.0")).toBeUndefined();

    const newer = findNotification(notifications, "1.3.0");
    expect(newer).toBeDefined();
    expect(newer?.seen).toBe(false);
  });

  it("no update clears the notification and the dismissed version", async () => {
    mocks.checkForUpdates.mockResolvedValueOnce(dockerUpdate);
    const { updateStore, notifications } = await loadStores();

    await vi.advanceTimersByTimeAsync(POLL_DELAY_MS);

    findNotification(notifications, "1.2.0")?.onDismiss?.();
    expect(localStorage.getItem(DISMISSED_STORAGE_KEY)).toBe("1.2.0");

    mocks.checkForUpdates.mockResolvedValueOnce(null);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(2);
    const state = get(updateStore);
    expect(state.availableUpdate).toBeNull();
    expect(state.isUpdateDialogOpen).toBe(false);
    expect(state.hasCheckedOnce).toBe(true);
    expect(findNotification(notifications, "1.2.0")).toBeUndefined();
    expect(localStorage.getItem(DISMISSED_STORAGE_KEY)).toBeNull();
  });

  it("markVersionSeen quietens the bell entry", async () => {
    mocks.checkForUpdates.mockResolvedValue(dockerUpdate);
    const { updateStore, notifications } = await loadStores();

    await vi.advanceTimersByTimeAsync(POLL_DELAY_MS);

    expect(findNotification(notifications, "1.2.0")?.seen).toBe(false);

    updateStore.markVersionSeen("1.2.0");

    const notification = findNotification(notifications, "1.2.0");
    expect(notification).toBeDefined();
    expect(notification?.seen).toBe(true);
    expect(localStorage.getItem(DISMISSED_STORAGE_KEY)).toBe("1.2.0");
  });
});
