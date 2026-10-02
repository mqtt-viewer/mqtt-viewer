import { get } from "svelte/store";
import { describe, expect, test, vi } from "vitest";

// The store module pulls in the generated Wails bindings and calls
// setContext at creation time; neither is available in a plain unit test.
// @wailsio/runtime reads window.location at import time, and the generated
// models modules only use its Create helpers to build class instances we
// never construct here, so a self-returning stub is enough.
vi.mock("@wailsio/runtime", () => {
  const stub: any = (...args: unknown[]) => stub;
  return { Create: new Proxy({}, { get: () => stub }) };
});
vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  GetPublishHistoriesForConnection: vi.fn(),
  SavePublishHistoryEntry: vi.fn(),
  DeletePublishHistoryEntry: vi.fn(),
  PublishMqtt: vi.fn(),
}));
vi.mock("svelte", async (importOriginal) => {
  const actual = await importOriginal<typeof import("svelte")>();
  return { ...actual, setContext: vi.fn(), getContext: vi.fn() };
});

const { createPublishStore } = await import("./publish-details");

describe("setTopic and the protobuf override choice", () => {
  test("leaves auto alone", () => {
    const store = createPublishStore(1);
    store.setTopic("sensors/a");
    expect(get(store).topic).toBe("sensors/a");
    expect(get(store).protoOverrideChoice).toBe("auto");
  });

  test("resets a forced message type back to auto", () => {
    const store = createPublishStore(1);
    store.setPartial({ protoOverrideChoice: "acme.Envelope" });
    store.setTopic("sensors/b");
    expect(get(store).protoOverrideChoice).toBe("auto");
  });

  test("preserves an explicit raw (none) choice", () => {
    const store = createPublishStore(1);
    store.setPartial({ protoOverrideChoice: "none" });
    store.setTopic("sensors/c");
    expect(get(store).topic).toBe("sensors/c");
    expect(get(store).protoOverrideChoice).toBe("none");
  });
});
