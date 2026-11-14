export type GroupDrop = { groupId: number | null }; // null = Ungrouped

// Finds the Home section under the pointer. Sections carry data-group-drop with
// a group id, or "ungrouped".
export const resolveGroupDrop = (
  el: Pick<Element, "closest"> | null
): GroupDrop | null => {
  const value = el
    ?.closest("[data-group-drop]")
    ?.getAttribute("data-group-drop");
  if (value == null) return null;
  if (value === "ungrouped") return { groupId: null };
  return /^[1-9]\d*$/.test(value) ? { groupId: Number(value) } : null;
};
