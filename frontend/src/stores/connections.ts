import {
  ConnectMqtt,
  DisconnectMqtt,
  DeleteConnection,
  UpdateConnection,
  GetAllConnections,
  NewConnection,
} from "bindings/mqtt-viewer/backend/app/app";
import { get, writable } from "svelte/store";
import * as events from "bindings/mqtt-viewer/events/models";
import type * as app from "bindings/mqtt-viewer/backend/app/models";
import { Events } from "@wailsio/runtime";
import tabsStore from "@/stores/tabs";
import subscriptionsStore, { type Subscription } from "./subscriptions";
import type { DeepOmit } from "@/util/types";
//@ts-ignore - unsure why this is throwing type errors
import { addToast } from "@/components/Toast/Toast.svelte";
import tabs from "@/stores/tabs";
import subscriptions from "./subscriptions";

export type ConnectionState =
  | "connected"
  | "disconnected"
  | "connecting"
  | "reconnecting";

export type Connection = DeepOmit<
  DeepOmit<app.Connection, "subscriptions" | "isConnected">,
  "convertValues"
> & {
  connectionString: string;
  protoLoadError?: string;
  connectionState: ConnectionState;
  showDataPageWhileDisconnected: boolean;
  firstConnectedThisSessionAtMs?: number;
  latencyMs?: number;
  // True only for a connection just created this session, until its details
  // dialog has been shown once (see acknowledgeConnectionCreated).
  justCreated?: boolean;
};

interface ConnectionStore {
  connections: {
    [connId: number]: Connection;
  };
}

const { subscribe, set, update } = writable<ConnectionStore>({
  connections: {},
});

const init = async () => {
  try {
    let { connections: appConnections } = await GetAllConnections();
    const connections: ConnectionStore["connections"] = {};
    const connectionsArray: Connection[] = [];
    Object.keys(appConnections).forEach((id) => {
      const connId = parseInt(id);
      const appConn = appConnections[id as `${number}`];
      if (!appConn) return;
      const connection = getConnectionFromAppConnection(appConn);
      connections[connId] = connection;
      connectionsArray.push(connection);
    });

    set({
      connections: connections,
    });
    for (const connection of connectionsArray) {
      registerConnectionEvents(connection);
    }
    Events.On(events.GlobalEvent.ConnectionDeleted, async (e) => {
      const id: number = e.data;
      await tabs.closeTab(id);
      await subscriptions.removeConnection(id);
      update((store) => {
        delete store.connections[id];
        return store;
      });
    });
  } catch (e) {
    console.error(e);
  }
};

const getConnectionFromAppConnection = (appConnection: app.Connection) => {
  const typedAppConn = appConnection as Required<app.Connection>;
  const conn: Connection = {
    ...typedAppConn,
    connectionString: getConnectionString(
      typedAppConn.connectionDetails as Connection["connectionDetails"]
    ),
    connectionState: "disconnected" as ConnectionState,
    showDataPageWhileDisconnected: false,
    connectionDetails: {
      ...(typedAppConn.connectionDetails as Connection["connectionDetails"]),
      lastConnectedAt: !!typedAppConn.connectionDetails.lastConnectedAt
        ? new Date(typedAppConn.connectionDetails.lastConnectedAt)
        : null,
    },
  };
  return conn;
};

const registerConnectionEvents = (connection: Connection) => {
  const {
    connectionDetails: { id, name },
  } = connection;
  Events.On(connection.eventSet.mqttConnected, () => {
    console.log(id, name, "connected");
    updateConnectionState(connection.connectionDetails.id, "connected");
  });
  Events.On(connection.eventSet.mqttConnecting, () => {
    console.log(id, name, "connecting");
    updateConnectionState(connection.connectionDetails.id, "connecting");
  });
  Events.On(connection.eventSet.mqttReconnecting, (e) => {
    const err = e.data;
    console.log(id, name, "reconnecting");
    updateConnectionState(connection.connectionDetails.id, "reconnecting");
    if (!!err) {
      addToast({
        data: {
          title: `Disconnect [${connection.connectionDetails.name}]`,
          description: err,
          type: "error",
        },
      });
    }
  });
  Events.On(connection.eventSet.mqttDisconnected, (e) => {
    const err = e.data;
    console.log(id, name, "disconnected");
    updateConnectionState(connection.connectionDetails.id, "disconnected");
    if (!!err) {
      addToast({
        data: {
          title: `Disconnect [${connection.connectionDetails.name}]`,
          description: err,
          type: "error",
        },
      });
    }
  });
  Events.On(connection.eventSet.mqttLatency, (e) => {
    const latencyMs = e.data;
    if (latencyMs) {
      update((store) => {
        const thisConnection =
          store.connections[connection.connectionDetails.id];
        if (!thisConnection) {
          console.warn("latency value received for non-existant connection");
          return store;
        }
        thisConnection.latencyMs = latencyMs;
        return store;
      });
    }
  });
};

const updateConnectionState = (
  connectionId: number,
  connectionState: ConnectionState
) => {
  const now = new Date();
  update((store) => {
    console.log(
      "updating connection state",
      connectionId,
      connectionState,
      store
    );
    const existingConnection = store.connections[connectionId];
    store.connections[connectionId] = {
      ...existingConnection,
      connectionDetails: {
        ...existingConnection.connectionDetails,
      },
      connectionState,
    };
    if (
      connectionState === "disconnected" &&
      existingConnection.connectionState === "connected"
    ) {
      store.connections[connectionId].connectionDetails.lastConnectedAt = now;
      store.connections[connectionId].latencyMs = undefined;
    }
    if (connectionState === "connected") {
      store.connections[connectionId].connectionDetails.lastConnectedAt = now;
      store.connections[connectionId].showDataPageWhileDisconnected = true;
    }
    if (
      connectionState === "connected" &&
      !store.connections[connectionId].firstConnectedThisSessionAtMs
    ) {
      store.connections[connectionId].firstConnectedThisSessionAtMs =
        now.getTime();
    }
    return store;
  });
};

const updateConnectionDetails = async (
  connectionDetails: Connection["connectionDetails"]
) => {
  try {
    console.log("updating connection details", connectionDetails);
    await UpdateConnection(
      connectionDetails as unknown as app.Connection["connectionDetails"]
    );
    const connectionString = getConnectionString(connectionDetails);
    update((store) => {
      const existingConnection = store.connections[connectionDetails.id];
      store.connections[connectionDetails.id] = {
        ...existingConnection,
        connectionDetails: connectionDetails,
        connectionString,
      };
      return store;
    });
  } catch (e) {
    console.error(e);
    throw e;
  }
};

const addConnection = async () => {
  try {
    const newConnection = (await NewConnection()) as unknown as Connection;
    registerConnectionEvents(newConnection);
    const subs = (newConnection.connectionDetails as any)
      .subscriptions as Subscription[];
    const connectionString = getConnectionString(
      newConnection.connectionDetails
    );
    const connectionId = newConnection.connectionDetails.id;
    update((store) => {
      store.connections[newConnection.connectionDetails.id] = {
        ...newConnection,
        connectionString,
        connectionState: "disconnected",
        showDataPageWhileDisconnected: false,
        justCreated: true,
      };
      return store;
    });
    subscriptionsStore.addNewConnectionSubRecords(connectionId, subs);
    await tabsStore.addTab(connectionId);
  } catch (e) {
    throw e;
  }
};

const deleteConnection = async (id: number) => {
  try {
    await DeleteConnection(id);
    subscriptionsStore.removeConnection(id);
    update((store) => {
      delete store.connections[id];
      return store;
    });
  } catch (e) {
    throw e;
  }
};

const connect = async (connectionId: number) => {
  console.log("connecting", connectionId);
  try {
    await ConnectMqtt(connectionId);
  } catch (e) {
    throw e;
  }
};

const disconnect = async (connectionId: number) => {
  try {
    await DisconnectMqtt(connectionId);
  } catch (e) {
    throw e;
  }
};

// Clears the just-created flag once the details dialog has auto-opened, so it
// doesn't reopen on every remount.
const acknowledgeConnectionCreated = (connectionId: number) => {
  update((store) => {
    const connection = store.connections[connectionId];
    if (connection?.justCreated) {
      store.connections[connectionId] = { ...connection, justCreated: false };
    }
    return store;
  });
};

const toggleShowDataPageWhileDisconnected = (
  connectionId: number,
  on: boolean
) => {
  update((store) => {
    const existingConnection = store.connections[connectionId];
    store.connections[connectionId] = {
      ...existingConnection,
      showDataPageWhileDisconnected: on,
    };
    return store;
  });
};

export default {
  subscribe,
  init,
  addConnection,
  updateConnectionDetails,
  deleteConnection,
  toggleShowDataPageWhileDisconnected,
  acknowledgeConnectionCreated,
  connect,
  disconnect,
};

const getConnectionString = (connection: Connection["connectionDetails"]) => {
  const isWs = connection.protocol === "ws" || connection.protocol === "wss";
  const wsPath = isWs && connection.websocketPath
    ? "/" + connection.websocketPath.replace(/^\/+/, "")
    : "";
  return `${connection.protocol}://${
    !!connection.username ? connection.username + "@" : ""
  }${connection.host}:${connection.port}${wsPath}`;
};
