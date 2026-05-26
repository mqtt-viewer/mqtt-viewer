import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import {
  buildIndex,
  checklistPath,
  componentIndexPath,
  componentIndexSchemaPath,
  componentNameFromPath,
  componentSpecSchemaPath,
  designTokensPath,
  getComponentFiles,
  readJson,
  relativePath,
  specPathFor,
  storyPathFor,
  storyTitleFor,
  writeChecklist,
  writeJson,
} from "./design-system-utils.mjs";

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run("node", [".storybook/extract-tokens.mjs"]);
const index = buildIndex();
writeJson(componentIndexPath, index);

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  formats: { "date-time": true },
});
const specSchema = readJson(componentSpecSchemaPath);
const indexSchema = readJson(componentIndexSchemaPath);
const validateSpec = ajv.compile(specSchema);
const validateIndex = ajv.compile(indexSchema);
const tokenNames = new Set(Object.keys(readJson(designTokensPath).color ?? {}));
const componentsByName = new Map(
  index.components.map((component) => [component.name, component])
);
const errors = [];
const warnings = [];

const reportAjvErrors = (label, validationErrors) => {
  for (const error of validationErrors ?? []) {
    errors.push(`${label}: ${error.instancePath || "/"} ${error.message}`);
  }
};

for (const sourcePath of getComponentFiles()) {
  const specPath = specPathFor(sourcePath);
  const storyPath = storyPathFor(sourcePath);
  const componentName = componentNameFromPath(sourcePath);
  if (!fs.existsSync(specPath)) {
    errors.push(
      `${relativePath(sourcePath)} is missing ${path.basename(specPath)}`
    );
    continue;
  }

  const spec = readJson(specPath);
  if (!validateSpec(spec)) {
    reportAjvErrors(relativePath(specPath), validateSpec.errors);
  }
  if (spec.name !== componentName) {
    errors.push(
      `${relativePath(specPath)} name must match ${componentName}.svelte`
    );
  }
  for (const token of spec.tokens ?? []) {
    if (!tokenNames.has(token)) {
      errors.push(
        `${relativePath(specPath)} references unknown token '${token}'`
      );
    }
  }
  if (spec.status === "figma-linked") {
    if (!spec.figma?.url || !spec.figma?.nodeId) {
      errors.push(
        `${relativePath(specPath)} is figma-linked but missing figma.url or figma.nodeId`
      );
    }
    if (spec.tier === "primitive" && (!spec.props || spec.props.length === 0)) {
      errors.push(
        `${relativePath(specPath)} is a figma-linked primitive with no props[] mapping`
      );
    }
  }
  if (!fs.existsSync(storyPath)) {
    errors.push(
      `${relativePath(sourcePath)} is missing ${path.basename(storyPath)}`
    );
  } else {
    const story = fs.readFileSync(storyPath, "utf8");
    const expectedTitle = storyTitleFor(sourcePath, spec.tier);
    if (!story.includes(`title: "${expectedTitle}"`)) {
      errors.push(
        `${relativePath(storyPath)} must declare title: "${expectedTitle}"`
      );
    }
    if (!story.includes('tags: ["autodocs"]')) {
      errors.push(
        `${relativePath(storyPath)} must include tags: [\"autodocs\"]`
      );
    }
    if (!story.includes("parameters:") || !story.includes("design")) {
      errors.push(`${relativePath(storyPath)} must include parameters.design`);
    }
  }
}

for (const component of index.components) {
  for (const dependency of component.dependencies ?? []) {
    const dep = componentsByName.get(dependency);
    if (!dep) {
      warnings.push(`${component.name} lists unknown dependency ${dependency}`);
      continue;
    }
    if (component.tier === "primitive") {
      errors.push(
        `${component.name} is primitive and must not depend on ${dependency}`
      );
    }
    if (component.tier === "component" && dep.tier !== "primitive") {
      errors.push(
        `${component.name} is component and may only depend on primitives (${dependency} is ${dep.tier})`
      );
    }
  }
  if (
    (component.tier === "component" || component.tier === "view") &&
    (component.tokens?.length ?? 0) > 6
  ) {
    warnings.push(
      `${component.name} lists many raw tokens; prefer pushing token ownership into primitives`
    );
  }
}

if (!validateIndex(index)) {
  reportAjvErrors(relativePath(componentIndexPath), validateIndex.errors);
}

writeChecklist(index);

if (warnings.length > 0) {
  console.warn("Design-system warnings:");
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (errors.length > 0) {
  console.error("Design-system validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Design-system validation passed: ${index.components.length} components, checklist ${relativePath(checklistPath)}`
);
