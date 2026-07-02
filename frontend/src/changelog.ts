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
      "This one's been a long time coming. After years of betas, MQTT Viewer is officially 1.0 — the same tool, now with the polish (and the version number) to match. Thank you for debugging alongside it all this way. Here's what's packed in.",
    sections: [
      {
        emoji: "📈",
        title: "Chart your data, live",
        body: "Tick any numeric field in a topic's payload and watch it plot over time. Pop the chart out into its own window and keep an eye on it while you work elsewhere.",
      },
      {
        emoji: "🗂️",
        title: "A home for the messages you reuse",
        body: "Save messages into collections — per connection or global — and publish them again with a click. Your publish history lives in the sidebar too, and search covers all of it.",
      },
      {
        emoji: "🧠",
        title: "History that minds its manners",
        body: "Message history now stays within a memory budget you control, so a viewer left open over the weekend won't eat your RAM. If you want history to survive restarts, turn on recording and page back through it whenever you like.",
      },
      {
        emoji: "🖼️",
        title: "Images, decoded",
        body: "Publish a PNG, JPEG, GIF, WebP or BMP and the payload tab shows the actual picture — with a raw-bytes view one click away.",
      },
      {
        emoji: "📝",
        title: "Notes like this one",
        body: "After each update you'll get a short, human summary of what changed — this dialog. You can revisit it any time from Settings.",
      },
      {
        emoji: "🐧",
        title: "Better on Linux, faster everywhere",
        body: "Fedora and friends no longer crash at startup (there's a proper rpm and deb now), AppImages render correctly again, and updates install themselves through a new built-in updater.",
      },
    ],
    outro:
      "Found a rough edge? The Feedback button goes straight to us — 1.0 is a milestone, not a finish line.",
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
