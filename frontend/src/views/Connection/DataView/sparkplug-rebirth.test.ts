import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";
import { createRebirthFlow, rebirthTopic } from "./sparkplug-rebirth";

const PublishSparkplugRebirth = vi.fn();

vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  PublishSparkplugRebirth: (...args: unknown[]) => PublishSparkplugRebirth(...args),
}));

const addToast = vi.fn();

vi.mock("@/components/Toast/Toast.svelte", () => ({
  addToast: (...args: unknown[]) => addToast(...args),
}));

const toasts = () => addToast.mock.calls.map((call) => (call[0] as any).data);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createRebirthFlow", () => {
  it("publishes nothing until confirmed", () => {
    const flow = createRebirthFlow(7);
    flow.requestRebirth([{ group: "G", node: "N" }]);
    expect(get(flow.isOpen)).toBe(true);
    expect(get(flow.request).targets).toEqual([{ group: "G", node: "N" }]);
    expect(PublishSparkplugRebirth).not.toHaveBeenCalled();
  });

  it("ignores an empty request", () => {
    const flow = createRebirthFlow(7);
    flow.requestRebirth([]);
    expect(get(flow.isOpen)).toBe(false);
  });

  it("publishes each target on confirm and reports success", async () => {
    PublishSparkplugRebirth.mockResolvedValue(undefined);
    const flow = createRebirthFlow(7);
    flow.requestRebirth([
      { group: "G", node: "a" },
      { group: "G", node: "b" },
    ]);
    await flow.confirm();
    expect(PublishSparkplugRebirth.mock.calls).toEqual([
      [7, "G", "a"],
      [7, "G", "b"],
    ]);
    expect(toasts()).toEqual([
      expect.objectContaining({ title: "2 rebirths requested", type: "success" }),
    ]);
    expect(get(flow.isOpen)).toBe(false);
    expect(get(flow.request).busy).toBe(false);
  });

  it("reports how far it got when one fails", async () => {
    PublishSparkplugRebirth.mockResolvedValueOnce(undefined).mockRejectedValueOnce(
      "not connected"
    );
    const flow = createRebirthFlow(7);
    flow.requestRebirth([
      { group: "G", node: "a" },
      { group: "G", node: "b" },
    ]);
    await flow.confirm();
    expect(toasts()).toEqual([
      expect.objectContaining({
        title: "Requested 1 of 2 rebirths",
        description: "not connected",
        type: "error",
      }),
    ]);
  });

  it("names the single-node failure plainly", async () => {
    PublishSparkplugRebirth.mockRejectedValue("rebirth requests need protobuf decoding enabled on the connection");
    const flow = createRebirthFlow(7);
    flow.requestRebirth([{ group: "G", node: "a" }]);
    await flow.confirm();
    expect(toasts()[0]).toMatchObject({ title: "Rebirth request failed", type: "error" });
  });

  it("counts requests as they go out, for the dialog's progress", async () => {
    const seen: number[] = [];
    const flow = createRebirthFlow(7);
    PublishSparkplugRebirth.mockImplementation(async () => {
      seen.push(get(flow.request).sent);
    });
    flow.requestRebirth([
      { group: "G", node: "a" },
      { group: "G", node: "b" },
      { group: "G", node: "c" },
    ]);
    await flow.confirm();
    expect(seen).toEqual([0, 1, 2]);
    expect(get(flow.request).sent).toBe(3);
  });

  it("unwraps a runtime error envelope into its message", async () => {
    PublishSparkplugRebirth.mockRejectedValue(
      '{"message":"specified connection not connected","cause":{},"kind":"RuntimeError"}'
    );
    const flow = createRebirthFlow(7);
    flow.requestRebirth([{ group: "G", node: "a" }]);
    await flow.confirm();
    expect(toasts()[0]).toMatchObject({ description: "specified connection not connected" });
  });
});

describe("rebirthTopic", () => {
  it("builds the NCMD topic", () => {
    expect(rebirthTopic({ group: "G", node: "N" })).toBe("spBv1.0/G/NCMD/N");
  });
});
