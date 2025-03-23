import resolveConfig from "tailwindcss/resolveConfig";
import tailwindConfig from "../../tailwind.config.js";

const fullConfig = resolveConfig(tailwindConfig);
const colors = fullConfig.theme?.colors!;

// Tailwind doesn't seem to want to resolve my
// custom colors :(
// So casting it as any to avoid type errors;
const untypedColors = colors as unknown as {
  [variant: string]: { [type: string]: string };
};

export default fullConfig;
export { colors, untypedColors };
