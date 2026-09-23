// Buckets an entry's sections by their optional group, shared by the two
// changelog renderers: the GitHub release body (release-notes.ts) and the
// in-app "What's new" dialog (WhatsNewContent.svelte). One helper so the two
// can never disagree about what the notes say.
//
// The .ts extension on the import is deliberate: scripts/release-notes.mjs
// loads this chain in plain Node (--experimental-strip-types), which does no
// extensionless resolution.
import {
  CHANGELOG_GROUPS,
  type ChangelogGroup,
  type ChangelogSection,
} from "./changelog.ts";

export interface ChangelogSectionGroup {
  // null for sections with no group. Older entries are one null bucket.
  group: ChangelogGroup | null;
  sections: ChangelogSection[];
}

/**
 * Sections bucketed for display. An entry with no grouped sections at all
 * yields a single ungrouped bucket, so entries written before groups existed
 * render exactly as they always did. Otherwise the groups come in
 * CHANGELOG_GROUPS order, empty ones dropped, and any leftover ungrouped
 * sections trail behind in their original order.
 */
export const groupSections = (
  sections: ChangelogSection[]
): ChangelogSectionGroup[] => {
  const ungrouped = sections.filter((s) => !s.group);
  if (ungrouped.length === sections.length) {
    return sections.length ? [{ group: null, sections }] : [];
  }

  const buckets: ChangelogSectionGroup[] = [];
  for (const group of CHANGELOG_GROUPS) {
    const inGroup = sections.filter((s) => s.group === group);
    if (inGroup.length) buckets.push({ group, sections: inGroup });
  }
  if (ungrouped.length) buckets.push({ group: null, sections: ungrouped });
  return buckets;
};
