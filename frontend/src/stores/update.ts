import { writable } from "svelte/store";
import * as wailsupdate from "bindings/mqtt-viewer/backend/update/models";
import { CheckForUpdates } from "bindings/mqtt-viewer/backend/app/app";
import notificationStore, { type Notification } from "./notifications";

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
  return u.instructions.replace(/:\s*$/, "");
};

interface UpdatesStore {
  isUpdateDialogOpen: boolean;
  availableUpdate: null | wailsupdate.UpdateResponse;
}

const { subscribe, set, update } = writable<UpdatesStore>(
  {
    isUpdateDialogOpen: false,
    availableUpdate: null,
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
        return { isUpdateDialogOpen: false, availableUpdate: null };
      }

      const notification: Notification = {
        id: notificationId(availableUpdate.latest_version),
        title: `${availableUpdate.latest_version} of MQTT Viewer is available`,
        message: updateMessage(availableUpdate),
        type: "info",
        icon: "download",
        seen: readDismissedVersion() === availableUpdate.latest_version,
      };
      // The dialog handles both self-update and manual-instruction cases.
      notification.onClick = openUpdateDialog;
      notification.onDismiss = () =>
        writeDismissedVersion(availableUpdate.latest_version);
      notificationStore.addNotification(notification);

      return {
        isUpdateDialogOpen: store.isUpdateDialogOpen,
        availableUpdate,
      };
    });
  } catch (e) {
    console.error(e);
  }
};

const openUpdateDialog = () => {
  update((store) => {
    return {
      isUpdateDialogOpen: true,
      availableUpdate: store.availableUpdate,
    };
  });
};

const closeUpdateDialog = () => {
  update((store) => {
    return {
      isUpdateDialogOpen: false,
      availableUpdate: store.availableUpdate,
    };
  });
};

export default {
  openUpdateDialog,
  closeUpdateDialog,
  subscribe,
};
