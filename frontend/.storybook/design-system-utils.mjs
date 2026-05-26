import fs from "node:fs";
import path from "node:path";

export const designSystemDir = path.resolve("src/design-system");
export const componentSpecSchemaPath = path.join(
  designSystemDir,
  "component-spec.schema.json"
);
export const componentIndexPath = path.join(
  designSystemDir,
  "component-index.json"
);
export const componentIndexSchemaPath = path.join(
  designSystemDir,
  "component-index.schema.json"
);
export const designTokensPath = path.join(
  designSystemDir,
  "design-tokens.json"
);
export const checklistPath = path.join(
  designSystemDir,
  "COMPONENT_CHECKLIST.md"
);

const roots = [path.resolve("src/components"), path.resolve("src/views")];

const primitiveNames = new Set([
  "AddFieldButton",
  "BaseInput",
  "BaseNumberInput",
  "Button",
  "Card",
  "Checkbox",
  "ConnectionIdenticon",
  "ConnectionStatusCircle",
  "ContextMenu",
  "CopyToClipboard",
  "Dialog",
  "DialogActionBar",
  "DropdownCloseOnClick",
  "DropdownMenu",
  "DropdownMenuItem",
  "FilePathPicker",
  "Icon",
  "IconButton",
  "IconContext",
  "PageHeaderBar",
  "PanelHeader",
  "ProtobufLogo",
  "ResizableContainer",
  "Select",
  "SparkplugLogo",
  "Switch",
  "Tabs",
  "Toast",
  "Tooltip",
]);

export const namespaceForTier = (tier) => {
  if (tier === "primitive") return "Primitives";
  if (tier === "view") return "Views";
  return "Components";
};

export const toPosix = (filePath) => filePath.split(path.sep).join("/");

export const relativePath = (filePath) =>
  toPosix(path.relative(process.cwd(), filePath));

export const readJson = (filePath) =>
  JSON.parse(fs.readFileSync(filePath, "utf8"));

export const writeJson = (filePath, data) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
};

export const walkFiles = (dir, predicate) => {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(fullPath, predicate));
    } else if (predicate(fullPath, entry)) {
      result.push(fullPath);
    }
  }
  return result;
};

export const getComponentFiles = () =>
  roots
    .flatMap((root) =>
      walkFiles(
        root,
        (filePath) =>
          filePath.endsWith(".svelte") && !filePath.endsWith(".stories.svelte")
      )
    )
    .sort();

export const componentNameFromPath = (sourcePath) =>
  path.basename(sourcePath, ".svelte");

export const inferTier = (
  sourcePath,
  componentName = componentNameFromPath(sourcePath)
) => {
  const rel = relativePath(sourcePath);
  if (rel.startsWith("src/views/")) return "view";
  if (primitiveNames.has(componentName)) return "primitive";
  return "component";
};

export const titlePartsForSource = (sourcePath) => {
  const rel = relativePath(sourcePath);
  const sourceRoot = rel.startsWith("src/views/")
    ? "src/views/"
    : "src/components/";
  const withoutRoot = rel.slice(sourceRoot.length).replace(/\.svelte$/, "");
  const parts = withoutRoot
    .split("/")
    .filter((part) => part !== "components")
    .filter(
      (part, index, all) =>
        !(index === all.length - 1 && part === all[index - 1])
    );
  return parts;
};

export const storyTitleFor = (sourcePath, tier) =>
  [namespaceForTier(tier), ...titlePartsForSource(sourcePath)].join("/");

export const storyPathFor = (sourcePath) => {
  const componentName = componentNameFromPath(sourcePath);
  return path.join(path.dirname(sourcePath), `${componentName}.stories.svelte`);
};

export const specPathFor = (sourcePath) => {
  const componentName = componentNameFromPath(sourcePath);
  return path.join(path.dirname(sourcePath), `${componentName}.spec.json`);
};

export const schemaRelativePathFor = (specPath) =>
  toPosix(path.relative(path.dirname(specPath), componentSpecSchemaPath));

export const parsePropsFromSource = (source) => {
  const props = [];
  const seen = new Set();
  const exportLetRegex =
    /export\s+let\s+([A-Za-z0-9_]+)(?:\s*:\s*([^=;\n]+))?(?:\s*=\s*([^;\n]+))?/g;
  for (const match of source.matchAll(exportLetRegex)) {
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const typeExpression = (match[2] ?? "").trim();
    const defaultExpression = (match[3] ?? "").trim();
    const prop = {
      name,
      type: inferPropType(name, typeExpression, defaultExpression),
      required: defaultExpression === "",
    };
    const options = inferPropOptions(name, typeExpression, defaultExpression);
    if (options.length > 0) prop.options = options;
    if (defaultExpression !== "")
      prop.default = cleanDefaultValue(defaultExpression);
    props.push(prop);
  }
  return props;
};

const cleanDefaultValue = (value) => {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const stringMatch = trimmed.match(/^["']([^"']*)["']/);
  if (stringMatch) return stringMatch[1];
  if (trimmed === "undefined" || trimmed.startsWith("undefined as"))
    return null;
  return trimmed;
};

const inferPropType = (name, typeExpression, defaultExpression) => {
  const expression = `${typeExpression} ${defaultExpression}`;
  if (inferPropOptions(name, typeExpression, defaultExpression).length > 0)
    return "enum";
  if (
    /boolean|true|false/.test(expression) ||
    name.startsWith("is") ||
    name.startsWith("has")
  )
    return "boolean";
  if (
    /number/.test(expression) ||
    /^(width|height|size|minSize|maxSize|port|qos|connectionId|firstConnectedAtMs|messageCount|subtopicCount)$/.test(
      name
    )
  )
    return "number";
  if (
    /=>|\bFunction\b/.test(expression) ||
    /^on[A-Z]/.test(name) ||
    [
      "open",
      "close",
      "toggleExpansion",
      "formatPayload",
      "getAllTopics",
      "deleteRetainedMessage",
      "getTopicMatchesSubscription",
      "setEditorText",
    ].includes(name)
  )
    return "function";
  if (
    /Writable|Store|writable\(/.test(expression) ||
    name.endsWith("Store") ||
    ["checked", "isOpen"].includes(name)
  )
    return "store";
  if (/\[\]|Array|\{/.test(expression)) return "object";
  return "string";
};

const optionByPropName = {
  as: ["button", "a", "div"],
  variant: ["primary", "secondary", "text"],
  iconPlacement: ["left", "right"],
  resizeEdge: ["left", "right"],
  size: ["small", "medium"],
  placement: ["top", "right", "bottom", "left"],
  triggerVariant: ["primary", "secondary", "text"],
  state: ["connected", "disconnected", "connecting", "reconnecting"],
  protocol: ["mqtt", "mqtts", "ws", "wss"],
  mqttVersion: ["3", "5"],
  codec: ["none", "base64", "hex"],
  format: ["none", "json", "json-prettier", "xml"],
  sortKey: ["topic", "time"],
  sortDir: ["asc", "desc"],
  type: ["add", "close", "settings", "delete", "connect", "disconnect"],
};

const inferPropOptions = (name, typeExpression, defaultExpression) => {
  if (optionByPropName[name]) return optionByPropName[name];
  const expression = `${typeExpression} ${defaultExpression}`;
  const options = [...expression.matchAll(/["']([^"']+)["']/g)].map(
    (match) => match[1]
  );
  return [...new Set(options)].filter(
    (option) => option.length > 0 && option.length < 40
  );
};

export const extractTokensFromSource = (source, tokenNames) =>
  tokenNames.filter((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?:bg|text|border|ring|from|to|via|fill|stroke)-${escaped}(?:\\b|/)`
    ).test(source);
  });

export const buildIndex = () => {
  const components = getComponentFiles().map((sourcePath) => {
    const componentName = componentNameFromPath(sourcePath);
    const specPath = specPathFor(sourcePath);
    const storyPath = storyPathFor(sourcePath);
    const specExists = fs.existsSync(specPath);
    const rawSpec = specExists
      ? readJson(specPath)
      : {
          name: componentName,
          tier: inferTier(sourcePath, componentName),
          status: "todo",
          description: "",
          props: [],
          tokens: [],
          dependencies: [],
          notes: "Missing colocated component spec.",
          specMissing: true,
        };
    const { $schema, ...spec } = rawSpec;
    const tier = spec.tier ?? inferTier(sourcePath, componentName);
    return {
      ...spec,
      name: spec.name ?? componentName,
      tier,
      status: spec.status ?? "todo",
      sourcePath: relativePath(sourcePath),
      specPath: relativePath(specPath),
      storyPath: fs.existsSync(storyPath) ? relativePath(storyPath) : null,
      storyId: fs.existsSync(storyPath)
        ? storyTitleFor(sourcePath, tier)
        : null,
      props: spec.props ?? [],
      tokens: spec.tokens ?? [],
      dependencies: spec.dependencies ?? [],
      notes: spec.notes ?? "",
      specMissing: !specExists,
    };
  });

  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    tokensRef: relativePath(designTokensPath),
    components,
  };
};

export const writeChecklist = (index) => {
  const rowsByTier = {
    primitive: [],
    component: [],
    view: [],
  };
  for (const component of index.components) {
    rowsByTier[component.tier].push(component);
  }

  const renderRows = (rows) =>
    rows
      .sort((a, b) => (a.storyId ?? a.name).localeCompare(b.storyId ?? b.name))
      .map((component) => {
        const story = component.storyPath ? "[x]" : "[ ]";
        const figma =
          component.figma?.url && component.figma?.nodeId ? "[x]" : "[ ]";
        const props = component.props?.length ? "[x]" : "[ ]";
        const tokens = component.tokens?.length ? "[x]" : "[ ]";
        return `| ${component.storyId ?? component.name} | ${story} | ${figma} | ${props} | ${tokens} |`;
      })
      .join("\n");

  const storyCount = index.components.filter(
    (component) => component.storyPath
  ).length;
  const figmaCount = index.components.filter(
    (component) => component.status === "figma-linked"
  ).length;
  const content = `# Component Checklist\n\n> This file is generated by \`pnpm ds:validate\` from \`component-index.json\`.\n> Hand-edits will be overwritten.\n\n## Foundations\n\n| Token group | Story | Figma | Notes |\n|---|:---:|:---:|---|\n| Tokens (colors + type ramp) | [x] | [ ] | from \`design-tokens.json\` |\n\n## Primitives (\`Primitives/*\`)\n\n| Component | Story | Figma | Props | Tokens |\n|---|:---:|:---:|:---:|:---:|\n${renderRows(rowsByTier.primitive)}\n\n## Components (\`Components/*\`)\n\n| Component | Story | Figma | Props | Tokens |\n|---|:---:|:---:|:---:|:---:|\n${renderRows(rowsByTier.component)}\n\n## Views (\`Views/*\`)\n\n| View | Story | Figma | Props | Tokens |\n|---|:---:|:---:|:---:|:---:|\n${renderRows(rowsByTier.view)}\n\n## Summary\n\n- Components scanned: ${index.components.length}\n- Story present: ${storyCount}\n- Figma-linked: ${figmaCount}\n- Missing specs: ${index.components.filter((component) => component.specMissing).length}\n`;
  fs.writeFileSync(checklistPath, content);
};
