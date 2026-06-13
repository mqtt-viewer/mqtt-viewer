import { get, writable } from "svelte/store";
import _ from "lodash";
import { GetMqttStats } from "bindings/mqtt-viewer/backend/app/app";
import * as app from "bindings/mqtt-viewer/backend/app/models";
import type * as mqtt from "bindings/mqtt-viewer/backend/mqtt/models";

export type MqttStats = Omit<app.MqttStats, "statsByConnection"> & {
  statsByConnection: { [connId: number]: mqtt.ConnectionStats };
};

export enum StatsMode {
  ConnPerSec = "conn-per-sec",
  TotalPerSec = "total-per-sec",
}

let modes = [StatsMode.ConnPerSec, StatsMode.TotalPerSec];

interface StatsStore {
  mode: StatsMode;
  currentTotal: MqttStats;
  diffFrom1sAgo: MqttStats;
}

const { subscribe, set, update } = writable<StatsStore>(
  {
    mode: StatsMode.ConnPerSec,
    currentTotal: {
      totalBytesReceived: 0,
      totalBytesSent: 0,
      totalMessagesReceived: 0,
      totalMessagesSent: 0,
      statsByConnection: {},
    },
    diffFrom1sAgo: {
      totalBytesReceived: 0,
      totalBytesSent: 0,
      totalMessagesReceived: 0,
      totalMessagesSent: 0,
      statsByConnection: {},
    },
  },
  (set) => {
    getStats();
    setInterval(getStats, 1000);
  }
);

const toggleMode = () => {
  const currentState = get({ subscribe });
  const modeIndex = modes.indexOf(currentState.mode);
  const newModeIndex = (modeIndex + 1) % modes.length;
  set({
    mode: modes[newModeIndex],
    currentTotal: currentState.currentTotal,
    diffFrom1sAgo: currentState.diffFrom1sAgo,
  });
};

const getStats = async () => {
  try {
    const stats = (await GetMqttStats()) as MqttStats;
    const currentState = get({ subscribe });
    const diffFromLast: MqttStats = {
      totalBytesReceived:
        stats.totalBytesReceived - currentState.currentTotal.totalBytesReceived,
      totalBytesSent:
        stats.totalBytesSent - currentState.currentTotal.totalBytesSent,
      totalMessagesReceived:
        stats.totalMessagesReceived -
        currentState.currentTotal.totalMessagesReceived,
      totalMessagesSent:
        stats.totalMessagesSent - currentState.currentTotal.totalMessagesSent,
      statsByConnection: {},
    };
    for (const [connectionId, statsByConnection] of Object.entries(
      stats.statsByConnection
    )) {
      const connId = Number(connectionId);
      const prevStatsByConnection =
        currentState.currentTotal.statsByConnection[connId];

      if (!prevStatsByConnection) {
        diffFromLast.statsByConnection[connId] = {
          bytesReceived: statsByConnection.bytesReceived,
          bytesSent: statsByConnection.bytesSent,
          messagesReceived: statsByConnection.messagesReceived,
          messagesSent: statsByConnection.messagesSent,
        };
        continue;
      }
      diffFromLast.statsByConnection[connId] = {
        bytesReceived:
          statsByConnection.bytesReceived - prevStatsByConnection.bytesReceived,
        bytesSent:
          statsByConnection.bytesSent - prevStatsByConnection.bytesSent,
        messagesReceived:
          statsByConnection.messagesReceived -
          prevStatsByConnection.messagesReceived,
        messagesSent:
          statsByConnection.messagesSent - prevStatsByConnection.messagesSent,
      };
    }

    set({
      mode: currentState.mode,
      currentTotal: stats,
      diffFrom1sAgo: diffFromLast,
    });
  } catch (e) {
    console.error(e);
  }
};

export default {
  subscribe,
  toggleMode,
};
