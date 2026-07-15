import { writable } from "svelte/store";
import * as wailsupdate from "bindings/mqtt-viewer/backend/update/models";
import { CheckForUpdates } from "bindings/mqtt-viewer/backend/app/app";
import notificationStore, { type Notification } from "./notifications";

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
}

const { subscribe, set, update } = writable<UpdatesStore>(
  {
    isUpdateDialogOpen: false,
    availableUpdate: null,
  },
  (set) => {
    setTimeout(async () => {
      getAvailableUpdate();
    }, 2 * 1000);
    // Check every 10 minutes
    setInterval(
      async () => {
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
          isUpdateDialogOpen: store.isUpdateDialogOpen,
          availableUpdate,
        };
      });
    }
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
