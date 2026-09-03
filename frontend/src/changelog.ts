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

export interface ChangelogSection {
  title: string;
  body: string;
  thanks?: ChangelogThanks[];
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
        title: "See what the MQTT client is doing",
        body: "Pick View logs from the connection menu for a live, terminal-style view of connects, reconnects, subscriptions and errors, with a filter, level chips, copy and clear. Turn on debug logging per connection when you need the library's full output; it is also written to a rotating file.",
      },
      {
        title: "Start a message inside a collection",
        body: "Every collection folder's menu now has New message, and an empty folder shows one as a row. The message is filed there when you save it. A saved message shows its collection in the top right; pick another one there to move it.",
      },
      {
        title: "Rename messages where you edit them",
        body: "Click the message name at the top of the publish view to rename it.",
      },
      {
        title: "Clearer collection creation",
        body: "The Add to collection search now says you can type a name to create a collection.",
      },
      {
        title: "Drag messages between collections",
        body: "Drag a saved message to reorder it in its folder, or onto another folder to move it there, global or connection. Folders reorder the same way, and a history entry can be dragged straight into a folder to save it.",
      },
      {
        title: "Peek at messages on the timeline",
        body: "Hovering a marker on the message timeline now shows a small preview with the payload, time, QoS and whether it was retained.",
        thanks: [
          {
            name: "Daschi2",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/discussions/84",
          },
        ],
      },
      {
        title: "Disconnect without leaving the connection dialog",
        body: "Most connection fields lock while connected. The dialog header now has a Connect/Disconnect button, so you can drop the connection, change what you need and reconnect, all in one place.",
      },
      {
        title: "A tidier sidebar and forms",
        body: "The sidebar's rows, icons and hover highlights now line up on a shared grid, and form fields across the app breathe properly instead of crowding their labels. The message search dialog got the same treatment: its search field and results now have proper padding instead of sitting flush against the edges.",
      },
      {
        title: "Dropdowns inside dialogs work again",
        body: "Dropdowns in the connection dialog, like Version and Protocol, opened invisibly behind the dialog itself, so clicking them appeared to do nothing. They now open on top where they belong.",
      },
      {
        title: "A proper Save button for connections",
        body: "Closing the connection dialog with the X to save your changes always felt a bit wrong. The dialog now has a footer with a Save button and a note showing when your changes were last saved. Nothing about saving has changed underneath: everything still saves automatically as you type, the footer just makes that visible.",
        thanks: [
          {
            name: "jeeftor",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/124",
          },
        ],
      },
      {
        title: "A status page for your broker",
        body: "There's a new broker status window built for on-the-fly debugging. A health strip warns when the broker is dropping messages or its delivery queue is backing up, a traffic chart plots messages in and out against what this client receives over a 1, 5 or 15 minute window, and a loudest topics table shows which topics are making the noise. It reads the $SYS topics mosquitto, EMQX and VerneMQ publish, and I also measure rates client-side so you still get numbers on brokers that publish nothing. Open it from the pulse icon above the topic tree, or hover the $SYS row.",
        thanks: [
          {
            name: "m1dnight",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/discussions/1#discussioncomment-12598903",
          },
          {
            name: "adamwoodland2",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/discussions/1#discussioncomment-12601084",
          },
          {
            name: "viktak",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/discussions/1#discussioncomment-12790493",
          },
        ],
      },
      {
        title: "Make the status page your own",
        body: "If your broker names its health topics differently, point any tile at your own topic, or add new tiles with the plus at the end of the grid. There's a raw list of every $SYS topic too, and you can pin one as a tile straight from it. Your tiles are saved per connection.",
        thanks: [
          {
            name: "andyg2",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/discussions/1#discussioncomment-12604380",
          },
        ],
      },
      {
        title: "Pop-out windows you can actually move",
        body: "Pop-out chart and broker status windows could not be dragged at all. Grab the header to move them now. On macOS the header also leaves room for the window buttons instead of hiding the connection name behind them.",
      },
      {
        title: "Chart values that arrive as text",
        body: "Numeric readings often turn up wrapped in quotes, like \"24.6\". You can now chart those too, so a quoted number plots just like a plain one. Values that aren't really numbers stay out of the way.",
        thanks: [
          {
            name: "andyg2",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/77",
          },
          {
            name: "Stefan-Pichler",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/109",
          },
        ],
      },
      {
        title: "Adding a value to a chart is clearer",
        body: "Choosing \"Add value from payload\" now opens the picker straight on the value, so it's obvious what to tick. Plain numeric payloads, where the whole message is the number, work this way too.",
        thanks: [
          {
            name: "Daschi2",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/discussions/78",
          },
        ],
      },
      {
        title: "See what your connection is doing",
        body: "There's a \"View logs\" item in the connection menu now, opening a terminal-style view of what the MQTT client is up to: connects, reconnects, subscriptions and errors. Turn on debug logging for the full chatter; everything is also written to a log file you can send me with a bug report.",
      },
      {
        title: "Pick your own chart time window",
        body: "The chart's time window now goes beyond an hour: 3, 6 and 12 hours, a full day, or any custom interval in seconds, minutes, hours or days, remembered per connection.",
        thanks: [
          {
            name: "viktak",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/106",
          },
        ],
      },
      {
        title: "Windows on ARM",
        body: "Releases now include a native Windows ARM64 build, installer and auto-updates included, so Snapdragon laptops no longer need emulation.",
        thanks: [
          {
            name: "cbulock",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/107",
          },
        ],
      },
      {
        title: "A Flatpak for Linux",
        body: "MQTT Viewer now ships as a Flatpak with its own auto-updating repository, alongside the existing AppImage, deb and rpm.",
        thanks: [
          {
            name: "maracuya-robotics",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/96",
          },
        ],
      },
      {
        title: "WebSocket paths work again",
        body: "Connections that use a WebSocket path (like /mqtt) failed to connect. The path is now handled properly when building the connection URL.",
        thanks: [
          {
            name: "mfried40",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/102",
          },
        ],
      },
      {
        title: "A small ask, under a night sky",
        body: "If you've been using the app a while, I'll ask once whether you'd like to star it on GitHub. It's a single dialog with some shooting stars, and it won't nag you again either way.",
      },
      {
        title: "Light mode looks right everywhere",
        body: "Charts, the message timeline and a few icons were keeping their dark colours in light mode. They all follow the theme properly now.",
      },
      {
        title: "Chart and dropdown fixes",
        body: "Switching a chart back to \"All history\" no longer stays stuck on the previous time window. And on Windows, the dropdowns in the connection form could open as an invisible sliver; they render properly now.",
        thanks: [
          {
            name: "viktak",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/95",
          },
          {
            name: "Stefan-Pichler",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/108",
          },
        ],
      },
      {
        title: "Updates that match your install",
        body: "The updater now detects how the app was installed: in-app updates on macOS, Windows and portable Linux, and the right instructions for Flatpak, AppImage, deb and rpm.",
      },
      {
        title: "Updates are harder to miss",
        body: "When a new version is out, a dialog now opens on startup showing what changed, with the choices you'd expect: update now, remind me later, or skip this version. Previously the only hint was a dot on the notification bell.",
      },
      {
        title: "The interface font loads again",
        body: "The Mona Sans typeface the app is designed in was quietly failing to bundle, so the interface fell back to a system font. It now ships and loads properly.",
      },
      {
        title: "Fixed a crash when disconnecting from a busy broker",
        body: "Disconnecting while messages were still flooding in could take the whole app down. The message buffer's shutdown raced its own drain timer; it now stops cleanly no matter how busy the connection is.",
      },
      {
        title: "Reconnecting when the network drops out",
        body: "If a broker went away without closing the connection properly, which is what a dropped VPN, a flaky network or a laptop waking from sleep look like, MQTT Viewer could sit showing \"connected\" with nothing arriving and never reconnect. On MQTT 5 connections it now notices within about ten seconds and reconnects, and keeps retrying for as long as the broker is away.",
      },
      {
        title: "Install it with Nix",
        body: "MQTT Viewer is now packaged as a Nix flake for x86_64 and aarch64 Linux, and the updater points Nix installs at Nix instead of the .deb download.",
      },
      {
        title: "Deleting a connection works again",
        body: "Deleting a connection could fail and quietly roll back if you'd ever used publish or filter history on it. It now removes everything that belongs to the connection, and clearing out a large message history no longer freezes the app while it works.",
      },
      {
        title: "Clearer memory settings",
        body: "The settings dialog now shows how much memory message history is using and estimates the app's total use from your budget.",
      },
      {
        title: "The memory budget now covers every topic",
        body: "On brokers with hundreds of thousands of topics, the last value I keep for each topic sat outside your memory budget, so memory kept growing however low you set it. It is now counted, and if it ever gets large I trim the topics you have heard from least recently. Normal brokers are nowhere near that, so the topic tree is unchanged.",
      },
      {
        title: "Steadier message counts, and a crash that can no longer happen",
        body: "The received and sent counters dropped messages on a busy broker because several arriving at once could overwrite each other's tally. They now count every message, and adding or removing a connection while those numbers are on screen can no longer bring the app down.",
      },
      {
        title: "Messages stay in the order they arrived",
        body: "On MQTT 3 connections the timeline and message history could show messages out of order, and stamp them with the wrong arrival time, because the client handed each one off separately as it came in. They are now recorded in the order they land, which is what MQTT 5 connections already did.",
      },
      {
        title: "Two connections to the same broker no longer fight",
        body: "Opening two connections to one broker in the same second, or running a second copy of the app, gave both the same client ID, so the broker kept dropping one to make room for the other and neither would settle. Each connection now gets its own ID.",
      },
      {
        title: "Connection failures no longer go unreported",
        body: "On MQTT 3 connections, a wrong hostname, refused port, bad credentials or TLS failure gave no feedback for a full ten seconds and then reported a generic timeout instead of the real problem. Failures now report immediately with a plain explanation of what went wrong, and the connection list, home screen, recent connections and tabs all show a lasting \"Connection failed\" indicator until you try again.",
      },
      {
        title: "Collapsible collections",
        body: "Collection folders in the sidebar now collapse and expand, and they remember which were closed between sessions. The message count sits next to the collection name where it's easier to read.",
      },
      {
        title: "Update notes match What's new",
        body: "The update dialog now shows the same notes as What's new, instead of a list of pull request titles.",
      },
      {
        title: "Fewer stray tab stops",
        body: "Tabbing through a button with a tooltip used to stop twice, once on an invisible wrapper and once on the button; now it stops just once.",
      },
    ],
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
