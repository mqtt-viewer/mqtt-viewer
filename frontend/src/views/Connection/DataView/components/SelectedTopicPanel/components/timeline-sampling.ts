// Evenly-strided sampling for the message timeline's visual dot layer.
//
// In a 100px-tall timeline strip, more than roughly one dot per two
// horizontal pixels is visually indistinguishable, so rendering every
// message as a vis-timeline DOM item on a busy topic is wasted main
// thread work. Sampling keeps the dot density bounded while the store's
// full history remains available for selection and keyboard navigation.

// Returns an evenly-strided subset of `items` with at most `max`
// elements. The last element is always included: the newest message is
// the selection anchor while auto-following, so it must exist in the
// DataSet. The first element is only included when the stride lands on
// it naturally; precise even spacing matters more than anchoring the
// oldest dot. `max <= 0` returns an empty array (a non-positive budget
// means "render nothing", not "render everything").
export const sampleEvenly = <T>(items: T[], max: number): T[] => {
  if (max <= 0) return [];
  if (items.length <= max) return items;
  const stride = items.length / max;
  const result: T[] = [];
  let previousIndex = -1;
  for (let i = 0; i < max; i++) {
    // Pick the last index of each stride-wide bucket; force the final
    // pick to the newest item and guard against rounding ever selecting
    // the same index twice.
    let index =
      i === max - 1 ? items.length - 1 : Math.round((i + 1) * stride) - 1;
    if (index <= previousIndex) {
      index = previousIndex + 1;
    }
    result.push(items[index]);
    previousIndex = index;
  }
  return result;
};
