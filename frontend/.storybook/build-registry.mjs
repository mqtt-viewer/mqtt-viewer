import { buildIndex, writeComponentIndex } from "./design-system-utils.mjs";

const index = buildIndex();
writeComponentIndex(index);
console.log(
  `Wrote ${index.components.length} components to src/design-system/component-index.json`
);
