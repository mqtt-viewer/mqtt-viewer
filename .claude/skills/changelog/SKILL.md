---
name: changelog
description: Add or update the in-app "What's new" changelog for MQTT Viewer. Use when the user says "update the changelog", "add a changelog entry", "record this in what's new", "note this for the next release", after merging a user-facing PR, or when promoting the unreleased notes at release time.
---

# Update the changelog

The changelog is the in-app "What's new" dialog. It lives in one file:
`frontend/src/changelog.ts`. This skill adds new changes to the unreleased
staging entry, and (at release time) promotes that entry to a version.

**Read `docs/WRITING_STYLE.md` first and follow it.** The hard rules: warm and
first person, British spelling, concise, and NO em dashes (none, not even one).
It must not read like an AI wrote it.

## How the changelog is structured

- `CHANGELOG` is an array of entries, newest first.
- The top entry can be a staging entry with `released: false` and
  `version: "unreleased"`. It gathers changes for the next release and only
  shows on dev builds, so users never read half-finished notes.
- Released entries have `released: true`, a bare semver `version` (e.g.
  `"1.0.0"`), and a `date` like `"July 2026"`.
- Each entry has `headline`, `intro`, `sections` (each `{ emoji, title, body }`),
  and an optional `outro`.

## Adding changes (the common case)

1. **Find what changed and is worth mentioning.** Look at what shipped since the
   last release: `git log v<last-release>..HEAD --oneline`, and the merged PRs.
   Include only things a user would notice: new features, behaviour changes,
   fixes to visible bugs, platform/packaging fixes. Skip pure chores, refactors,
   tests, CI, and docs.

2. **Make sure the staging entry exists.** If the top of `CHANGELOG` isn't an
   unreleased entry, add one:
   ```ts
   {
     version: "unreleased",
     released: false,
     date: "In development",
     headline: "In the next update",
     intro: "Here's what's landed since <last version>. I'll tidy these notes up and give them a version when the update ships.",
     sections: [],
   }
   ```

3. **Write the sections.** Group related changes into one section each. A section
   is one emoji, a short benefit-first title, and one or two sentences of body.
   Lead with what the user can now do. Follow the style guide. Reuse or extend an
   existing section rather than adding a near-duplicate.

4. **Validate.** `cd frontend && pnpm test:run changelog` (checks shape and the
   no-em-dash guard) and `pnpm check`. Both must pass. Optionally preview it in
   Storybook: the `WhatsNewContent` "With unreleased tab" story.

## Promoting at release time

When cutting release `vX.Y.Z` (see `docs/RELEASING.md`):

1. Turn the staging entry into a released one: set `released: true`, set
   `version` to the bare semver (`"X.Y.Z"`, no leading `v`), and set `date` to
   the release month (`"Month YYYY"`).
2. Give it a proper `headline` if it still has the placeholder one.
3. Do NOT decide the version number before release. The bump (patch vs minor) is
   evaluated at release time based on everything that landed.
4. Leave no empty `unreleased` entry behind; the next change re-creates it.
5. Re-run the validation from step 4 above.

## What NOT to do

- No em dashes. The changelog test fails if any slip in.
- No version guessing ahead of release. Keep changes in the staging entry.
- No marketing voice. See `docs/WRITING_STYLE.md`.
- Don't hand-edit `frontend/src/design-system/component-index.json`.
