import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAllConnections: vi.fn(),
  updateConnection: vi.fn(),
  markSaved: vi.fn(),
}));

vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  ConnectMqtt: vi.fn(),
  DisconnectMqtt: vi.fn(),
  DeleteConnection: vi.fn(),
  NewConnection: vi.fn(),
  GetAllConnections: (...args: unknown[]) => mocks.getAllConnections(...args),
  UpdateConnection: (...args: unknown[]) => mocks.updateConnection(...args),
}));
vi.mock("bindings/mqtt-viewer/events/models", () => ({
  GlobalEvent: { ConnectionDeleted: "connection-deleted" },
}));
vi.mock("@wailsio/runtime", () => ({ Events: { On: vi.fn() } }));
vi.mock("@/components/Toast/Toast.svelte", () => ({ addToast: vi.fn() }));
vi.mock("@/stores/tabs", () => ({ default: { closeTab: vi.fn() } }));
vi.mock("./subscriptions", () => ({ default: { removeConnection: vi.fn() } }));
vi.mock("./proto-state", () => ({ default: { removeConnection: vi.fn() } }));
vi.mock("./last-saved", () => ({ markSaved: mocks.markSaved }));

import connections from "./connections";

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const baseDetails = {
  id: 1,
  name: "original",
  protocol: "mqtt",
  host: "localhost",
  port: 1883,
  username: "",
  lastConnectedAt: null,
};

const appConnection = {
  connectionDetails: baseDetails,
  eventSet: {
    mqttConnected: "c",
    mqttConnecting: "cg",
    mqttReconnecting: "r",
    mqttDisconnected: "d",
    mqttLatency: "l",
  },
};

const details = () => get(connections).connections[1].connectionDetails;

describe("updateConnectionDetails rollback", () => {
  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getAllConnections.mockResolvedValue({
      connections: { 1: { ...appConnection, isConnected: false } },
    });
    mocks.updateConnection.mockReset();
    await connections.init();
  });

  it("restores the previous details when the only write fails", async () => {
    mocks.updateConnection.mockRejectedValueOnce(new Error("nope"));
    await expect(
      connections.updateConnectionDetails({
        ...details(),
        name: "failed",
      } as any)
    ).rejects.toThrow("nope");
    expect(details().name).toBe("original");
  });

  it("keeps a later successful write when an earlier one fails afterwards", async () => {
    const a = deferred();
    const b = deferred();
    mocks.updateConnection
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);

    const callA = connections.updateConnectionDetails({
      ...details(),
      name: "A",
    } as any);
    const callB = connections.updateConnectionDetails({
      ...details(),
      name: "B",
    } as any);

    b.resolve();
    await callB;
    expect(details().name).toBe("B");

    a.reject(new Error("A failed"));
    await expect(callA).rejects.toThrow("A failed");
    expect(details().name).toBe("B");
    expect(get(connections).connections[1].connectionString).toBe(
      "mqtt://localhost:1883"
    );
  });

  it("rolls each failure back in turn when both writes fail", async () => {
    const a = deferred();
    const b = deferred();
    mocks.updateConnection
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);

    const callA = connections.updateConnectionDetails({
      ...details(),
      name: "A",
    } as any);
    const callB = connections.updateConnectionDetails({
      ...details(),
      name: "B",
    } as any);

    b.reject(new Error("B failed"));
    await expect(callB).rejects.toThrow("B failed");
    expect(details().name).toBe("A");

    a.reject(new Error("A failed"));
    await expect(callA).rejects.toThrow("A failed");
    expect(details().name).toBe("original");
  });
});
