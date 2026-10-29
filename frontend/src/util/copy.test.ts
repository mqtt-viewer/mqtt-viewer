import { describe, it, expect, vi, beforeEach } from "vitest";
import { writable } from "svelte/store";

const SetText = vi.fn();
vi.mock("@wailsio/runtime", () => ({
  Clipboard: { SetText: (...args: unknown[]) => SetText(...args) },
}));

const mockEnv = writable({ isServerMode: false });
vi.mock("@/stores/env", () => ({
  default: {
    subscribe: (run: (value: unknown) => void) => mockEnv.subscribe(run),
  },
}));

import { copyToClipboard } from "./copy";

describe("copyToClipboard", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    SetText.mockReset().mockResolvedValue(undefined);
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("uses the native clipboard on desktop", async () => {
    mockEnv.set({ isServerMode: false });
    await copyToClipboard("a/b/c");
    expect(SetText).toHaveBeenCalledWith("a/b/c");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("uses the browser clipboard in server mode", async () => {
    mockEnv.set({ isServerMode: true });
    await copyToClipboard("a/b/c");
    expect(writeText).toHaveBeenCalledWith("a/b/c");
    expect(SetText).not.toHaveBeenCalled();
  });

  it("rejects when the native call fails", async () => {
    mockEnv.set({ isServerMode: false });
    SetText.mockRejectedValue(new Error("nope"));
    await expect(copyToClipboard("x")).rejects.toThrow("nope");
  });
});
