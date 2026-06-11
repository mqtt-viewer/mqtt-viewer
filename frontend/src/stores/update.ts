import { writable } from "svelte/store";
import * as wailsupdate from "bindings/mqtt-viewer/backend/update/models";
import { CheckForUpdates } from "bindings/mqtt-viewer/backend/app/app";
import notificationStore, { type Notification } from "./notifications";
import { Browser } from "@wailsio/runtime";

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
            message: availableUpdate.notification_text,
            type: "info",
            icon: "download",
          };
          if (availableUpdate.can_update) {
            // Self-updatable install: confirm, then hand over to the
            // built-in Wails updater window.
            notification.onClick = openUpdateDialog;
          } else if (availableUpdate.notification_url) {
            // Managed installs (AppImage/deb/rpm) or unlicensed updates:
            // send the user to the right place instead.
            notification.onClick = () => {
              Browser.OpenURL(availableUpdate.notification_url);
            };
          }
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
