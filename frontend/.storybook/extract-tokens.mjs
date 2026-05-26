import fs from "node:fs";
import path from "node:path";
import tailwindConfig from "../tailwind.config.js";

const outputPath = path.resolve("src/design-system/design-tokens.json");

const flattenColors = (colors, prefix = "") => {
  const result = {};
  for (const [key, value] of Object.entries(colors ?? {})) {
    const tokenName = prefix ? `${prefix}-${key}` : key;
    if (typeof value === "string") {
      result[tokenName] = value;
      continue;
    }
    if (value && typeof value === "object") {
      if (typeof value.DEFAULT === "string") {
        result[tokenName] = value.DEFAULT;
      }
      Object.assign(
        result,
        flattenColors(
          Object.fromEntries(
            Object.entries(value).filter(([nestedKey]) => nestedKey !== "DEFAULT")
          ),
          tokenName
        )
      );
    }
  }
  return result;
};

const colors = flattenColors(tailwindConfig.theme?.extend?.colors ?? {});
const fontSize = Object.fromEntries(
  Object.entries(tailwindConfig.theme?.fontSize ?? {}).map(([key, value]) => {
    if (Array.isArray(value)) return [key, value[0]];
    return [key, value];
  })
);

const tokens = { color: colors, fontSize };
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(tokens, null, 2)}\n`);
console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
