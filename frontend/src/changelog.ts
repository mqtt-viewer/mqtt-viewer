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
        title: "A status page for your broker",
        body: "There's a new broker status window showing what your broker is up to: connected clients, message and byte rates, subscriptions, retained messages, uptime and version, each with a little trend line. It reads the $SYS topics mosquitto, EMQX and VerneMQ publish, and I also measure message rates client-side so you still get numbers on brokers that publish nothing. Open it from the pulse icon above the topic tree, or hover the $SYS row.",
      },
      {
        title: "Make the status page your own",
        body: "If your broker names its health topics differently, point any tile at your own topic, or add new tiles with the plus at the end of the grid. There's a raw list of every $SYS topic too, and you can pin one as a tile straight from it. Your tiles are saved per connection.",
      },
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
      "After years of betas, MQTT Viewer is officially 1.0. Thanks for sticking with it. Here's what's new.",
    sections: [
      {
        title: "Live charting",
        body: "Tick any numeric field in a payload to chart it over time. Charts can pop out into their own window.",
      },
      {
        title: "Saved message collections",
        body: "Save messages into collections, per connection or global, and publish them again with a click. Publish history and search are in the sidebar too.",
      },
      {
        title: "Bounded memory",
        body: "Message history stays within a memory budget you set, so the app won't eat your RAM if you leave it open. Turn on recording if you want history to survive restarts.",
      },
      {
        title: "Image previews",
        body: "PNG, JPEG, GIF, WebP and BMP payloads now show as actual images, with the raw bytes one click away.",
      },
      {
        title: "Release notes",
        body: "After each update you'll see a short summary of what changed, like this one. You can reopen it any time from Settings, or by clicking the version number at the bottom of the window.",
      },
      {
        title: "Linux fixes and auto-updates",
        body: "There are proper rpm and deb packages now, so Fedora no longer crashes at startup. AppImages render correctly again, and the app can update itself.",
      },
    ],
    outro:
      "Found a bug or a rough edge? Use the Feedback button, I really want to know.",
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
