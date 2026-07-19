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
        title: "Sort topics by how busy they are",
        body: "The topic list can now order itself by what matters in the moment: busiest first, most messages, newest first or silent first, alongside the usual A to Z. The graph view offers the same choices and remembers the one you pick per connection. Its filter box also understands MQTT wildcards now, like sensors/+/temperature, just as the list does, and whatever you type in the filter follows you when you switch between list and graph.",
      },
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
        body: 'Numeric readings often turn up wrapped in quotes, like "24.6". You can now chart those too, so a quoted number plots just like a plain one. Values that aren\'t really numbers stay out of the way.',
      },
      {
        title: "Adding a value to a chart is clearer",
        body: 'Choosing "Add value from payload" now opens the picker straight on the value, so it\'s obvious what to tick. Plain numeric payloads, where the whole message is the number, work this way too.',
      },
      {
        title: "Right-click a topic",
        body: "Topics now have a right-click menu, in the list and in the graph. Copy the topic path or the payload, export the message history, or clear the retained message. The selected topic panel offers the same actions, so wherever you are, the options are the same.",
      },
      {
        title: "Clear retained messages in bulk",
        body: "Right-click a branch and you can clear every retained message beneath it in one go. I'll show you the count and ask first, since clearing a retained message reaches every other client on the broker. One caveat worth knowing: I can only clear retained messages I've seen, and on MQTT 3 brokers I only learn about them when I subscribe, so anything retained by another client mid-session won't be counted.",
      },
      {
        title: "Spot retained topics at a glance",
        body: "Topics holding a retained message now carry a small marker, in the list and in the graph, in the same colour the message timeline already uses for retained messages.",
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
