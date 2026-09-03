// Renders a changelog entry as a GitHub release body.
//
// The release body is not just for the GitHub page. Each release workflow
// POSTs `github.event.release.body` to the portal as `release_notes`, and the
// in-app update dialog shows that text under "What's changed". So the notes a
// user reads before updating come from here, which means they say the same
// thing as the "What's new" dialog they see after updating.
//
// `just release` writes this output to a file and passes it to
// `gh release create --notes-file`. `just release-notes` prints it.
//
// The import carries an explicit .ts extension because scripts/release-notes.mjs
// loads this module in plain Node (--experimental-strip-types), which does no
// extensionless resolution.
import {
  CHANGELOG,
  entryForVersion,
  normalise,
  type ChangelogEntry,
  type ChangelogSection,
} from "./changelog.ts";

export const REPO_URL = "https://github.com/mqtt-viewer/mqtt-viewer";

// The staging entry carries this headline until it is promoted at release
// time. It is scaffolding, not something to print at the top of a release.
const PLACEHOLDER_HEADLINES = ["in the next update"];

const isPlaceholderHeadline = (headline: string): boolean =>
  PLACEHOLDER_HEADLINES.includes(headline.trim().toLowerCase());

const withV = (version: string): string => `v${normalise(version)}`;

// Dry runs are tagged v1.2.0-beta1 and share the notes of the version they are
// rehearsing, so look up on the bare X.Y.Z and keep the full tag for the link.
const baseVersion = (version: string): string =>
  normalise(version).replace(/[-+].*$/, "");

// "a", "a and b", "a, b and c". No Oxford comma, per docs/WRITING_STYLE.md.
const joinList = (parts: string[]): string =>
  parts.length <= 1
    ? parts.join("")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

const thanksLine = (section: ChangelogSection): string | null => {
  const thanks = section.thanks ?? [];
  if (thanks.length === 0) return null;
  const links = thanks.map((t) => `[${t.name}](${t.url})`);
  return `Thanks to ${joinList(links)}.`;
};

export interface ReleaseNotesOptions {
  // The tag being released, e.g. "v1.0.0". Used in the compare link.
  tag: string;
  // The previous release tag. Without it there is no compare link.
  prevTag?: string;
  repoUrl: string;
}

/**
 * GitHub-flavoured markdown for one changelog entry: the headline as an H1,
 * the intro, each section as an H2 with its body and credits, the outro, and
 * a compare link. Blocks are separated by blank lines and the whole thing
 * ends in a single newline.
 */
export const renderReleaseNotes = (
  entry: ChangelogEntry,
  opts: ReleaseNotesOptions
): string => {
  const blocks: string[] = [];

  const headline = entry.headline.trim();
  if (headline && !isPlaceholderHeadline(headline)) {
    blocks.push(`# ${headline}`);
  }

  const intro = entry.intro.trim();
  if (intro) blocks.push(intro);

  for (const section of entry.sections) {
    const title = section.title.trim();
    if (title) blocks.push(`## ${title}`);
    const body = section.body.trim();
    if (body) blocks.push(body);
    const thanks = thanksLine(section);
    if (thanks) blocks.push(thanks);
  }

  const outro = entry.outro?.trim();
  if (outro) blocks.push(outro);

  if (opts.prevTag) {
    blocks.push(
      `[Full changelog](${opts.repoUrl}/compare/${opts.prevTag}...${opts.tag})`
    );
  }

  return `${blocks.join("\n\n")}\n`;
};

export interface ReleaseNotesForVersionOptions {
  prevTag?: string;
  repoUrl?: string;
}

/**
 * The release body for a version, taken from its released changelog entry.
 * A prerelease tag (v1.2.0-beta1) uses the entry for the version it rehearses.
 * Throws on a blank version, and if the entry is missing or has not been
 * promoted yet, so a release can never be created with empty notes.
 */
export const releaseNotesForVersion = (
  version: string,
  opts: ReleaseNotesForVersionOptions = {}
): string => {
  if (!version || !version.trim()) throw new Error("Version is required");
  const tag = version.trim();
  const semver = baseVersion(tag);
  const entry = entryForVersion(semver);
  if (!entry) {
    const staged = CHANGELOG.find((e) => normalise(e.version) === semver);
    throw new Error(
      staged
        ? `The changelog entry for ${semver} is still released: false. Promote it in frontend/src/changelog.ts before creating the release.`
        : `No released changelog entry for ${semver} in frontend/src/changelog.ts. Add one and promote it before creating the release.`
    );
  }
  // A blank prevTag means no previous release, not a tag called "v".
  const prevTag = opts.prevTag?.trim();
  return renderReleaseNotes(entry, {
    tag: withV(tag),
    prevTag: prevTag ? withV(prevTag) : undefined,
    repoUrl: opts.repoUrl ?? REPO_URL,
  });
};
