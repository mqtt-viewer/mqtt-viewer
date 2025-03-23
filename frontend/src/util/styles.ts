// Thanks to MeltUI
// https://github.com/melt-ui/melt-ui/blob/02dc11b2b992e5ebb01508308e1b89c0e616ac55/src/lib/internal/helpers/style.ts
export function styleToString(style: StyleObject): string {
  return Object.keys(style).reduce((str, key) => {
    if (style[key] === undefined) return str;
    return str + `${key}:${style[key]};`;
  }, "");
}

export type StyleObject = Record<string, number | string | undefined>;
