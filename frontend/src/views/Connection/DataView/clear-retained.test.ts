import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  createClearRetainedFlow,
  onRetainedCleared,
  RETAINED_CLEARED_EVENT,
} from "./clear-retained";

const DeleteRetainedMessage = vi.fn();
const DeleteRetainedMessages = vi.fn();
const GetRetainedTopicsUnderPrefix = vi.fn();

vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  DeleteRetainedMessage: (...args: unknown[]) => DeleteRetainedMessage(...args),
  DeleteRetainedMessages: (...args: unknown[]) =>
    DeleteRetainedMessages(...args),
  GetRetainedTopicsUnderPrefix: (...args: unknown[]) =>
    GetRetainedTopicsUnderPrefix(...args),
}));

const listeners = new Map<string, (e: any) => void>();
const Emit = vi.fn();

vi.mock("@wailsio/runtime", () => ({
  Events: {
    On: vi.fn((eventName: string, handler: (e: any) => void) => {
      listeners.set(eventName, handler);
      return () => listeners.delete(eventName);
    }),
    Emit: (...args: unknown[]) => Emit(...args),
  },
}));

const addToast = vi.fn();

vi.mock("@/components/Toast/Toast.svelte", () => ({
  addToast: (...args: unknown[]) => addToast(...args),
}));

const CONNECTION_ID = 7;

const toastTitles = () =>
  addToast.mock.calls.map((call) => (call[0] as any).data.title as string);

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
});

describe("requestClear", () => {
  it("opens the dialog for the single topic with count 0", () => {
    const flow = createClearRetainedFlow(CONNECTION_ID);

    flow.requestClear("home/a");

    expect(get(flow.isOpen)).toBe(true);
    expect(get(flow.request)).toEqual({
      topic: "home/a",
      topics: ["home/a"],
      count: 0,
      busy: false,
    });
  });
});

describe("requestClearBelow", () => {
  it("drops the prefix itself and reports nothing left when only it remains", async () => {
    GetRetainedTopicsUnderPrefix.mockResolvedValue(["home"]);
    const flow = createClearRetainedFlow(CONNECTION_ID);

    await flow.requestClearBelow("home");

    expect(GetRetainedTopicsUnderPrefix).toHaveBeenCalledWith(
      CONNECTION_ID,
      "home"
    );
    expect(get(flow.isOpen)).toBe(false);
    expect(toastTitles()).toEqual(["Nothing left to clear"]);
    expect((addToast.mock.calls[0][0] as any).data.type).toBe("info");
  });

  it("captures the list below the prefix, its count, and opens", async () => {
    GetRetainedTopicsUnderPrefix.mockResolvedValue([
      "home",
      "home/a",
      "home/b/c",
    ]);
    const flow = createClearRetainedFlow(CONNECTION_ID);

    await flow.requestClearBelow("home");

    expect(get(flow.isOpen)).toBe(true);
    expect(get(flow.request)).toEqual({
      topic: "home",
      topics: ["home/a", "home/b/c"],
      count: 2,
      busy: false,
    });
    expect(addToast).not.toHaveBeenCalled();
  });

  it("toasts an error and does not open when the lookup fails", async () => {
    GetRetainedTopicsUnderPrefix.mockRejectedValue(new Error("boom"));
    const flow = createClearRetainedFlow(CONNECTION_ID);

    await flow.requestClearBelow("home");

    expect(get(flow.isOpen)).toBe(false);
    expect(toastTitles()).toEqual(["Failed to find retained messages"]);
  });
});

describe("confirm", () => {
  it("clears a single topic, tells the caller and every window, and closes", async () => {
    DeleteRetainedMessage.mockResolvedValue(undefined);
    const onCleared = vi.fn();
    const flow = createClearRetainedFlow(CONNECTION_ID, { onCleared });
    flow.requestClear("home/a");

    await flow.confirm();

    expect(DeleteRetainedMessage).toHaveBeenCalledWith(CONNECTION_ID, "home/a");
    expect(DeleteRetainedMessages).not.toHaveBeenCalled();
    expect(onCleared).toHaveBeenCalledWith(["home/a"]);
    expect(Emit).toHaveBeenCalledWith(RETAINED_CLEARED_EVENT, {
      connectionId: CONNECTION_ID,
      topics: ["home/a"],
    });
    expect(toastTitles()).toEqual(["Retained message cleared"]);
    expect(get(flow.isOpen)).toBe(false);
    expect(get(flow.request).busy).toBe(false);
  });

  it("clears a branch and reports a full success", async () => {
    GetRetainedTopicsUnderPrefix.mockResolvedValue(["home/a", "home/b"]);
    DeleteRetainedMessages.mockResolvedValue({
      cleared: 2,
      failed: 0,
      firstError: "",
    });
    const onCleared = vi.fn();
    const flow = createClearRetainedFlow(CONNECTION_ID, { onCleared });
    await flow.requestClearBelow("home");

    await flow.confirm();

    expect(DeleteRetainedMessages).toHaveBeenCalledWith(CONNECTION_ID, [
      "home/a",
      "home/b",
    ]);
    expect(onCleared).toHaveBeenCalledWith(["home/a", "home/b"]);
    expect(Emit).toHaveBeenCalledWith(RETAINED_CLEARED_EVENT, {
      connectionId: CONNECTION_ID,
      topics: ["home/a", "home/b"],
    });
    expect(toastTitles()).toEqual(["2 retained messages cleared"]);
    expect(get(flow.isOpen)).toBe(false);
  });

  it("reports a partial failure with the count that actually went", async () => {
    GetRetainedTopicsUnderPrefix.mockResolvedValue([
      "home/a",
      "home/b",
      "home/c",
    ]);
    DeleteRetainedMessages.mockResolvedValue({
      cleared: 1,
      failed: 2,
      firstError: "publish failed: home/b",
    });
    const onCleared = vi.fn();
    const flow = createClearRetainedFlow(CONNECTION_ID, { onCleared });
    await flow.requestClearBelow("home");

    await flow.confirm();

    expect(toastTitles()).toEqual(["Cleared 1 of 3 retained messages"]);
    const toast = (addToast.mock.calls[0][0] as any).data;
    expect(toast.type).toBe("error");
    expect(toast.description).toBe("publish failed: home/b");
    // Something went, so the stale markers still need clearing.
    expect(onCleared).toHaveBeenCalledWith(["home/a", "home/b", "home/c"]);
    expect(get(flow.isOpen)).toBe(false);
  });

  it("does not notify anyone when nothing was cleared", async () => {
    GetRetainedTopicsUnderPrefix.mockResolvedValue(["home/a"]);
    DeleteRetainedMessages.mockResolvedValue({
      cleared: 0,
      failed: 1,
      firstError: "publish failed: home/a",
    });
    const onCleared = vi.fn();
    const flow = createClearRetainedFlow(CONNECTION_ID, { onCleared });
    await flow.requestClearBelow("home");

    await flow.confirm();

    expect(onCleared).not.toHaveBeenCalled();
    expect(Emit).not.toHaveBeenCalled();
    expect(toastTitles()).toEqual(["Cleared 0 of 1 retained messages"]);
  });

  it("toasts the error, does not notify, and closes when the call throws", async () => {
    DeleteRetainedMessage.mockRejectedValue(new Error("not connected"));
    const onCleared = vi.fn();
    const flow = createClearRetainedFlow(CONNECTION_ID, { onCleared });
    flow.requestClear("home/a");

    await flow.confirm();

    expect(onCleared).not.toHaveBeenCalled();
    expect(Emit).not.toHaveBeenCalled();
    expect(toastTitles()).toEqual(["Failed to clear retained messages"]);
    expect(get(flow.isOpen)).toBe(false);
    expect(get(flow.request).busy).toBe(false);
  });

  it("marks the request busy while the call is in flight", async () => {
    let release: () => void = () => {};
    DeleteRetainedMessage.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const flow = createClearRetainedFlow(CONNECTION_ID);
    flow.requestClear("home/a");

    const pending = flow.confirm();
    expect(get(flow.request).busy).toBe(true);
    expect(get(flow.isOpen)).toBe(true);

    release();
    await pending;
    expect(get(flow.request).busy).toBe(false);
    expect(get(flow.isOpen)).toBe(false);
  });
});

describe("onRetainedCleared", () => {
  it("delivers topics for the matching connection only", () => {
    const handler = vi.fn();
    const unlisten = onRetainedCleared(CONNECTION_ID, handler);
    const fire = listeners.get(RETAINED_CLEARED_EVENT);
    if (!fire) throw new Error("no retained-cleared listener registered");

    fire({ data: { connectionId: CONNECTION_ID + 1, topics: ["other/x"] } });
    expect(handler).not.toHaveBeenCalled();

    fire({ data: { connectionId: CONNECTION_ID, topics: ["home/a"] } });
    expect(handler).toHaveBeenCalledWith(["home/a"]);

    unlisten();
    expect(listeners.has(RETAINED_CLEARED_EVENT)).toBe(false);
  });
});
