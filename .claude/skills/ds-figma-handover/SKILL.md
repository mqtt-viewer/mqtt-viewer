---
name: ds-figma-handover
description: Diff the Figma component library against the MQTT Viewer frontend and produce a handover doc listing exactly what code needs to change. Use when the user says "check Figma for changes", "what drifted", "generate a handover", "sync from Figma", or after a design update. This skill DETECTS and DOCUMENTS only — it does not edit component code (that's /ds-implement-handover).
---

# Figma → Code Handover (drift detection)

You are the **drift agent**. Your job: compare the Figma design library to the
code, and write a precise handover doc for the implementing agent. **You do not
modify component source.** Output is one markdown doc.

Read first: `docs/design-system/STORYBOOK_SPEC.md` (esp. §7c tier sync semantics,
§10 workflow) and `frontend/AGENTS.md`.

## Inputs
- `frontend/src/design-system/component-index.json` — run `pnpm ds:registry`
  first to ensure it's current. Source of truth is the colocated `.spec.json`s.
- Figma, via MCP tools: `get_metadata`, `get_variable_defs`, `get_screenshot`,
  `get_design_context`. Resolve nodes from each component's `figma.nodeId`/`url`.
- `frontend/src/design-system/design-tokens.json` for token names.
- **Storybook MCP** (optional, framework-agnostic `mcpland/storybook-mcp`): pull
  the current rendered screenshot/props of a component to compare against Figma —
  most useful for `view` drift. Needs Storybook served/built first
  (`pnpm storybook` or `pnpm build-storybook`).

## Procedure
1. **Refresh the index:** `pnpm ds:registry`. Note any `specMissing` / `todo`
   components — list them as "unlinked, needs authoring", don't try to diff them.
2. **For each `figma-linked` component**, pull its Figma node and diff by tier
   (see spec §7c — tier dictates the diff):
   - **primitive:** compare Figma variant properties ↔ `props[].options`;
     Figma bound variables ↔ `tokens[]`. This is the high-confidence diff.
   - **component:** compare child instances ↔ `dependencies[]`; flag added/
     removed/swapped children. Don't over-claim prop drift.
   - **view:** screenshot compare only; describe layout/content deltas in prose.
   Recompute the structural hash and compare to `figma.lastSyncedHash`. Unchanged
   hash → skip (no drift).
3. **Tokens:** diff Figma variables against `design-tokens.json`. Report
   renamed/added/removed tokens separately — they have blast radius across many
   components.
4. **Flag tier problems:** if a Figma node has variants but the spec says
   `view`, or vice-versa, call it out — tier must be fixed first.
5. **Compute blast radius:** for each changed primitive, list every component/
   view that has it in `dependencies[]` (read from the index). Order the handover
   bottom-up: tokens → primitives → components → views.

## Output
Write `frontend/src/design-system/changes/<YYYY-MM-DD>-<slug>.md` with:

```md
# Handover: <slug> — <date>

## Summary
<one paragraph: what changed in Figma, scope, risk>

## Token changes
| token | change | affected components |
|---|---|---|

## Component changes (bottom-up)
### <Name> (<tier>)  — status: <current>
- Figma node: <url>
- Drift: <variant `danger` added | child Icon swapped | frame relayout ...>
- Files to edit: `frontend/src/.../X.svelte`, `X.spec.json`, `X.stories.svelte`
- Concrete instructions: <exact prop/option/token edits>
- New `lastSyncedHash`: <hash>  (implement agent writes this on completion)

## Unlinked / needs authoring
- <components with no figma link or no spec>

## Out of scope / human decision needed
- <ambiguous composition or data-wiring changes the agent shouldn't guess>
```

## Rules
- **Never edit `.svelte`, `.spec.json`, or stories.** Detection only.
- Be concrete: name files, props, option values, token keys. The next agent
  should not have to re-inspect Figma.
- Don't invent drift. No hash change → no entry. Uncertain → "human decision".
- Keep the bottom-up ordering; it's how the implement agent sequences work.
