// Minimal, dependency-free formatting for the release notes shown in the
// update dialog. The text arrives from the portal as GitHub-flavoured markdown
// (see frontend/src/release-notes.ts, which renders it from the changelog), and
// the dialog has no markdown renderer, so we keep the few things that carry
// meaning and drop the syntax.
//
// Headings and bullets survive as structure. Links render as their text, images
// render as their alt text, bold and italic markers are dropped, and a line that
// is only a link (the "Full changelog" line, or a bare URL) is dropped entirely:
// there is nowhere to click to in a desktop dialog, and a raw compare URL is
// noise. Blank lines collapse; spacing comes from the column gap.

export type NoteLine =
  | { kind: "heading"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "text"; text: string };

const LINK_ONLY = /^\[[^\]]*\]\([^)]*\)$/;
const URL_ONLY = /^<?https?:\/\/\S+>?$/;

// Images first, so `![alt](url)` yields its alt text rather than `!` plus a
// link. Both are stripped before emphasis, so a URL can never be mistaken for
// an emphasis span.
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;

const stripLinks = (text: string): string =>
  text.replace(IMAGE, "$1").replace(LINK, "$1");

// A marker run is emphasis only when it sits on the edge of a word. Plain text
// is full of stray markers (2*3, *.log, sensors/*/temp, __init__.py,
// MQTT_Viewer_1.0.0_darwin), and stripping those mangles the line. So a run
// opens a span only when it starts the line or follows a character that is
// neither a word character, a backslash, nor the marker itself, and is followed
// by a non-space. It closes only when it follows a non-space and is followed by
// the end of the line, whitespace, or punctuation that ends a word.
//
// Lookbehind would say this in half the space, but the app runs in the system
// WebView and older WebKit throws on `(?<=`, so the character before the
// opening run is captured in group 1 and put back instead.
const emphasis = (mark: string, char: string): RegExp =>
  new RegExp(
    `(^|[^\\w\\\\${char}])` +
      mark +
      `([^\\s\\\\]|\\S[\\s\\S]*?[^\\s\\\\])` +
      mark +
      `(?=$|\\s|[^\\w\\s](?:\\s|$))`,
    "gm"
  );

// Two markers before one, or `**bold**` loses its inner pair to the `*` rule.
const EMPHASIS = [
  emphasis("\\*\\*", "*"),
  emphasis("__", "_"),
  emphasis("\\*", "*"),
  emphasis("_", "_"),
];

const stripEmphasis = (text: string): string =>
  EMPHASIS.reduce((out, re) => out.replace(re, "$1$2"), text);

// Last, so an escaped marker is never a delimiter: `\*escaped\*` reads as
// literal asterisks.
const ESCAPED = /\\([\\`*_{}[\]()#+\-.!|>~])/g;

const stripMarkup = (text: string): string =>
  stripEmphasis(stripLinks(text)).replace(ESCAPED, "$1").trim();

// A line is only a link when stripping the link syntax was the one thing that
// changed it. `[Full changelog](url)` and a bare URL go; `[**bold** text](url)`
// stays, because it carries formatting of its own, and so does `![alt](url)`,
// which is an image rather than a link.
const isLinkOnly = (line: string): boolean => {
  if (!LINK_ONLY.test(line) && !URL_ONLY.test(line)) return false;
  return stripLinks(line).trim() === stripMarkup(line);
};

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
