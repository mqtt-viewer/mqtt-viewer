import fs from "node:fs";
import {
  componentNameFromPath,
  designTokensPath,
  extractTokensFromSource,
  getComponentFiles,
  inferTier,
  parsePropsFromSource,
  schemaRelativePathFor,
  specPathFor,
  writeJson,
} from "./design-system-utils.mjs";

const target = process.argv[2];
if (!target) {
  console.error("Usage: pnpm ds:make-spec <ComponentName|path/to/Component.svelte>");
  process.exit(1);
}

const matches = getComponentFiles().filter((sourcePath) => {
  if (sourcePath.endsWith(target)) return true;
  return componentNameFromPath(sourcePath) === target;
});

if (matches.length === 0) {
  console.error(`No component matched ${target}`);
  process.exit(1);
}
if (matches.length > 1) {
  console.error(`Multiple components matched ${target}. Use a path:`);
  for (const match of matches) console.error(`- ${match}`);
  process.exit(1);
}

const sourcePath = matches[0];
const specPath = specPathFor(sourcePath);
if (fs.existsSync(specPath)) {
  console.error(`${specPath} already exists`);
  process.exit(1);
}

const tokens = fs.existsSync(designTokensPath)
  ? Object.keys(JSON.parse(fs.readFileSync(designTokensPath, "utf8")).color ?? {})
  : [];
const source = fs.readFileSync(sourcePath, "utf8");
const componentName = componentNameFromPath(sourcePath);
const spec = {
  $schema: schemaRelativePathFor(specPath),
  name: componentName,
  tier: inferTier(sourcePath, componentName),
  description: `Storybook coverage for ${componentName}.`,
  status: "story-only",
  figma: {
    fileKey: "",
    nodeId: "",
    url: "",
    lastSyncedHash: null,
    lastSyncedAt: null,
  },
  props: parsePropsFromSource(source),
  tokens: extractTokensFromSource(source, tokens),
  dependencies: [],
  notes: "Figma is not linked yet.",
};

writeJson(specPath, spec);
console.log(`Wrote ${specPath}`);
