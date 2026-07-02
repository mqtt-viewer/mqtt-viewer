import { describe, expect, it } from "vitest";
import {
  CHANGELOG,
  entryForVersion,
  shouldShowChangelog,
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

  it("does not show for versions without an entry", () => {
    expect(shouldShowChangelog("v0.0.0-dev", "")).toBe(false);
  });
});

describe("content", () => {
  it("every entry has a version, headline, intro and sections", () => {
    for (const e of CHANGELOG) {
      expect(e.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(e.headline.length).toBeGreaterThan(0);
      expect(e.intro.length).toBeGreaterThan(0);
      expect(e.sections.length).toBeGreaterThan(0);
    }
  });
});
