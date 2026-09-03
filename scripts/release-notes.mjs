#!/usr/bin/env node
// Print the GitHub release body for a version, rendered from the app's own
// changelog (frontend/src/changelog.ts) rather than GitHub's generated PR list.
//
//   node scripts/release-notes.mjs v1.0.0 v0.7.0
//
// `just release` pipes this into a temp file and hands it to
// `gh release create --notes-file`, so the notes on the release, the notes the
// portal stores, and the notes the in-app update dialog shows are all the same
// text as "What's new". Exits non-zero when the version has no released
// changelog entry, which stops a release going out with empty notes.
//
// The renderer is TypeScript, loaded with Node's type stripping. That is still
// behind a flag on Node 22, so re-exec with the flag when it is not already on.

import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const scriptPath = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);

// Set on the child so a Node that never reports type stripping cannot re-exec
// itself forever.
const REEXEC = "MQTT_VIEWER_RELEASE_NOTES_REEXEC";
const STRIP_FLAG = "--experimental-strip-types";

// process.features.typescript only exists from Node 22.10. On 22.6 to 22.9 the
// flag works but the feature flag reads undefined, so fall back to asking
// whether we were started with it.
const typeStripping =
  process.features.typescript !== undefined
    ? Boolean(process.features.typescript)
    : process.execArgv.includes(STRIP_FLAG);

if (!typeStripping) {
  if (process.env[REEXEC] === "1") {
    console.error(
      `This Node (${process.version}) cannot strip TypeScript types, even with ${STRIP_FLAG}. Use Node 22.6 or newer to render the release notes.`
    );
    process.exit(2);
  }
  const result = spawnSync(
    process.execPath,
    [STRIP_FLAG, "--disable-warning=ExperimentalWarning", scriptPath, ...args],
    { stdio: "inherit", env: { ...process.env, [REEXEC]: "1" } }
  );
  process.exit(result.status ?? 1);
}

const [version, prevTag] = args;
if (!version) {
  console.error("usage: node scripts/release-notes.mjs VERSION [PREV]");
  process.exit(2);
}

const rendererPath = path.join(
  path.dirname(scriptPath),
  "..",
  "frontend",
  "src",
  "release-notes.ts"
);
const { releaseNotesForVersion } = await import(
  pathToFileURL(rendererPath).href
);

try {
  process.stdout.write(releaseNotesForVersion(version, { prevTag }));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
