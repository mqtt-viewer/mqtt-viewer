---
name: ds-add-component
description: Add a new component to the design-system library, or formalize an existing one — scaffold its colocated .spec.json, classify its tier, author a Storybook story, and link it to Figma. Use when the user says "add X to the library", "create a story for X", "formalize this component", "/ds-add-component", or when authoring through the COMPONENT_CHECKLIST.
---

# Add / Formalize a Library Component

Bring a component into the synced design system: spec + story + tier + (optional)
Figma link, ending validated.

Read first: `frontend/AGENTS.md` and `docs/design-system/STORYBOOK_SPEC.md`
(§4 tokens, §6 authoring rules, §7 spec shape, §7c tiers).

## Procedure
0. **Check for duplicates** via the Storybook MCP (`mcpland/storybook-mcp`; needs
   Storybook served/built) — list existing components before creating a new one.
   Reuse/extend if something close exists (anti-duplication rule).
1. **Locate / create** the component folder under `frontend/src/components/` (or
   `frontend/src/views/` for screens). One folder per component.
2. **Classify the tier** (this is the most important decision — it sets the
   sync contract). Apply the test: *could this drop into any unrelated app
   unchanged?*
   - yes, domain-agnostic, props-only → `primitive`
   - knows MQTT/connections/app concepts, composes primitives → `component`
   - a screen/frame → `view`
   When unsure, read the source: store reads / `wailsjs` / domain types ⇒ not a
   primitive. See spec §7c for why this matters.
3. **Scaffold the spec:** `pnpm make:spec <Name>` (or create `<Name>.spec.json`
   by hand against `frontend/src/design-system/component-spec.schema.json`; the
   `$schema` relative path depth depends on how deep the component folder sits).
   Fill:
   - `name` (PascalCase, = filename = Figma name), `tier`, `description`,
     `status: "story-only"` initially.
   - `props[]` from the component's real `$$Props` / `export let` — do **not**
     invent. Mark enums with `options` matching intended Figma variant values.
   - `tokens[]` — every Tailwind token the component consumes (must exist in
     `design-tokens.json`). Primitives may list raw tokens; components/views
     should mostly compose primitives instead (validator warns otherwise).
   - `dependencies[]` — other library components it renders. Respect direction:
     primitive depends on nothing; component → primitives; view → both.
4. **Author the story** `<Name>.stories.svelte` (Svelte CSF, `defineMeta`):
   - title = `<Tier>/<Name>`; `tags: ['autodocs']`.
   - one `<Story>` per meaningful state/variant; `argTypes` options match
     `spec.json` props.
   - data via props only — mock anything the component would otherwise fetch/read
     from a store or Wails. If that's not possible without refactor, note it in
     `spec.json.notes`.
   - `parameters.design = { type: 'figma', url: '' /* TODO(figma-url) */ }`.
5. **Link Figma (optional now):** if the Figma node exists, set `figma.fileKey`,
   `figma.nodeId`, `figma.url`, compute `lastSyncedHash` (via Figma MCP
   `get_metadata`/`get_variable_defs`), and advance `status` to `figma-linked`.
6. **Validate:** `pnpm ds:registry` then `pnpm ds:validate`. Green = done; the
   index + `COMPONENT_CHECKLIST.md` regenerate automatically.

## Rules
- Don't rewrite the component to runes; match surrounding Svelte 4 style.
- Don't hand-edit `component-index.json` / `COMPONENT_CHECKLIST.md` (generated).
- Get the tier right before anything else — it's the contract everything else
  (diff strategy, validation rules, Figma object type) hangs off.
- Skip sub-parts (`*Item`, `*Row`, `*Tab`); they're covered by the parent's story
  per the ignore heuristics in spec §7b.
