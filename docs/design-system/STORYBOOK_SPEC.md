# Storybook + Design-System Spec — MQTT Viewer

> Implementation spec for an AI agent. Goal: stand up Storybook in `frontend/`,
> build a machine-readable component registry that bridges Figma and code, and
> wire validation so the Figma → AI → code loop is reliable.
>
> **End-state workflow:** designer edits Figma → AI agent diffs Figma against
> `component-registry.json` → AI emits a spec-change doc → implementing agent
> applies it to the Svelte code and updates the registry.

---

## 0. Context the implementer must know

This repo is **not** like `hackhunter/apps/lib/ui` (which is SvelteKit). Differences
that change every config decision:

| Fact | Value | Consequence |
|---|---|---|
| App shell | Wails desktop app, **plain Svelte 5 + Vite** (no SvelteKit) | Use `@storybook/svelte-vite`, **never** `@storybook/sveltekit`. No `sveltekit_experimental` preview block. |
| Svelte | v5 but components use **legacy syntax** (`export let`, `on:click`, `$$Props`) | Storybook must reuse the existing `svelte.config.js` preprocessing chain (`vitePreprocess` → `sveltePreprocess` → `preprocessMeltUI`). Do not rewrite components to runes. |
| Styling | Tailwind 3.4, `preflight: false`, `src/custom-preflight.css` | Preview must import `src/style.css` + `src/custom-preflight.css` so stories look real. |
| Tokens | Live in `frontend/tailwind.config.js` → `theme.fontSize` + `theme.extend.colors` | These are the source for `design-tokens.json` (section 4). |
| Aliases | `@` → `src`, `wailsjs` → `wailsjs` (Go bindings) | Storybook Vite config must replicate both aliases. `wailsjs` must be **mocked** (section 5). |
| Wails coupling | 3 components import `wailsjs` directly; 9 stores do | Components are mostly props-driven already; make that a hard rule (section 6). |
| Existing stories | none | Greenfield. |
| Component count | ~46 in `src/components`, ~40 view-level under `src/views` | See `COMPONENT_CHECKLIST.md`. |

All Storybook files live under `frontend/`. Run everything with `pnpm` (match the
hackhunter setup) from `frontend/`.

---

## 1. Architecture: colocated spec = truth, index = generated

The hackhunter approach is: co-located stories + `addon-designs` Figma links +
a coverage script that emits a checklist. That keeps stories *present* but the
code↔design mapping is **implicit** — there's nothing a machine can diff.

For the Figma → AI → code loop we need a diffable contract, but **not** a single
hand-maintained registry file (that's a third source of truth that rots and
causes merge conflicts at scale). Instead, three layers:

1. **Source of truth — colocated `<Component>.spec.json`** beside each
   `.svelte`/`.stories.svelte`. Hand-authored (by human or AI). Holds the
   prop/variant contract, tokens consumed, Figma node + `lastSyncedHash`,
   dependencies, notes. Validated against
   `frontend/src/design-system/component-spec.schema.json`. A developer only
   ever edits the folder they're already in — low adoption friction (this
   matters: the workflow is intended to become a sellable service, so
   locality-of-behavior beats a central file).
2. **Generated index — `frontend/src/design-system/component-index.json`**
   (built by `ds:registry`, validated against `component-index.schema.json`,
   **never hand-edited**, regenerated in CI). The queryable/diffable aggregate
   the AI and CI consume. This is the hackhunter `coverage.md` pattern
   (generated, not edited) generalized to carry the full contract.

> **File layout (all operational DS machinery lives with the code):**
> `frontend/src/design-system/` holds the two JSON Schemas, the generated
> `component-index.json` + `design-tokens.json`, the generated
> `COMPONENT_CHECKLIST.md`, and `changes/` (handover docs). The colocated
> `<Component>.spec.json` files sit beside their components. Only the prose
> plan (`STORYBOOK_SPEC.md`, `WORKFLOW.md`) stays in `docs/design-system/`.
3. **The sync engine (future service) — an MCP server** exposing
   `listComponents()`, `getComponentSpec(name)`, `getFigmaDrift(name)`. Reads the
   colocated specs live, calls Figma, computes the drift hash. Shipping this
   instead of a static file means nothing stale lands in a customer repo and the
   sync logic stays encapsulated. Out of scope for the initial mqtt-viewer build
   (section 10) but the file layout above is chosen to make it a clean add-on.

Stories + `addon-designs` remain the human-facing visual layer. One sync key
across all layers: the **PascalCase component name**, identical in Figma and code.

**Why not Figma Code Connect?** It is Figma's official colocated code↔design
mapping and would replace much of the `.spec.json` — but it requires a paid
Figma Organization/Enterprise plan and Svelte is not a first-class target
(React/HTML/Compose/SwiftUI only). Decision: **do not use Code Connect.** The
custom `.spec.json` is framework-agnostic and free. Revisit only if a customer
is already on a Figma Org plan.

**Drift-hash reality:** the Figma REST API exposes `lastModified`/`version` only
at the *file* level — no per-node timestamp or hash. So `lastSyncedHash` is
**computed by our tooling** from the node's metadata + variant props + variable
defs (via the Figma MCP `get_metadata` / `get_variable_defs`), then stored in the
colocated spec. The diff = recompute live hash, compare to stored.

---

## 2. Dependencies to add (`frontend/package.json`)

Match hackhunter's Storybook 9 line. **Risk:** `@storybook/addon-vitest`
requires **Vitest 3**; this repo pins `vitest ^1.4.0`. Bump `vitest` to `^3.2.4`
and run the existing `pnpm test` suite to confirm nothing breaks. If the bump is
disruptive, ship Storybook without `addon-vitest` first and add it in a second
pass (note this in the PR).

```jsonc
// devDependencies — add
"storybook": "9.1.20",
"@storybook/svelte-vite": "9.1.20",        // NOTE: svelte-vite, not sveltekit
"@storybook/addon-svelte-csf": "5.1.2",
"@storybook/addon-docs": "9.1.20",
"@storybook/addon-a11y": "9.1.20",
"@storybook/addon-designs": "10.0.2",      // Figma frame embeds per story
"@storybook/addon-vitest": "9.1.20",       // requires vitest 3 (see risk above)
"@vitest/browser": "3.2.4",
"playwright": "^1.60.0"
```

Scripts to add:

```jsonc
"storybook": "storybook dev -p 6006",
"build-storybook": "storybook build",
"test-storybook": "vitest --project=storybook --run",
"ds:registry": "node .storybook/build-registry.mjs",   // (re)generate src/design-system/component-index.json from colocated specs + disk
"ds:validate": "node .storybook/validate-registry.mjs", // regen index, validate specs + coverage (CI gate)
"ds:tokens": "node .storybook/extract-tokens.mjs"        // tailwind.config.js -> src/design-system/design-tokens.json
```

All generated outputs and schemas live in `frontend/src/design-system/` (see §1
file-layout note). The `.mjs` scripts live in `.storybook/`.

This project uses npm-style `package.json` but hackhunter uses pnpm; **confirm
which package manager `frontend/` uses** (look for a lockfile). Use whatever is
already present; the scripts above are manager-agnostic.

---

## 3. Storybook config (`frontend/.storybook/`)

### `main.ts`
```ts
import type { StorybookConfig } from '@storybook/svelte-vite';

const config: StorybookConfig = {
  framework: { name: '@storybook/svelte-vite', options: {} },
  stories: ['../src/**/*.stories.@(svelte|ts)'],
  addons: [
    '@storybook/addon-svelte-csf',
    '@storybook/addon-docs',
    '@storybook/addon-a11y',
    '@storybook/addon-designs',
    '@storybook/addon-vitest', // omit if vitest bump deferred
  ],
  docs: { autodocs: 'tag' },
  viteFinal: async (config) => {
    const { mergeConfig } = await import('vite');
    const { fileURLToPath, URL } = await import('node:url');
    return mergeConfig(config, {
      resolve: {
        alias: {
          '@': fileURLToPath(new URL('../src', import.meta.url)),
          // Mock the Wails Go bindings — section 5
          'wailsjs': fileURLToPath(new URL('./mocks/wailsjs', import.meta.url)),
        },
      },
    });
  },
};
export default config;
```

The svelte plugin picks up `frontend/svelte.config.js` automatically, so the
melt-ui / svelte-preprocess chain is reused. Verify a melt-ui component (e.g.
`Tooltip`, `DropdownMenu`) renders in Storybook before declaring done.

### `preview.ts`
Import real styles, force the app's dark theme, set a sensible viewport. Adapt
hackhunter's `preview.ts` but **delete the `sveltekit_experimental` block** (not
applicable here).

```ts
import type { Preview } from '@storybook/svelte-vite';
import '../src/custom-preflight.css';
import '../src/style.css';

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    backgrounds: {
      default: 'App background',
      values: [
        { name: 'App background', value: '#020202' }, // elevation-0
        { name: 'Card', value: '#161616' },           // elevation-1-card
      ],
    },
    a11y: { test: 'todo' },
  },
};
export default preview;
```

If the app sets the dark class/attrs on `<html>` at runtime, replicate that in a
preview decorator so colors match production.

---

## 4. Design tokens (`design-tokens.json` + `extract-tokens.mjs`)

`tailwind.config.js` is the token source today. Generate a flat, Figma-friendly
token file so Figma variables and code share names.

`extract-tokens.mjs` must:
1. Import the resolved Tailwind theme (there is already
   `src/util/resolvedTailwindConfig.ts` — reuse its approach, or
   `require('tailwindcss/resolveConfig')`).
2. Emit `frontend/src/design-system/design-tokens.json`:
   ```jsonc
   {
     "color": { "primary": "#7c8cff", "primary-light": "#9aa1fe",
                "elevation-1-card": "rgb(22,22,22)", "error": "rgb(239,68,68)", ... },
     "fontSize": { "xs": "9px", "sm": "11px", "base": "13px", "lg": "15px", "xl": "17px" }
   }
   ```
3. Naming rule: token key = the Tailwind utility suffix (`primary`,
   `secondary-text`, `elevation-2-hover`). These keys are what `component.tokens[]`
   references and what Figma variables should be named — **identical strings**.

Add a `Foundations/Tokens` story (`src/foundations/Tokens.stories.svelte`,
create the folder) that renders swatches + type ramp from `design-tokens.json`,
each labeled with its token name, with a Figma link to the variables/styles
frame. This is the human checkpoint that Figma variables and code tokens agree.

---

## 5. Mocking Wails (`frontend/.storybook/mocks/wailsjs/`)

The `wailsjs` alias in `main.ts` points here. Provide stub modules mirroring the
real `frontend/wailsjs/` tree (`go/...`, `runtime/...`) exporting the same
function names as no-ops / static fixtures so any component transitively
importing them renders. Keep stubs minimal — only what stories actually pull in.
The 3 directly-coupled components are: `FeedbackDialog`, `FilePathPicker`,
`UpdateDialog`. Store-coupled components (9 stores import wailsjs) should receive
data via props in stories (section 6) rather than relying on live stores.

---

## 6. Component authoring rules (hard rules for stories to work)

Lift from hackhunter `AGENTS.md`, adapted:

1. **Props over fetching / store-reading.** A component rendered in a story must
   accept its data via props. Where a component currently reads a store or calls
   `wailsjs`, the story passes mock data; if that's impossible without
   refactor, note it in `registry.notes` and the checklist rather than forcing it.
2. **Co-locate** `Component.stories.svelte` beside `Component.svelte` (Svelte CSF
   via `defineMeta`/`<Story>`).
3. **Title namespace = tier:** `Primitives/*`, `Components/*`, `Views/*`. Must
   match `registry.tier` + `registry.storyId`.
4. **`tags: ['autodocs']`** on every meta (prop tables + smoke tests). Untagged
   stories are skipped by `test-storybook`.
5. **Figma link** on every meta:
   `parameters.design = { type: 'figma', url: '<frame>' }`. Use `''` with a
   `// TODO(figma-url)` until known.
6. **`argTypes`** for every finite/enum prop, options matching the registry prop
   `options[]` (which match Figma variant values).

### Story template
```svelte
<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Button from './Button.svelte';
  const { Story } = defineMeta({
    title: 'Components/Button',
    component: Button,
    tags: ['autodocs'],
    argTypes: {
      variant: { control: 'select', options: ['primary', 'secondary', 'text'] },
    },
    parameters: { design: { type: 'figma', url: '' /* TODO(figma-url) */ } },
  });
</script>

<Story name="Primary" args={{ variant: 'primary' }}>Click me</Story>
<Story name="Secondary" args={{ variant: 'secondary' }}>Cancel</Story>
<Story name="Text" args={{ variant: 'text' }}>Link</Story>
```

---

## 7. Colocated spec + generated index

### 7a. The colocated spec — `<Component>.spec.json` (source of truth)
Hand-authored beside each component, validated by
`frontend/src/design-system/component-spec.schema.json`. This is the only
metadata file a human/AI edits. Example
`frontend/src/components/Button/Button.spec.json` (note the now-short `$schema`
relative path — that's why the schemas live under `src/design-system/`):

```jsonc
{
  "$schema": "../../design-system/component-spec.schema.json",
  "name": "Button",
  "tier": "primitive",
  "description": "Standard action button with icon support.",
  "status": "figma-linked",
  "figma": {
    "fileKey": "ABC123",
    "nodeId": "10:42",
    "url": "https://figma.com/design/ABC123/...?node-id=10-42",
    "lastSyncedHash": "sha256:...",
    "lastSyncedAt": "2026-05-26T00:00:00Z"
  },
  "props": [
    { "name": "variant", "type": "enum", "options": ["primary","secondary","text"],
      "default": "primary", "figmaProperty": "Variant" },
    { "name": "iconType", "type": "string", "required": false },
    { "name": "iconPlacement", "type": "enum", "options": ["left","right"], "default": "left" }
  ],
  "tokens": ["primary", "secondary", "white-text", "elevation-2"],
  "dependencies": ["Icon"],
  "notes": ""
}
```
Note there are **no path fields** — location is the identity. Paths are resolved
by the generator.

### 7b. `build-registry.mjs` — generates `component-index.json` (never hand-edited)
Walk `src/components` and `src/views`. For each `*.svelte` that is **not** a
sub-part (apply hackhunter's ignore heuristics — see its
`check-story-coverage.mjs`: skip `_`-prefixed, sub-parts like `*Item`, files
whose name ≠ parent dir under nested `components/`):
- look for a sibling `<Component>.spec.json`;
- if present, copy its fields verbatim and add resolved `sourcePath`,
  `specPath`, `storyPath`/`storyId`;
- if absent, emit a stub row with `specMissing: true`, `status: "todo"`, `tier`
  inferred from path (`components/`→component, `views/`→view; flag obvious
  primitives — Button/Card/Icon/Input/Select/Switch/etc. — as `primitive`).

Output validates against `component-index.schema.json`
(`frontend/src/design-system/`). The generator never writes to the colocated
specs (one-way: specs → index).

A `make:spec <ComponentName>` helper that scaffolds a blank `.spec.json` (correct
`$schema` relative path — **compute it per file**, since nested views like
`views/Connection/DataView/` sit at a different depth than `components/Button/` —
plus `name`, inferred `tier`, `status: "todo"`) is worth adding so authoring
stays cheap.

### Status model
`todo` → `story-only` (story exists) → `figma-linked` (figma.url + nodeId +
props mapped) → `deprecated`. Validation (section 8) enforces what each status
requires. No `code-connected` state — Code Connect is not used (section 1).

### 7c. Tier sync semantics — what each tier promises the engine
Tier is not cosmetic; it tells the drift engine **which diff to run, how much to
trust it, and which structural rules apply.**

| Tier | Figma object | Drift means | Diff strategy | Confidence |
|---|---|---|---|---|
| primitive | component-**set** w/ variants | variant added/renamed, token swapped | `props[].options` ↔ Figma variant values; `tokens[]` ↔ variables | **High — automatable** |
| component | composed **instance** | composition changed (added/swapped a child) | compare `dependencies[]`; props only where it exposes them | **Medium — needs dep graph** |
| view | **frame** | layout/content shifted | screenshot / visual regression; do **not** force a prop diff | **Low — human/visual** |

Rules the validator (section 8) enforces *because* tier exists:
1. **Dependency direction (hard error):** primitive depends on nothing in the
   system; component → primitives only; view → components + primitives. An
   uphill dependency means it can't be a clean Figma library object → unsyncable.
2. **Token reach (warning):** raw `tokens[]` belong on primitives. A component/
   view listing many raw tokens is hardcoding past primitives — flag it.
3. **Status gating by tier:** `figma-linked` requires a variant-mapped node for
   primitives, but a frame is acceptable for views (no `props` requirement).

Consequence for misclassification: a domain widget mislabeled `primitive` gets
the high-confidence prop diff and produces **false drift / missing-node noise**;
a primitive mislabeled `component` **loses** the automatic variant diff. Tier
accuracy = sync reliability. The drift agent should treat tier as authoritative
and the implement agent should fix tier before anything else if it's wrong.

---

## 8. Validation (`validate-registry.mjs`) — the CI gate

`pnpm ds:validate` first runs `ds:registry` (regenerate the index), then checks.
Must exit non-zero on any failure and print a report:

1. **Spec schema:** every `<Component>.spec.json` validates against
   `component-spec.schema.json` (use `ajv`).
2. **Index schema:** regenerated `component-index.json` validates against
   `component-index.schema.json`.
3. **Disk sync:** every non-sub-part `.svelte` under `src/components`/`src/views`
   has a sibling `.spec.json` (else `specMissing: true` row → fails once the
   component is past `todo`). Reuse hackhunter's ignore heuristics.
4. **Story coverage:** entries with `status != todo` have a real story file with
   a matching `title`.
5. **Figma completeness:** `status == figma-linked` ⇒ non-empty `figma.url` +
   `figma.nodeId` + at least one `props` entry.
6. **Token validity:** every string in a spec's `tokens[]` exists as a key in
   `design-tokens.json`. (Catches drift when tokens are renamed.)
7. **Sync key:** `name` in each `.spec.json` matches its component filename.
8. **Checklist regen:** rewrite `COMPONENT_CHECKLIST.md` from the index so the
   checklist never drifts from reality.

Wire `ds:validate` into `.github/workflows` as a PR check. Also have it run as a
Storybook test step if `addon-vitest` is enabled. CI should fail if
`component-index.json` is committed out-of-date (regenerate + `git diff --exit-code`).

---

## 8b. Storybook MCP — agent read-access to the rendered library

Agents get a second window onto the library (besides the specs): the **Storybook
MCP**, which reads Storybook's `index.json` and exposes list-components,
list-stories/variants, get-docs (props from `argTypes`/autodocs), screenshots,
and test running. This is **complementary** to the specs, not a duplicate:

| Source | Knows | Used for |
|---|---|---|
| Storybook MCP | rendered reality: props, variants, a11y, screenshots, test results | discovery, reuse, **verifying** after edits |
| `.spec.json` / index | design contract: Figma nodeId, `lastSyncedHash`, tokens, tier, dep graph | Figma drift, layering rules, sync state |

The MCP knows nothing about Figma drift or the dependency graph — that's why the
specs still earn their place.

**Which server:** use the framework-agnostic third-party
[`mcpland/storybook-mcp`](https://github.com/mcpland/storybook-mcp) (point
`STORYBOOK_URL` at `<storybook>/index.json`). The **official** Storybook MCP's AI
features are **React-only in preview** as of 2026, so it's not suitable for this
Svelte project; we only need read access, which the third-party reader provides
for any renderer. Our mandated `tags: ['autodocs']` + `argTypes` are exactly what
populates the `index.json` it consumes — the plan already feeds it.

**Prerequisite:** the MCP needs a reachable `index.json`, i.e. Storybook must be
**served or built first** (`pnpm storybook` running, or `pnpm build-storybook`
then serve `storybook-static/`). Skills that use it must ensure this.

Setup is a one-time `.mcp.json` / client config entry pointing at the server +
`STORYBOOK_URL`; document it in `WORKFLOW.md`.

---

## 9. Sync engine / MCP server (future service, out of scope for v1)

Not built in the initial mqtt-viewer pass, but the file layout above is chosen to
make it a clean add-on later. The eventual sellable piece is an MCP server that:
- `listComponents()` / `getComponentSpec(name)` — read the colocated specs live
  (no static file shipped to the customer);
- `getFigmaDrift(name)` — pull the linked Figma node (`get_metadata`,
  `get_variable_defs`), recompute the structural hash, compare to
  `figma.lastSyncedHash`, and diff variant props/variables against the spec;
- emit the spec-change doc (section 10, step 3).

For v1, the same drift check can run as a plain script the AI invokes manually;
the MCP wrapper is purely an ergonomics/packaging upgrade. **Code Connect is
deliberately not part of this** (paid Figma Org plan; no first-class Svelte) — the
custom `.spec.json` + structural-hash diff is the free, framework-agnostic path.

---

## 10. The Figma → AI → code loop (document this in the repo)

Add `docs/design-system/WORKFLOW.md` (or a section in the README) describing the
operating loop so future agents follow it:

1. **Design:** edit components in Figma. Component name = registry `name`.
2. **Detect drift:** AI agent reads `component-index.json` (or the colocated
   specs directly), pulls each linked node via Figma MCP (`get_metadata` /
   `get_variable_defs`), recomputes the structural node hash, compares to the
   spec's `lastSyncedHash`, and diffs Figma variant properties against `props[]`
   and Figma variables against `tokens[]`.
3. **Spec doc:** AI writes
   `frontend/src/design-system/changes/<date>-<component>.md`: what changed in
   Figma, which props/tokens/files are affected, and concrete edit instructions
   referencing `sourcePath`.
4. **Implement:** implementing agent applies the spec doc, updates the colocated
   `<Component>.spec.json` (props/tokens/`lastSyncedHash`), authors/updates the
   story, runs `pnpm ds:validate` until green (which regenerates the index).
5. **Verify:** `pnpm storybook` visual check + story tests via the Storybook MCP
   (or `pnpm test-storybook`).

---

## 11. Build order for the implementing agent

1. Confirm package manager + lockfile. Add deps (section 2). Bump vitest or defer
   `addon-vitest`.
2. `.storybook/main.ts`, `preview.ts`, `mocks/wailsjs/` (sections 3, 5).
3. `extract-tokens.mjs` → `design-tokens.json` → `Foundations/Tokens` story
   (section 4). Verify Storybook boots: `pnpm storybook`.
4. `build-registry.mjs` + `make:spec` scaffolder → generate
   `component-index.json` (all rows `todo`/`specMissing`).
5. `validate-registry.mjs` + wire `ds:validate` into CI (section 8).
6. Author tier by tier per `COMPONENT_CHECKLIST.md`: primitives first
   (Button, Icon, Card, Input fields, Switch, Checkbox, Select, Tooltip,
   Dialog, DropdownMenu, Tabs), then components, then views. For each: scaffold
   `<Component>.spec.json`, add story, fill `props`/`tokens`, advance `status`,
   add Figma URL when known, regenerate index.
7. Write `WORKFLOW.md` (section 10).
8. (Future) MCP sync server (section 9) — not in this pass.

---

## 12. Definition of done

- [ ] `pnpm storybook` boots; a melt-ui component renders correctly.
- [ ] `Foundations/Tokens` story shows all colors + type ramp from `design-tokens.json`.
- [ ] Colocated `<Component>.spec.json` files validate against `component-spec.schema.json`.
- [ ] `component-index.json` is generated (not hand-edited), validates against `component-index.schema.json`, covers every non-sub-part component.
- [ ] `pnpm ds:validate` runs in CI and fails on missing specs / bad tokens / incomplete figma links / stale index.
- [ ] `COMPONENT_CHECKLIST.md` is regenerated by validation and reflects real status.
- [ ] At least the primitive tier has specs + stories + Figma URLs + mapped props.
- [ ] `WORKFLOW.md` documents the Figma → AI → code loop.
- [ ] No component was rewritten to runes or had data-fetching added; Wails stays mocked.
- [ ] Code Connect is NOT used (custom .spec.json only).
