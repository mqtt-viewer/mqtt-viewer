// The in-app changelog. One entry per released version; the newest entry for
// the running version is shown once in the "What's new" dialog (tracked via
// app_settings.lastSeenChangelogVersion), and it stays reachable from
// Settings. Keep the writing warm and plain — these notes are read by people
// mid-task, not by a release pipeline.

export interface ChangelogSection {
  emoji: string;
  title: string;
  body: string;
}

export interface ChangelogEntry {
  // Bare semver, no leading v.
  version: string;
  date: string;
  headline: string;
  intro: string;
  sections: ChangelogSection[];
  outro?: string;
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.0.0",
    date: "July 2026",
    headline: "MQTT Viewer 1.0 is here",
    intro:
      "After years of betas, MQTT Viewer is officially 1.0. Thanks for sticking with it. Here's what's new.",
    sections: [
      {
        emoji: "📈",
        title: "Live charting",
        body: "Tick any numeric field in a payload to chart it over time. Charts can pop out into their own window.",
      },
      {
        emoji: "🗂️",
        title: "Saved message collections",
        body: "Save messages into collections — per connection or global — and publish them again with a click. Publish history and search are in the sidebar too.",
      },
      {
        emoji: "🧠",
        title: "Bounded memory",
        body: "Message history stays within a memory budget you set, so the app won't eat your RAM if you leave it open. Turn on recording if you want history to survive restarts.",
      },
      {
        emoji: "🖼️",
        title: "Image previews",
        body: "PNG, JPEG, GIF, WebP and BMP payloads now show as actual images, with the raw bytes one click away.",
      },
      {
        emoji: "📝",
        title: "Release notes",
        body: "After each update you'll see a short summary of what changed, like this one. You can reopen it any time from Settings.",
      },
      {
        emoji: "🐧",
        title: "Linux fixes and auto-updates",
        body: "There are proper rpm and deb packages now, so Fedora no longer crashes at startup. AppImages render correctly again, and the app can update itself.",
      },
    ],
    outro:
      "Found a bug or a rough edge? Use the Feedback button — I really want to know.",
  },
  {
    version: "0.7.0",
    date: "July 2026",
    headline: "What's new in 0.7.0",
    intro:
      "A big one: charting, collections, bounded memory, image previews, and a new engine under the hood.",
    sections: [
      {
        emoji: "📈",
        title: "Topic charting",
        body: "Chart numeric payload fields over time, live, with a pop-out window.",
      },
      {
        emoji: "🗂️",
        title: "Message library",
        body: "Collections of saved messages, publish history, and search — all in the new sidebar.",
      },
      {
        emoji: "🧠",
        title: "Bounded memory + durable history",
        body: "History stays within a configurable memory budget, with opt-in recording to disk.",
      },
      {
        emoji: "🖼️",
        title: "Image payload previews",
        body: "Image payloads render as images, not noise.",
      },
    ],
  },
];

const normalise = (version: string): string =>
  version.trim().replace(/^v/i, "");

// Returns the changelog entry for an exact app version, or null. Dev builds
// ("v0.0.0-dev" etc.) and versions without notes get nothing.
export const entryForVersion = (version: string): ChangelogEntry | null =>
  CHANGELOG.find((e) => e.version === normalise(version)) ?? null;

export const shouldShowChangelog = (
  appVersion: string,
  lastSeenVersion: string
): boolean => {
  const entry = entryForVersion(appVersion);
  if (!entry) return false;
  return normalise(lastSeenVersion) !== normalise(appVersion);
};
