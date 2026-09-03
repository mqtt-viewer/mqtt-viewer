import { get, writable } from "svelte/store";
import * as wailsupdate from "bindings/mqtt-viewer/backend/update/models";
import { CheckForUpdates } from "bindings/mqtt-viewer/backend/app/app";
import notificationStore, { type Notification } from "./notifications";
import envStore from "./env";

const updateMessage = (u: wailsupdate.UpdateResponse): string => {
  if (u.can_self_update) {
    return "Click to download and install the update.";
  }
  if (u.update_command) {
    return `${u.instructions} ${u.update_command}`;
  }
  return u.instructions;
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
  (set) => {
    // In server mode CheckForUpdates always returns null (the container image
    // is updated by pulling a new tag, not by the in-app updater), so skip the
    // polling entirely. The env store may still be initialising at t+2s, so
    // read it lazily inside each callback rather than at subscribe time.
    setTimeout(async () => {
      if (get(envStore).isServerMode) return;
      getAvailableUpdate();
    }, 2 * 1000);
    // Check every 10 minutes
    setInterval(
      async () => {
        if (get(envStore).isServerMode) return;
        getAvailableUpdate();
      },
      10 * 60 * 1000
    );
  }
);

const getAvailableUpdate = async () => {
  try {
    const availableUpdate = await CheckForUpdates();
    if (availableUpdate) {
      update((store) => {
        if (!!store.availableUpdate && availableUpdate) {
          notificationStore.clearNotification(
            `available-update-${store.availableUpdate.latest_version}`
          );
        }
        if (availableUpdate) {
          const notification: Notification = {
            id: `available-update-${availableUpdate.latest_version}`,
            title: `${availableUpdate.latest_version} of MQTT Viewer is available`,
            message: updateMessage(availableUpdate),
            type: "info",
            icon: "download",
          };
          // The dialog handles both self-update and manual-instruction cases.
          notification.onClick = openUpdateDialog;
          notificationStore.addNotification(notification);
        }
        return {
          ...store,
          availableUpdate,
        };
      });
    }
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

export default {
  openUpdateDialog,
  closeUpdateDialog,
  subscribe,
};
