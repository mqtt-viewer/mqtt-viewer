import { describe, expect, it } from "vitest";
import {
  CHANGELOG,
  changelogForDisplay,
  entryForVersion,
  releasedEntries,
  shouldShowChangelog,
  unreleasedEntry,
  type ChangelogEntry,
} from "./changelog";

describe("entryForVersion", () => {
  it("matches with and without the v prefix", () => {
    expect(entryForVersion("v1.0.0")?.version).toBe("1.0.0");
    expect(entryForVersion("1.0.0")?.version).toBe("1.0.0");
  });

  it("returns null for versions without notes", () => {
    expect(entryForVersion("v0.0.0-dev")).toBeNull();
    expect(entryForVersion("")).toBeNull();
  });

  it("never matches the unreleased staging entry", () => {
    expect(entryForVersion("unreleased")).toBeNull();
  });
});

describe("shouldShowChangelog", () => {
  it("shows when the running version has notes the user hasn't seen", () => {
    expect(shouldShowChangelog("v1.0.0", "")).toBe(true);
    expect(shouldShowChangelog("v1.0.0", "v0.7.0")).toBe(true);
  });

  it("does not show twice for the same version", () => {
    expect(shouldShowChangelog("v1.0.0", "1.0.0")).toBe(false);
    expect(shouldShowChangelog("1.0.0", "v1.0.0")).toBe(false);
  });

  it("does not show for versions without an entry (incl. dev builds)", () => {
    expect(shouldShowChangelog("v0.0.0-dev", "")).toBe(false);
  });
});

describe("released / unreleased split", () => {
  it("releasedEntries are all released and semver-versioned, newest first", () => {
    const released = releasedEntries();
    expect(released.length).toBeGreaterThan(0);
    for (const e of released) {
      expect(e.released).toBe(true);
      expect(e.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
    // 1.0.0 comes before 0.7.0 in the list.
    const versions = released.map((e) => e.version);
    expect(versions.indexOf("1.0.0")).toBeLessThan(versions.indexOf("0.7.0"));
  });

  it("has at most one unreleased staging entry, flagged not-released", () => {
    const unreleased = CHANGELOG.filter((e) => !e.released);
    expect(unreleased.length).toBeLessThanOrEqual(1);
    if (unreleased.length === 1) {
      expect(unreleasedEntry()).toBe(unreleased[0]);
      expect(unreleasedEntry()?.released).toBe(false);
    }
  });
});

describe("changelogForDisplay", () => {
  it("shows the unreleased entry on dev builds (no matching release)", () => {
    const shown = changelogForDisplay("v0.0.0-dev");
    if (unreleasedEntry()) {
      expect(shown[0].released).toBe(false); // newest, leftmost tab
      expect(shown.slice(1).every((e) => e.released)).toBe(true);
    } else {
      expect(shown.every((e) => e.released)).toBe(true);
    }
  });

  it("hides the unreleased entry on a released build", () => {
    const shown = changelogForDisplay("1.0.0");
    expect(shown.every((e) => e.released)).toBe(true);
    expect(shown.some((e) => e.version === "1.0.0")).toBe(true);
  });
});

describe("content", () => {
  it("every entry has a version, headline, intro and sections", () => {
    for (const e of CHANGELOG) {
      expect(e.version.length).toBeGreaterThan(0);
      expect(e.headline.length).toBeGreaterThan(0);
      expect(e.intro.length).toBeGreaterThan(0);
      expect(e.sections.length).toBeGreaterThan(0);
    }
  });

  it("released entries use bare semver versions", () => {
    for (const e of releasedEntries()) {
      expect(e.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  // House style: no em dashes and no emojis anywhere users can read
  // (docs/WRITING_STYLE.md).
  const userFacingText = (e: ChangelogEntry): string[] => [
    e.headline,
    e.intro,
    e.outro ?? "",
    ...e.sections.flatMap((s) => [s.title, s.body]),
  ];

  it("contains no em or en dashes in any user-facing copy", () => {
    for (const e of CHANGELOG) {
      for (const t of userFacingText(e)) {
        expect(t.includes("—"), `em dash in: ${t}`).toBe(false);
        expect(t.includes("–"), `en dash in: ${t}`).toBe(false);
      }
    }
  });

  it("contains no emojis in any user-facing copy", () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const e of CHANGELOG) {
      for (const t of userFacingText(e)) {
        expect(emoji.test(t), `emoji in: ${t}`).toBe(false);
      }
    }
  });
});
