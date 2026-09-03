// Minimal, dependency-free formatting for the release notes shown in the
// update dialog. The text arrives from the portal as GitHub-flavoured markdown
// (see frontend/src/release-notes.ts, which renders it from the changelog), and
// the dialog has no markdown renderer, so we keep the few things that carry
// meaning and drop the syntax.
//
// Headings and bullets survive as structure. Links render as their text, bold
// and italic markers are dropped, and a line that is only a link (the "Full
// changelog" line, or a bare URL) is dropped entirely: there is nowhere to
// click to in a desktop dialog, and a raw compare URL is noise. Blank lines
// collapse; spacing comes from the column gap.

export type NoteLine =
  | { kind: "heading"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "text"; text: string };

const LINK_ONLY = /^\[[^\]]*\]\([^)]*\)$/;
const URL_ONLY = /^<?https?:\/\/\S+>?$/;

const isLinkOnly = (line: string): boolean =>
  LINK_ONLY.test(line) || URL_ONLY.test(line);

// Order matters: links go first so their URLs can't be mistaken for emphasis.
// The italic underscore rule only fires on word boundaries, so file names like
// MQTT_Viewer_1.0.0_darwin survive intact.
const stripMarkup = (text: string): string =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/(^|\W)_([^_]+)_(?!\w)/g, "$1$2")
    .trim();

export const parseReleaseNotes = (notes: string): NoteLine[] => {
  const lines: NoteLine[] = [];
  for (const raw of notes.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (isLinkOnly(line)) continue;

    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      const text = stripMarkup(heading[1]);
      if (text) lines.push({ kind: "heading", text });
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      const text = stripMarkup(bullet[1]);
      if (text) lines.push({ kind: "bullet", text });
      continue;
    }

    const text = stripMarkup(line);
    if (text) lines.push({ kind: "text", text });
  }
  return lines;
};
