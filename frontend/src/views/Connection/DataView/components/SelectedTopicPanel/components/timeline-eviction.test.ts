import { describe, it, expect, vi } from "vitest";
import { DataSet } from "vis-data";
import type { DataItem } from "vis-timeline/peer";

vi.mock("@wailsio/runtime", () => ({
  Events: { On: vi.fn(() => () => {}) },
}));
vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  GetMessageHistory: vi.fn(),
  GetAppSettings: vi.fn(),
  GetReceivedMessageWindow: vi.fn(),
  GetReceivedMessageCount: vi.fn(),
}));

import { evictOldestTimelineItems } from "./timeline-eviction";
import {
  MAX_LOADED_MESSAGES,
  TRIM_SLACK,
} from "../../../stores/selected-topic-store";

const makeDataSet = (count: number, startId = 0) => {
  const dataSet = new DataSet<DataItem, "id">();
  dataSet.add(
    Array.from({ length: count }, (_, i) => ({
      id: `${startId + i}`,
      content: "",
      start: new Date(startId + i),
    }))
  );
  return dataSet;
};

describe("evictOldestTimelineItems", () => {
  it("does nothing at or under the cap plus slack", () => {
    const dataSet = makeDataSet(MAX_LOADED_MESSAGES + TRIM_SLACK);
    expect(evictOldestTimelineItems(dataSet)).toEqual([]);
    expect(dataSet.length).toBe(MAX_LOADED_MESSAGES + TRIM_SLACK);
  });

  it("removes the oldest items down to the cap once over the slack", () => {
    const over = 100;
    const total = MAX_LOADED_MESSAGES + TRIM_SLACK + over;
    const dataSet = makeDataSet(total);

    const removed = evictOldestTimelineItems(dataSet);

    expect(removed.length).toBe(TRIM_SLACK + over);
    expect(removed[0]).toBe("0");
    expect(removed[removed.length - 1]).toBe(`${TRIM_SLACK + over - 1}`);
    expect(dataSet.length).toBe(MAX_LOADED_MESSAGES);
    // The survivors are the newest, still in insertion order.
    const ids = dataSet.getIds();
    expect(ids[0]).toBe(`${TRIM_SLACK + over}`);
    expect(ids[ids.length - 1]).toBe(`${total - 1}`);
  });

  it("keeps evicting correctly across repeated live batches", () => {
    const dataSet = makeDataSet(0);
    let nextId = 0;
    for (let batch = 0; batch < 200; batch++) {
      dataSet.add(
        Array.from({ length: 100 }, () => {
          const id = `${nextId++}`;
          return { id, content: "", start: new Date(nextId) };
        })
      );
      evictOldestTimelineItems(dataSet);
      expect(dataSet.length).toBeLessThanOrEqual(
        MAX_LOADED_MESSAGES + TRIM_SLACK
      );
    }
    const ids = dataSet.getIds();
    expect(ids[ids.length - 1]).toBe(`${nextId - 1}`);
  });
});
