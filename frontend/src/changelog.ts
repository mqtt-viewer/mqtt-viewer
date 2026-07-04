// The in-app changelog. One entry per released version; the newest entry for
// the running version is shown once in the "What's new" dialog (tracked via
// app_settings.lastSeenChangelogVersion), and it stays reachable from
// Settings. Keep the writing warm and plain: these notes are read by people
// mid-task, not by a release pipeline. Follow docs/WRITING_STYLE.md. No emoji.

export interface ChangelogSection {
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
        title: "Chart your data, live",
        body: "Tick any numeric field in a payload and watch it plot over time. Charts pop out into their own window.",
      },
      {
        title: "A message library",
        body: "Save the messages you publish often into collections, per connection or global, and reuse them with a click. Search collections and publish history from the sidebar.",
      },
      {
        title: "History that stays in budget",
        body: "Message history keeps to a memory limit you set, so the app won't eat your RAM if you leave it running. Turn on recording and history survives restarts.",
      },
      {
        title: "Images, decoded",
        body: "PNG, JPEG, GIF, WebP and BMP payloads render as actual images, with the raw bytes one click away.",
      },
      {
        title: "What's-new notes",
        body: "After each update you'll see a short summary of what changed, like this one. You can reopen it any time from Settings.",
      },
      {
        title: "Linux fixes and auto-updates",
        body: "There are proper rpm and deb packages now, so Fedora no longer crashes at startup. AppImages render correctly again, and the app can update itself.",
      },
    ],
    outro:
      "Found a bug or a rough edge? The Feedback button comes straight to me.",
  },
  {
    version: "0.7.0",
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
        body: "Collections of saved messages, publish history and search, all in the new sidebar.",
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
