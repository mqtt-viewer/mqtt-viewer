// The in-app changelog. The "What's new" dialog shows released versions as
// tabs, newest on the left, and can be opened any time from Settings or by
// clicking the version in the bottom status bar. The newest released entry is
// also shown once automatically after an update (tracked via
// app_settings.lastSeenChangelogVersion).
//
// One entry sits at the top with released: false. It is the staging area for
// the next release: new changes get added here as they land, and at release
// time it is promoted to a real version + date (see the `release` and
// `changelog` skills and docs/RELEASING.md). It never auto-shows and is only
// visible in the dialog on dev builds, so users never read half-finished notes.
//
// Writing: keep it warm, plain, first person, British spelling, with NO em
// dashes and NO emojis. The full brief is docs/WRITING_STYLE.md. These notes
// are read by people mid-task, not by a release pipeline.

export interface ChangelogSection {
  title: string;
  body: string;
}

export interface ChangelogEntry {
  // Bare semver (no leading v) once released; "unreleased" while in development.
  version: string;
  // false for the staging entry that gathers changes for the next release.
  released: boolean;
  date: string;
  headline: string;
  intro: string;
  sections: ChangelogSection[];
  outro?: string;
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "unreleased",
    released: false,
    date: "In development",
    headline: "In the next update",
    intro:
      "Here's what's landed since 1.0.0. I'll tidy these notes up and give them a version when the update ships.",
    sections: [
      {
        title: "Chart values that arrive as text",
        body: "Numeric readings often turn up wrapped in quotes, like \"24.6\". You can now chart those too, so a quoted number plots just like a plain one. Values that aren't really numbers stay out of the way.",
      },
      {
        title: "Adding a value to a chart is clearer",
        body: "Choosing \"Add value from payload\" now opens the picker straight on the value, so it's obvious what to tick. Plain numeric payloads, where the whole message is the number, work this way too.",
      },
    ],
  },
  {
    version: "1.0.0",
    released: true,
    date: "July 2026",
    headline: "MQTT Viewer 1.0 is here",
    intro:
      "This one's been a long time coming. After years of betas, MQTT Viewer is officially 1.0. It's the same tool you already know, now with the polish (and the version number) to match. Thank you for debugging alongside it all this way. Here's what's packed in.",
    sections: [
      {
        title: "Chart your data, live",
        body: "Tick any numeric field in a topic's payload and watch it plot over time. Pop the chart out into its own window and keep an eye on it while you work elsewhere.",
      },
      {
        title: "A home for the messages you reuse",
        body: "Save messages into collections, per connection or global, and publish them again with a click. Your publish history lives in the sidebar too, and search covers all of it.",
      },
      {
        title: "History that minds its manners",
        body: "Message history now stays within a memory budget you control, so a viewer left open over the weekend won't eat your RAM. If you want history to survive restarts, turn on recording and page back through it whenever you like.",
      },
      {
        title: "Images, decoded",
        body: "Publish a PNG, JPEG, GIF, WebP or BMP and the payload tab shows the actual picture, with a raw-bytes view one click away.",
      },
      {
        title: "Notes like this one",
        body: "After each update you'll get a short, friendly summary of what changed. You can reopen it any time from Settings, or by clicking the version number at the bottom of the window.",
      },
      {
        title: "Better on Linux, faster everywhere",
        body: "Fedora and friends no longer crash at startup (there's a proper rpm and deb now), AppImages render correctly again, and updates install themselves through a new built-in updater.",
      },
    ],
    outro:
      "Found a rough edge? The Feedback button comes straight to me. 1.0 is a milestone, not a finish line.",
  },
  {
    version: "0.7.0",
    released: true,
    date: "July 2026",
    headline: "What's new in 0.7.0",
    intro:
      "A big one: charting, collections, bounded memory, image previews, and a new engine under the hood.",
    sections: [
      {
        title: "Topic charting",
        body: "Chart numeric payload fields over time, live, with a pop-out window.",
      },
      {
        title: "Message library",
        body: "Collections of saved messages, publish history, and search, all in the new sidebar.",
      },
      {
        title: "Bounded memory and durable history",
        body: "History stays within a configurable memory budget, with opt-in recording to disk.",
      },
      {
        title: "Image payload previews",
        body: "Image payloads render as images, not noise.",
      },
    ],
  },
];

const normalise = (version: string): string =>
  version.trim().replace(/^v/i, "");

/** Released entries only, newest first. */
export const releasedEntries = (): ChangelogEntry[] =>
  CHANGELOG.filter((e) => e.released);

/** The staging entry for the next release, or null if there isn't one. */
export const unreleasedEntry = (): ChangelogEntry | null =>
  CHANGELOG.find((e) => !e.released) ?? null;

// Returns the released changelog entry for an exact app version, or null. Dev
// builds ("v0.0.0-dev" etc.) and versions without notes get nothing.
export const entryForVersion = (version: string): ChangelogEntry | null =>
  releasedEntries().find((e) => e.version === normalise(version)) ?? null;

export const shouldShowChangelog = (
  appVersion: string,
  lastSeenVersion: string
): boolean => {
  const entry = entryForVersion(appVersion);
  if (!entry) return false;
  return normalise(lastSeenVersion) !== normalise(appVersion);
};

/**
 * The entries to show in the dialog for a given running version, newest first.
 * Released entries are always included. The unreleased staging entry is shown
 * only on builds whose version has no released entry (i.e. dev builds), so it
 * can be previewed without ever reaching users on a shipped release.
 */
export const changelogForDisplay = (version: string): ChangelogEntry[] => {
  const released = releasedEntries();
  const unreleased = unreleasedEntry();
  const showUnreleased =
    unreleased !== null &&
    unreleased.sections.length > 0 &&
    entryForVersion(version) === null;
  return showUnreleased ? [unreleased, ...released] : released;
};
