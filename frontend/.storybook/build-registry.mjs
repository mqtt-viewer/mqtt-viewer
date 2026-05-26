import {
  buildIndex,
  componentIndexPath,
  writeJson,
} from "./design-system-utils.mjs";

const index = buildIndex();
writeJson(componentIndexPath, index);
console.log(
  `Wrote ${index.components.length} components to src/design-system/component-index.json`
);
