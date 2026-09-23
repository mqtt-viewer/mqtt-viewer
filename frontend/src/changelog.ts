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

// A credit for the person whose idea or report led to the change. Rendered as
// "Thanks @name" after the section body; the link goes to the specific issue,
// discussion, or comment where they raised it (not their profile).
export interface ChangelogThanks {
  name: string;
  url: string;
}

// Sections are grouped under these headings in the dialog and the release
// notes, in this order. A section without a group renders under no heading,
// which keeps older entries exactly as they were.
export type ChangelogGroup = "Added" | "Changed" | "Fixed" | "Miscellaneous";
export const CHANGELOG_GROUPS: ChangelogGroup[] = [
  "Added",
  "Changed",
  "Fixed",
  "Miscellaneous",
];

export interface ChangelogSection {
  title: string;
  // Empty when the title says it all; renderers must not print an empty line.
  body: string;
  thanks?: ChangelogThanks[];
  group?: ChangelogGroup;
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
      "Here's what's landed since 1.1.0. I'll tidy these notes up and give them a version when the update ships.",
    sections: [
      {
        group: "Fixed",
        title: "Startup failures show an error instead of a blank window",
        body: "If the app or a pop-out window cannot initialise it now tells you what went wrong and where to report it.",
      },
      {
        group: "Miscellaneous",
        title: "Updated the Wails desktop shell to the current beta",
        body: "The app runtime and the native shell now come from the same Wails release.",
      },
    ],
  },
  {
    version: "1.1.0",
    released: true,
    date: "September 2026",
    headline: "What's new in MQTT Viewer 1.1",
    intro:
      "A graph view of your topics, a broker status page, retained-message cleanup, and the whole app in a browser. Plus two months of fixes.",
    sections: [
      {
        group: "Added",
        title: "See your topics as a graph",
        body: "Each node is sized and coloured by its traffic. Switch between list and graph above the tree.",
      },
      {
        group: "Added",
        title: "Pin the topics you keep coming back to",
        body: "Pin a topic from its right-click menu and it stays at the top of the tree, per connection.",
        thanks: [
          { name: "mrpiggi", url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/153" },
        ],
      },
      {
        group: "Added",
        title: "Sort topics by how busy they are",
        body: "Busiest first, most messages, newest first or silent first, in the list and the graph.",
      },
      {
        group: "Added",
        title: "Right-click a topic",
        body: "Copy the path or payload, export history, or clear the retained message.",
        thanks: [
          { name: "Daschi2", url: "https://github.com/mqtt-viewer/mqtt-viewer/discussions/83" },
        ],
      },
      {
        group: "Added",
        title: "Clear retained messages in bulk",
        body: "Right-click a branch to clear every retained message beneath it. The confirmation lists exactly what will go. On MQTT 3 only messages this client has seen can be cleared.",
        thanks: [
          { name: "Daschi2", url: "https://github.com/mqtt-viewer/mqtt-viewer/discussions/83" },
        ],
      },
      {
        group: "Added",
        title: "Spot retained topics at a glance",
        body: "Retained topics carry a small marker in the list and the graph.",
      },
      {
        group: "Added",
        title: "A status page for your broker",
        body: "Health warnings, a traffic chart and the loudest topics, from $SYS on mosquitto, EMQX and VerneMQ, with client-side rates for brokers that publish nothing.",
        thanks: [
          { name: "m1dnight", url: "https://github.com/mqtt-viewer/mqtt-viewer/discussions/1#discussioncomment-12598903" },
          { name: "adamwoodland2", url: "https://github.com/mqtt-viewer/mqtt-viewer/discussions/1#discussioncomment-12601084" },
          { name: "viktak", url: "https://github.com/mqtt-viewer/mqtt-viewer/discussions/1#discussioncomment-12790493" },
        ],
      },
      {
        group: "Added",
        title: "Run MQTT Viewer in your browser",
        body: "A Docker image, ghcr.io/mqtt-viewer/mqtt-viewer, and a Home Assistant add-on. Setup is in docs/DOCKER.md.",
        thanks: [
          { name: "SiriosDev", url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/119" },
        ],
      },
      {
        group: "Added",
        title: "See what the MQTT client is doing",
        body: "View logs in the connection menu shows connects, subscriptions and errors live, with debug logging per connection.",
      },
      {
        group: "Added",
        title: "Rearrange the panels",
        body: "The topic panel docks right or bottom, or pops out into its own window.",
        thanks: [
          { name: "ElectronicBattle", url: "https://github.com/mqtt-viewer/mqtt-viewer/discussions/46" },
        ],
      },
      {
        group: "Added",
        title: "Better collection controls and interactions",
        body: "New message from any folder, drag to reorder or move between folders, drag history entries in, rename by clicking the name.",
      },
      {
        group: "Added",
        title: "Peek at messages on the timeline",
        body: "Hover a marker for the payload, time, QoS and retained flag.",
        thanks: [
          { name: "Daschi2", url: "https://github.com/mqtt-viewer/mqtt-viewer/discussions/84" },
        ],
      },
      {
        group: "Added",
        title: "Pick your own chart time window",
        body: "3, 6 and 12 hours, a day, or a custom interval.",
        thanks: [
          { name: "viktak", url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/106" },
        ],
      },
      {
        group: "Added",
        title: "Windows on ARM",
        body: "A native ARM64 build with installer and auto-updates.",
        thanks: [
          { name: "cbulock", url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/107" },
        ],
      },
      {
        group: "Added",
        title: "A Flatpak for Linux",
        body: "With its own auto-updating repository.",
        thanks: [
          { name: "maracuya-robotics", url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/96" },
        ],
      },
      {
        group: "Added",
        title: "Install it with Nix",
        body: "A flake for x86_64 and aarch64 Linux.",
      },
      {
        group: "Changed",
        title: "Chart values that arrive as text",
        body: "A number in quotes charts like a plain one.",
        thanks: [
          { name: "andyg2", url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/77" },
          { name: "Stefan-Pichler", url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/109" },
        ],
      },
      {
        group: "Changed",
        title: "Adding a value to a chart is clearer",
        body: "\"Add value from payload\" opens the picker on the value.",
        thanks: [
          { name: "Daschi2", url: "https://github.com/mqtt-viewer/mqtt-viewer/discussions/78" },
        ],
      },
      {
        group: "Changed",
        title: "Clearer memory settings",
        body: "Settings show what history is using and what the app can grow to per connection.",
      },
      {
        group: "Changed",
        title: "The memory budget now covers every topic",
        body: "The last value kept per topic counts against it.",
      },
      {
        group: "Changed",
        title: "Icon seed and delete are out in the open",
        body: "At the top of the connection form instead of behind a cog.",
      },
      {
        group: "Changed",
        title: "A tidier sidebar and forms",
        body: "Rows and icons share a grid, and fields no longer crowd their labels.",
      },
      {
        group: "Fixed",
        title: "Connection failures were reported late and vaguely",
        body: "On MQTT 3 a bad host, port, credential or certificate now fails immediately with a plain reason.",
      },
      {
        group: "Fixed",
        title: "Reconnecting when the network drops out",
        body: "MQTT 5 connections notice a silent broker within about ten seconds and keep retrying.",
      },
      {
        group: "Fixed",
        title: "Two connections to the same broker no longer fight",
        body: "Each gets its own client ID.",
      },
      {
        group: "Fixed",
        title: "WebSocket paths",
        body: "Connections with a path like /mqtt connect again.",
        thanks: [
          { name: "mfried40", url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/102" },
        ],
      },
      {
        group: "Fixed",
        title: "Deleting a connection",
        body: "No longer fails if it had history, and clearing a large history no longer freezes the app.",
      },
      {
        group: "Fixed",
        title: "Crash when disconnecting from a busy broker",
        body: "",
      },
      {
        group: "Fixed",
        title: "Message counts under load",
        body: "The counters no longer drop messages.",
      },
      {
        group: "Fixed",
        title: "Message order on MQTT 3",
        body: "Recorded in arrival order, as on MQTT 5.",
      },
      {
        group: "Fixed",
        title: "The chart's Y-axis rescales with its time window",
        body: "",
      },
      {
        group: "Fixed",
        title: "Chart and dropdown fixes",
        body: "\"All history\" no longer sticks; Windows dropdowns no longer open as a sliver.",
        thanks: [
          { name: "viktak", url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/95" },
          { name: "Stefan-Pichler", url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/108" },
        ],
      },
      {
        group: "Fixed",
        title: "Pop-out windows can be moved",
        body: "",
      },
      {
        group: "Fixed",
        title: "Dropdowns inside dialogs open on top, not behind",
        body: "",
      },
      {
        group: "Fixed",
        title: "The timeline reaches every message in loaded history",
        body: "",
      },
      {
        group: "Fixed",
        title: "Light mode",
        body: "Charts, the timeline and icons follow the theme.",
      },
      {
        group: "Fixed",
        title: "The interface font loads again",
        body: "",
      },
      {
        group: "Miscellaneous",
        title: "Connect and disconnect from the connection dialog's header",
        body: "",
      },
      {
        group: "Miscellaneous",
        title: "The connection dialog has a Save button",
        body: "",
        thanks: [
          { name: "jeeftor", url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/124" },
        ],
      },
      {
        group: "Miscellaneous",
        title: "The pencil on a connection tile opens the details dialog",
        body: "",
      },
      {
        group: "Miscellaneous",
        title: "Long topic previews truncate at the panel edge",
        body: "",
      },
      {
        group: "Miscellaneous",
        title: "The main window no longer scrolls by a phantom line",
        body: "",
      },
      {
        group: "Miscellaneous",
        title: "Buttons with tooltips take one tab stop, not two",
        body: "",
      },
      {
        group: "Miscellaneous",
        title: "Dependencies updated to close 19 security issues",
        body: "",
      },
    ],
    outro:
      "Found a bug or a rough edge? Use the Feedback button, I want to know.",
  },
  {
    version: "1.0.0",
    released: true,
    date: "July 2026",
    headline: "MQTT Viewer 1.0 is here",
    intro:
      "After years of betas, MQTT Viewer is officially 1.0. The big new features (charting, collections, bounded memory, image previews) arrived in 0.7.0, so have a look at that tab too. Here's what 1.0 adds on top.",
    sections: [
      {
        title: "Release notes",
        body: "After each update you'll see a short summary of what changed, like this one. You can reopen it any time from Settings, or by clicking the version number at the bottom of the window.",
      },
      {
        title: "Linux fixes and auto-updates",
        body: "There are proper rpm and deb packages now, so Fedora no longer crashes at startup. AppImages render correctly again, and the app can update itself.",
        thanks: [
          {
            name: "hobbes1069",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/36",
          },
        ],
      },
    ],
    outro:
      "Found a bug or a rough edge? Use the Feedback button, I want to know.",
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
        title: "Light mode",
        body: "The app now has a proper light theme, with a toggle that remembers your choice.",
        thanks: [
          {
            name: "oeed",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/18",
          },
          {
            name: "juggledad",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/discussions/21",
          },
        ],
      },
      {
        title: "Topic charting",
        body: "Chart numeric payload fields over time, live, with a pop-out window.",
        thanks: [
          {
            name: "edolis",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/43",
          },
        ],
      },
      {
        title: "Message library",
        body: "Collections of saved messages, publish history, and search, all in the new sidebar.",
        thanks: [
          {
            name: "viktak",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/42",
          },
        ],
      },
      {
        title: "Bounded memory and durable history",
        body: "History stays within a configurable memory budget, with opt-in recording to disk.",
        thanks: [
          {
            name: "m1dnight",
            url: "https://github.com/m1dnight",
          },
        ],
      },
      {
        title: "Image payload previews",
        body: "Image payloads render as images, not noise.",
        thanks: [
          {
            name: "jeeftor",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/35",
          },
        ],
      },
    ],
  },
];

export const normalise = (version: string): string =>
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
