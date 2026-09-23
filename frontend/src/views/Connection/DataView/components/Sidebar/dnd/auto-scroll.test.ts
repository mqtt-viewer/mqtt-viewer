import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutoScroll } from "./auto-scroll";

// A container that only needs to answer getBoundingClientRect and hold a
// scrollTop, which is all the scroller touches.
const fakeContainer = (top: number, bottom: number) => {
  const container = {
    scrollTop: 0,
    getBoundingClientRect: () => ({ top, bottom }),
  };
  return container as unknown as HTMLElement;
};

// Frames only run when the test says so, so a scroll can be inspected step by
// step. Returns how many frames are pending.
const manualFrames = () => {
  let callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  return {
    run(times = 1) {
      for (let i = 0; i < times; i++) {
        const pending = [...callbacks.entries()];
        callbacks = new Map();
        for (const [, cb] of pending) cb(0);
      }
    },
    get pending() {
      return callbacks.size;
    },
  };
};

afterEach(() => vi.unstubAllGlobals());

describe("createAutoScroll", () => {
  it("reports every frame it scrolls, so the target can be recomputed", () => {
    const frames = manualFrames();
    const onScroll = vi.fn();
    const container = fakeContainer(100, 500);
    const scroller = createAutoScroll(container, onScroll);

    scroller.update(495);
    expect(onScroll).not.toHaveBeenCalled();

    frames.run(3);
    expect(onScroll).toHaveBeenCalledTimes(3);
    expect(container.scrollTop).toBeGreaterThan(0);
  });

  it("stops reporting once the pointer leaves the edge", () => {
    const frames = manualFrames();
    const onScroll = vi.fn();
    const scroller = createAutoScroll(fakeContainer(100, 500), onScroll);

    scroller.update(495);
    frames.run();
    scroller.update(300);
    frames.run(2);
    expect(onScroll).toHaveBeenCalledTimes(1);
  });

  it("runs no frame after stop", () => {
    const frames = manualFrames();
    const onScroll = vi.fn();
    const container = fakeContainer(100, 500);
    const scroller = createAutoScroll(container, onScroll);

    scroller.update(495);
    frames.run();
    const scrolled = container.scrollTop;
    scroller.stop();

    expect(frames.pending).toBe(0);
    frames.run(2);
    expect(onScroll).toHaveBeenCalledTimes(1);
    expect(container.scrollTop).toBe(scrolled);
  });

  it("does nothing without a container", () => {
    const frames = manualFrames();
    const onScroll = vi.fn();
    const scroller = createAutoScroll(null, onScroll);
    scroller.update(495);
    frames.run();
    expect(onScroll).not.toHaveBeenCalled();
  });
});
