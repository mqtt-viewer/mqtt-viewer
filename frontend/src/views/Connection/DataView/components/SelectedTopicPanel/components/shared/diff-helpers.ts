export type Diff = "+" | "-" | null;

export const getValueDiffStates = (params: {
  valueLeft: string | null;
  valueRight: string | null;
}): {
  valueLeftDiff: Diff;
  valueRightDiff: Diff;
} => {
  const { valueLeft, valueRight } = params;

  if (valueRight === valueLeft) {
    return {
      valueLeftDiff: null,
      valueRightDiff: null,
    };
  }
  if (!valueRight && !!valueLeft) {
    return {
      valueLeftDiff: "-",
      valueRightDiff: null,
    };
  }
  if (!!valueRight && !valueLeft) {
    return { valueLeftDiff: null, valueRightDiff: "+" };
  }
  return {
    valueLeftDiff: "-",
    valueRightDiff: "+",
  };
};

export const getSortedObjectDiffs = (params: {
  objectLeft?: { [key: string]: any };
  objectRight: {
    [key: string]: any;
  };
}) => {
  const { objectLeft, objectRight } = params;
  const allPropertiesSet = new Set<string>();
  Object.keys(objectRight).forEach((key) => allPropertiesSet.add(key));
  if (!!objectLeft) {
    Object.keys(objectLeft).forEach((key) => allPropertiesSet.add(key));
  }

  const sortedAllProperties = Array.from(allPropertiesSet).sort((a, b) => {
    const lowercaseA = a.toLowerCase();
    const lowercaseB = b.toLowerCase();
    return lowercaseA.localeCompare(lowercaseB);
  });
  const result: {
    [key: string]: {
      valueLeft: string | null;
      valueLeftDiff: "+" | "-" | null;
      valueRight: string | null;
      valueRightDiff: "+" | "-" | null;
    };
  } = {};
  sortedAllProperties.forEach((key) => {
    const diffs = getValueDiffStates({
      valueLeft: !!objectLeft?.[key] ? `${objectLeft?.[key]}` : null,
      valueRight: !!objectRight?.[key] ? `${objectRight?.[key]}` : null,
    });
    result[key] = {
      valueLeft: !!objectLeft?.[key] ? `${objectLeft?.[key]}` : null,
      valueLeftDiff: diffs.valueLeftDiff,
      valueRight: !!objectRight?.[key] ? `${objectRight?.[key]}` : null,
      valueRightDiff: diffs.valueRightDiff,
    };
  });
  return result;
};
