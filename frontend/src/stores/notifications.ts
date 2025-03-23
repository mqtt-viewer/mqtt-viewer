import type { IconType } from "@/components/Icon/icons";
import { writable } from "svelte/store";
import { events } from "wailsjs/go/models";
import { EventsOn } from "wailsjs/runtime/runtime";

export type Notification = {
  id: string;
  title: string;
  message: string;
  type: "info" | "warning" | "error";
  icon?: IconType;
  onClick?: () => void;
  seen?: boolean;
};
interface NotificationsStore {
  notifications: Notification[];
}

const { subscribe, set, update } = writable<NotificationsStore>({
  notifications: [],
});

const addNotification = (
  notification: Notification,
  options?: {
    replace?: boolean;
  }
) => {
  update((store) => {
    console.log("received notification", notification);
    const existingNotificationIndex = store.notifications.findIndex(
      (n) => n.id === notification.id
    );
    if (existingNotificationIndex !== -1) {
      if (!options?.replace) {
        return store;
      }
      const newNotifications = [...store.notifications];
      newNotifications[existingNotificationIndex] = notification;
      return {
        notifications: newNotifications,
      };
    }
    return {
      notifications: [...store.notifications, notification],
    };
  });
};

const clearNotification = (id: string) => {
  update((store) => {
    return {
      notifications: store.notifications.filter((n) => n.id !== id),
    };
  });
};

const markNotificationAsSeen = (id: string) => {
  update((store) => {
    return {
      notifications: store.notifications.map((n) => {
        if (n.id === id) {
          return {
            ...n,
            seen: true,
          };
        }
        return n;
      }),
    };
  });
};

export default {
  subscribe,
  addNotification,
  clearNotification,
  markNotificationAsSeen,
};
