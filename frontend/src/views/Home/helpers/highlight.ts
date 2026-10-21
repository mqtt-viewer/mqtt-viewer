export const highlightParts = (
  text: string,
  search: string
): { text: string; match: boolean }[] => {
  const needle = search.trim().toLowerCase();
  if (needle === "") return [{ text, match: false }];
  const haystack = text.toLowerCase();
  const parts: { text: string; match: boolean }[] = [];
  let pos = 0;
  for (
    let i = haystack.indexOf(needle);
    i !== -1;
    i = haystack.indexOf(needle, pos)
  ) {
    if (i > pos) parts.push({ text: text.slice(pos, i), match: false });
    pos = i + needle.length;
    parts.push({ text: text.slice(i, pos), match: true });
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), match: false });
  return parts;
};
