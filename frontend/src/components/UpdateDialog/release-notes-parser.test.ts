import { describe, expect, it } from "vitest";
import type { ChangelogEntry } from "@/changelog";
import { REPO_URL, renderReleaseNotes } from "@/release-notes";
import { parseReleaseNotes } from "./release-notes-parser";

describe("parseReleaseNotes", () => {
  it("keeps headings and bullets, and collapses blank lines", () => {
    expect(
      parseReleaseNotes("# v1.1.0\n\n- One thing\n* Another thing\n\nPlain.")
    ).toEqual([
      { kind: "heading", text: "v1.1.0" },
      { kind: "bullet", text: "One thing" },
      { kind: "bullet", text: "Another thing" },
      { kind: "text", text: "Plain." },
    ]);
  });

  it("renders a link as its text", () => {
    expect(
      parseReleaseNotes("Thanks to [jeeftor](https://github.com/jeeftor).")
    ).toEqual([{ kind: "text", text: "Thanks to jeeftor." }]);
  });

  it("strips bold and italic markers", () => {
    expect(
      parseReleaseNotes("- **Fixed** the _reconnect_ loop and *nothing* else")
    ).toEqual([
      { kind: "bullet", text: "Fixed the reconnect loop and nothing else" },
    ]);
  });

  it("leaves underscores inside words alone", () => {
    expect(
      parseReleaseNotes("Download MQTT_Viewer_v1.1.0_darwin_arm64.zip")
    ).toEqual([
      { kind: "text", text: "Download MQTT_Viewer_v1.1.0_darwin_arm64.zip" },
    ]);
  });

  it("drops a line that is nothing but a link", () => {
    expect(
      parseReleaseNotes(
        `Done.\n\n[Full changelog](${REPO_URL}/compare/v1.0.0...v1.1.0)`
      )
    ).toEqual([{ kind: "text", text: "Done." }]);
  });

  it("drops a bare URL on its own line", () => {
    expect(parseReleaseNotes(`Done.\n${REPO_URL}/releases`)).toEqual([
      { kind: "text", text: "Done." },
    ]);
  });

  it("keeps a link that sits inside a longer line", () => {
    expect(
      parseReleaseNotes("See [the notes](https://example.com) for the rest.")
    ).toEqual([{ kind: "text", text: "See the notes for the rest." }]);
  });
});

describe("round trip from renderReleaseNotes", () => {
  const entry: ChangelogEntry = {
    version: "1.1.0",
    released: true,
    date: "September 2026",
    headline: "Charts, and a calmer topic tree",
    intro: "Here's what's new in 1.1.0.",
    sections: [
      {
        title: "Chart your data, live",
        body: "Numeric payloads can now be plotted from the topic tree.",
        thanks: [
          {
            name: "jeeftor",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/124",
          },
        ],
      },
      {
        title: "Steadier under load",
        body: "The topic tree stays smooth on brokers pushing thousands of messages a second.",
      },
    ],
    outro: "Found a rough edge? Use the Feedback button.",
  };

  it("shows the notes a user will read, without the compare link", () => {
    const notes = renderReleaseNotes(entry, {
      tag: "v1.1.0",
      prevTag: "v1.0.0",
      repoUrl: REPO_URL,
    });
    expect(parseReleaseNotes(notes)).toEqual([
      { kind: "heading", text: "Charts, and a calmer topic tree" },
      { kind: "text", text: "Here's what's new in 1.1.0." },
      { kind: "heading", text: "Chart your data, live" },
      {
        kind: "text",
        text: "Numeric payloads can now be plotted from the topic tree.",
      },
      { kind: "text", text: "Thanks to jeeftor." },
      { kind: "heading", text: "Steadier under load" },
      {
        kind: "text",
        text: "The topic tree stays smooth on brokers pushing thousands of messages a second.",
      },
      { kind: "text", text: "Found a rough edge? Use the Feedback button." },
    ]);
  });
});
