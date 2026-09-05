import { writable } from "svelte/store";
import * as wailsupdate from "bindings/mqtt-viewer/backend/update/models";
import { CheckForUpdates } from "bindings/mqtt-viewer/backend/app/app";
import notificationStore, { type Notification } from "./notifications";

// The bell entry's dismissed state is a per-browser UI preference, so it lives
// in localStorage: in server mode every tab shares one backend, and one person
// clearing their bell should not clear it for everyone else. "Skip this
// version" is a different, stronger choice (never auto-prompt for it again)
// and is persisted through the backend in AppSettings.ignoredUpdateVersion.
const DISMISSED_STORAGE_KEY = "mqtt-viewer-dismissed-update";

const notificationId = (version: string): string => `available-update-${version}`;

const readDismissedVersion = (): string | null => {
  try {
    return localStorage.getItem(DISMISSED_STORAGE_KEY);
  } catch (e) {
    console.error("error reading dismissed update", e);
    return null;
  }
};

const writeDismissedVersion = (version: string) => {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, version);
  } catch (e) {
    console.error("error storing dismissed update", e);
  }
};

const clearDismissedVersion = () => {
  try {
    localStorage.removeItem(DISMISSED_STORAGE_KEY);
  } catch (e) {
    console.error("error clearing dismissed update", e);
  }
};

const updateMessage = (u: wailsupdate.UpdateResponse): string => {
  if (u.can_self_update) {
    return "Click to download and install the update.";
  }
  if (u.update_command) {
    return `${u.instructions} ${u.update_command}`;
  }
  return u.instructions.replace(/:\s*$/, "");
};

interface UpdatesStore {
  isUpdateDialogOpen: boolean;
  availableUpdate: null | wailsupdate.UpdateResponse;
  // True once the first CheckForUpdates has completed (success or failure),
  // so startup gating can distinguish "no update" from "not checked yet".
  hasCheckedOnce: boolean;
}

const { subscribe, set, update } = writable<UpdatesStore>(
  {
    isUpdateDialogOpen: false,
    availableUpdate: null,
    hasCheckedOnce: false,
  },
  () => {
    // Poll in every mode, including server (Docker) mode: the backend still
    // reports when a newer image exists, just with pull instructions instead
    // of the in-app self-update flow.
    const timeout = setTimeout(() => {
      getAvailableUpdate();
    }, 2 * 1000);
    // Check every 10 minutes
    const interval = setInterval(
      () => {
        getAvailableUpdate();
      },
      10 * 60 * 1000
    );
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }
);

const getAvailableUpdate = async () => {
  try {
    const availableUpdate = await CheckForUpdates();
    update((store) => {
      const previous = store.availableUpdate;
      if (
        previous &&
        (!availableUpdate ||
          previous.latest_version !== availableUpdate.latest_version)
      ) {
        notificationStore.clearNotification(
          notificationId(previous.latest_version)
        );
      }

      if (!availableUpdate) {
        clearDismissedVersion();
        return { ...store, isUpdateDialogOpen: false, availableUpdate: null };
      }

      const notification: Notification = {
        id: notificationId(availableUpdate.latest_version),
        title: `${availableUpdate.latest_version} of MQTT Viewer is available`,
        message: updateMessage(availableUpdate),
        type: "info",
        icon: "download",
        // A dismissal only covers the version it was made for: a newer
        // release shows up unread again.
        seen: readDismissedVersion() === availableUpdate.latest_version,
      };
      // The dialog handles both self-update and manual-instruction cases.
      notification.onClick = openUpdateDialog;
      notification.onDismiss = () =>
        writeDismissedVersion(availableUpdate.latest_version);
      notificationStore.addNotification(notification);

      return {
        ...store,
        availableUpdate,
      };
    });
  } catch (e) {
    console.error(e);
  } finally {
    // Mark the first check as complete even on failure, so startup gating
    // that waits on it never deadlocks when the network is down.
    update((store) => ({ ...store, hasCheckedOnce: true }));
  }
};

const openUpdateDialog = () => {
  update((store) => {
    return {
      ...store,
      isUpdateDialogOpen: true,
    };
  });
};

const closeUpdateDialog = () => {
  update((store) => {
    return {
      ...store,
      isUpdateDialogOpen: false,
    };
  });
};

// markVersionSeen quietens the bell entry for a version without removing it.
// The dialog calls it when the user skips a version: having said "not this
// one", they should not be left with an unread badge for it.
const markVersionSeen = (version: string) => {
  writeDismissedVersion(version);
  notificationStore.markNotificationAsSeen(notificationId(version));
};

export default {
  openUpdateDialog,
  closeUpdateDialog,
  markVersionSeen,
  subscribe,
};
