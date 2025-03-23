import { colors } from "@/util/resolvedTailwindConfig";

export const untypedColors = colors as unknown as {
  [variant: string]: { [type: string]: string };
};
// Ease-of-use constants for input colors
export const InputColors = {
  PRIMARY: untypedColors["primary"]["DEFAULT"],
  LABEL: untypedColors["secondary-text"]["DEFAULT"],
  OUTLINE: untypedColors["outline"]["DEFAULT"],
  HOVERED: untypedColors["hovered"]["DEFAULT"],
  HOVERED_SWITCH_BG: untypedColors["outline"]["light"],
  ERROR: untypedColors["error"]["DEFAULT"],
  DEFAULT_BACKGROUND: untypedColors["elevation-0"]["DEFAULT"],
};
