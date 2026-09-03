import { describe, expect, it } from "vitest";
import { unreleasedEntry, type ChangelogEntry } from "./changelog";
import {
  REPO_URL,
  releaseNotesForVersion,
  renderReleaseNotes,
} from "./release-notes";

const entry = (over: Partial<ChangelogEntry> = {}): ChangelogEntry => ({
  version: "1.2.0",
  released: true,
  date: "September 2026",
  headline: "Charts, and a much calmer topic tree",
  intro: "Here's what's new in 1.2.0.",
  sections: [
    {
      title: "Chart your data, live",
      body: "Numeric payloads can now be plotted straight from the topic tree.",
    },
  ],
  ...over,
});

const opts = { tag: "v1.2.0", prevTag: "v1.1.0", repoUrl: REPO_URL };

describe("renderReleaseNotes", () => {
  it("renders headline, intro, sections and the compare link", () => {
    expect(renderReleaseNotes(entry(), opts)).toBe(
      [
        "# Charts, and a much calmer topic tree",
        "",
        "Here's what's new in 1.2.0.",
        "",
        "## Chart your data, live",
        "",
        "Numeric payloads can now be plotted straight from the topic tree.",
        "",
        `[Full changelog](${REPO_URL}/compare/v1.1.0...v1.2.0)`,
        "",
      ].join("\n")
    );
  });

  it("ends with exactly one newline and no trailing whitespace", () => {
    const notes = renderReleaseNotes(entry(), opts);
    expect(notes.endsWith("\n")).toBe(true);
    expect(notes.endsWith("\n\n")).toBe(false);
    for (const line of notes.split("\n")) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it("omits the thanks line when a section has no credits", () => {
    expect(renderReleaseNotes(entry(), opts)).not.toContain("Thanks to");
  });

  it("renders a single credit", () => {
    const notes = renderReleaseNotes(
      entry({
        sections: [
          {
            title: "Chart your data, live",
            body: "Numeric payloads can now be plotted.",
            thanks: [
              {
                name: "jeeftor",
                url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/124",
              },
            ],
          },
        ],
      }),
      opts
    );
    expect(notes).toContain(
      "Thanks to [jeeftor](https://github.com/mqtt-viewer/mqtt-viewer/issues/124).\n"
    );
  });

  it("lists several credits without an Oxford comma", () => {
    const credit = (name: string) => ({
      name,
      url: `https://github.com/${name}`,
    });
    const notes = renderReleaseNotes(
      entry({
        sections: [
          {
            title: "A status page for your broker",
            body: "The pulse icon opens a broker status window.",
            thanks: [credit("one"), credit("two"), credit("three")],
          },
        ],
      }),
      opts
    );
    expect(notes).toContain(
      "Thanks to [one](https://github.com/one), [two](https://github.com/two) and [three](https://github.com/three)."
    );
  });

  it("renders the outro when there is one, and nothing when there isn't", () => {
    expect(renderReleaseNotes(entry({ outro: "More soon." }), opts)).toContain(
      "\n\nMore soon.\n\n[Full changelog]"
    );
    const withoutOutro = renderReleaseNotes(entry(), opts);
    expect(withoutOutro).toContain(
      "Numeric payloads can now be plotted straight from the topic tree.\n\n[Full changelog]"
    );
  });

  it("drops the compare link when there is no previous tag", () => {
    const notes = renderReleaseNotes(entry(), {
      tag: "v1.2.0",
      repoUrl: REPO_URL,
    });
    expect(notes).not.toContain("Full changelog");
    expect(notes.endsWith(
      "Numeric payloads can now be plotted straight from the topic tree.\n"
    )).toBe(true);
  });

  it("skips the staging entry's placeholder headline", () => {
    const notes = renderReleaseNotes(
      entry({ headline: "In the next update" }),
      opts
    );
    expect(notes).not.toContain("In the next update");
    expect(notes.startsWith("Here's what's new in 1.2.0.")).toBe(true);
  });

  it("keeps a real headline that merely looks similar", () => {
    const notes = renderReleaseNotes(
      entry({ headline: "Everything in the next update" }),
      opts
    );
    expect(notes.startsWith("# Everything in the next update\n")).toBe(true);
  });
});

describe("releaseNotesForVersion", () => {
  it("finds the entry with or without the v prefix", () => {
    const withPrefix = releaseNotesForVersion("v1.0.0", { prevTag: "v0.7.0" });
    const without = releaseNotesForVersion("1.0.0", { prevTag: "0.7.0" });
    expect(withPrefix).toBe(without);
    expect(withPrefix).toContain(
      `[Full changelog](${REPO_URL}/compare/v0.7.0...v1.0.0)`
    );
  });

  it("uses the base version's entry for a prerelease dry run", () => {
    const notes = releaseNotesForVersion("v1.0.0-beta1", { prevTag: "v0.7.0" });
    expect(notes).toContain("# MQTT Viewer 1.0 is here");
    expect(notes).toContain(
      `[Full changelog](${REPO_URL}/compare/v0.7.0...v1.0.0-beta1)`
    );
  });

  it("throws naming the version when there is no entry", () => {
    expect(() => releaseNotesForVersion("v9.9.9")).toThrow(/9\.9\.9/);
    expect(() => releaseNotesForVersion("v9.9.9")).toThrow(
      /No released changelog entry/
    );
  });

  it("throws when the entry has not been promoted yet", () => {
    const staging = unreleasedEntry();
    if (!staging) return; // No staging entry right after a release.
    expect(() => releaseNotesForVersion(staging.version)).toThrow(
      /still released: false/
    );
  });
});
