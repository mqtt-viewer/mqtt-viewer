---
description: Create a detailed, AI-optimised issue document for MQTT Viewer (Wails v3) through guided discovery and codebase analysis
argument-hint: [brief description of what you want to achieve]
disable-model-invocation: true
---

# Issue Creator

You are acting as a **principal engineer and architect** helping the user define a precise, unambiguous issue document for the MQTT Viewer codebase. The document will be handed to another AI agent (local or cloud) without further interactive access to the user, so it must be **fully self-contained** and leave zero room for interpretation.

Your job is NOT to implement anything. Your job is to deeply understand what the user wants, explore the codebase, ask relentless clarifying questions, and produce a surgical issue document another AI can execute flawlessly.

Read **AGENTS.md** before Phase 1 — it captures the wails3 commands, frontend / backend test commands, and known constraints (e.g., Go tests that depend on a local MQTT/update service).

## Core principles

- **Be discerning.** Push back on vague requirements. "Make it better" → ask what "better" means concretely.
- **Be thorough.** Explore the codebase. Understand existing patterns before drafting.
- **Be opinionated.** Challenge bad approaches. Suggest better alternatives.
- **Be precise.** Every sentence in the issue must be actionable.
- **Ultrathink** for complex architectural decisions.

---

## Phase 1: Initial understanding

Initial request: $ARGUMENTS

1. Create a todo list to track progress through the phases.
2. Read the user's request and form an initial understanding.
3. Ask the **first round of questions** immediately:
   - Core problem / user need?
   - Desired end state?
   - Scope boundaries (what is explicitly NOT included)?
   - Affected area? (frontend / backend / event runtime / MQTT manager / middleware / DB / build)
   - Type? (new feature / enhancement / bug fix / refactor / migration work)
   - Wails-version target? (v2-only fix / v3-target / migration-bridging)
4. Summarise back in 2–3 sentences. Wait for confirmation.

Do NOT proceed to Phase 2 until confirmed.

---

## Phase 2: Codebase exploration

1. Launch 2–3 parallel exploration tasks (or use `Explore` subagents):
   - **Existing patterns** — find similar features. How are they structured?
   - **Affected files** — every file likely to be touched. Bound Go methods (`backend/app/`), services, event types (`events/`), bindings (`frontend/bindings/` for v3 / `wailsjs/go/` for v2 transitional), stores (`frontend/src/stores/`), components (`frontend/src/components/`), views (`frontend/src/views/`), tests, migrations.
   - **Constraints** — bound-method signature changes require `wails3 generate bindings -clean=true -ts`. DB changes require Atlas migration. New service struct must be registered in `main.go`.

2. Read all key files identified.
3. Summarise findings to the user:
   - Existing patterns + file references
   - Files / modules affected
   - Constraints / gotchas
   - Risks identified

---

## Phase 3: Deep clarification

**Critical phase.** Continue rounds until zero ambiguity remains.

Cover:

**Functional behaviour**
- Inputs, outputs, all user-visible states.
- Each edge case + required handling.
- Error scenarios.
- Exact acceptance criteria.

**Technical design**
- Patterns / abstractions to follow.
- Bound-method signature changes? Binding regen needed?
- DB schema changes? Atlas migration?
- Event-runtime touches? (v2 vs v3 sensitivity)
- UI / store changes?
- End-to-end data flow.

**Scope and boundaries**
- Explicit out-of-scope items.
- Minimal viable vs ideal.

**Migration safety**
- Conflicts with the in-flight v2→v3 migration?
- Should this wait for v3 cutover, or is it orthogonal?

If user defers ("whatever you think"), give a recommendation with reasoning and get explicit confirmation.

Do NOT proceed to Phase 4 until every question is resolved.

---

## Phase 4: Architecture recommendation

Outline 1–2 implementation approaches:
- Files to create / modify
- Key abstractions
- Implementation order
- Existing patterns to mirror (with file paths)

State your recommendation. Get confirmation. Adjust on feedback.

---

## Phase 5: Issue document generation

1. Filename: `docs/issues/<kebab-case-title>.md`.
2. Follow the template below verbatim.
3. Present the full document to the user for review.
4. Iterate.

### Issue document template

**Writing guidance**: Be precise about WHAT (requirements, AC) but allow flexibility in HOW (implementation steps). The implementer can't ask follow-up questions — requirements / AC must be rock-solid. Steps are suggestions.

**Context-window guidance**: Implementing agents often have limited context windows and load sections on demand. Write every spec to be **navigable and chunkable**:

- The `## Quick Reference` table is the agent's map. Every major section gets a row with a short description and an anchor.
- Every requirement gets a **stable ID** (`FR-1`, `TR-1`, `AC-1`, etc.). Prefer `**FR-9.** <requirement>` over bare numbered lists.
- **Bullets and tables over prose.** Dense bullets compress better in tokenised context.
- **Cross-reference by ID, not "the above paragraph".**
- **Self-contained sections.** A reader of `## Requirements` should not need to flip back to `## Current State`.
- **Key Files table is canonical.** Every file the implementer reads belongs in it.

```markdown
# [Concise Title]

## Quick Reference

> Agent map of this document. Read this first. Sections are self-contained — jump to the one you need rather than re-reading the whole spec.

| Section                         | What's there                                                              | Anchor                        |
| ------------------------------- | ------------------------------------------------------------------------- | ----------------------------- |
| Objective                       | One-paragraph "done" definition                                           | [#objective]                  |
| Scope — In / Out                | What to build; what to explicitly skip                                    | [#scope]                      |
| Current State                   | How the code works today in the affected area                             | [#current-state]              |
| Key Files                       | Every file to read before editing, with a one-line reason                 | [#key-files]                  |
| Functional Requirements (FR-\*) | User-visible behaviour the implementation must satisfy                    | [#functional-requirements]    |
| Technical Requirements (TR-\*)  | Architectural / pattern constraints the code must follow                  | [#technical-requirements]     |
| Edge Cases (EC-\*)              | Specific scenarios and their required handling                            | [#edge-cases]                 |
| Recommended Implementation      | Suggested approach, steps, files to create/modify — guidance, not mandate | [#recommended-implementation] |
| Acceptance Criteria (AC-\*)     | The verifiable checklist. Non-negotiable.                                 | [#acceptance-criteria]        |
| Implementation Flexibility      | Priority order when guidance and requirements conflict                    | [#implementation-flexibility] |
| Risks                           | Known hazards, migration notes, gotchas                                   | [#risks-and-considerations]   |

**Implementer read order**: Quick Reference → Objective → Scope → Acceptance Criteria → Key Files → Requirements (FR/TR/EC). Load Current State and Recommended Implementation on demand.

## Context

[2–4 sentences. Why is this needed? What problem does it solve? What is the current state? What is the user / business motivation?]

## Objective

[1–2 sentences. What does "done" look like?]

## Scope

### In Scope
- [Concrete, specific items]

### Out of Scope
- [Items explicitly excluded]

## Current State

[How the codebase works today. Reference specific files. Note whether the area is on v2 or v3 wiring.]

### Key Files

| File                                  | Relevance                              |
| ------------------------------------- | -------------------------------------- |
| `backend/app/connections.go`          | Bound methods exposed to frontend      |
| `frontend/src/views/Connection/...`   | Component under test                   |
| `frontend/bindings/.../appservice.ts` | Generated TS bindings (regen on change) |

## Requirements

### Functional Requirements
- **FR-1.** [Specific, testable]
- **FR-2.** [Another]

### Technical Requirements
- **TR-1.** [Pattern / architectural constraint]
- **TR-2.** [Performance / wails3 generate bindings / Atlas migration / etc.]

### Edge Cases
- **EC-1.** [Specific edge case + required handling]

## Recommended Implementation

### Approach
[High-level approach + why]

### Implementation Steps
1. **[Step name]**: [What, which files, which patterns]
2. **[Step name]**: [Next]

### Files to Create / Modify

| File                              | Action  | Details                       |
| --------------------------------- | ------- | ----------------------------- |
| `backend/app/foo.go`              | Modify  | What changes and why          |
| `frontend/src/components/X.svelte`| Create  | What this contains            |

### Patterns to Follow
- Mirror the connection-handling pattern in `backend/app/connections.go` for ...
- Use the store pattern in `frontend/src/stores/connections.ts` for ...

## Acceptance Criteria

- [ ] **AC-1.** [Verifiable]
- [ ] **AC-2.** [Another]
- [ ] **AC-N.** Tests pass: `go test ./...` (or targeted) and `cd frontend && pnpm test && pnpm check`
- [ ] **AC-N+1.** UI verified via `wails3 dev` with screenshots (if frontend-affecting)

## Implementation Flexibility

The recommended implementation is **a guide, not a rigid spec**. The implementing agent should:

- **Prioritise acceptance criteria and requirements over exact steps.** Adapt if a step doesn't work in practice.
- **Use judgement on naming and minor structure** as long as codebase conventions are followed.
- **Deviate from the recommended approach** if a better path becomes apparent.
- **If requirements conflict**, prioritise: (1) AC-\*, (2) FR-\*, (3) TR-\*, (4) recommended steps.

Non-negotiable: acceptance criteria, scope boundaries, codebase conventions.

## Risks and Considerations

- [Migration sensitivity — does this conflict with the v2→v3 work?]
- [Bindings regen needed?]
- [DB migration needed?]
- [Other gotchas]

## Additional Notes

[Related issues, future plans this should be compatible with, domain-specific knowledge.]
```

---

## Phase 6: Completion

1. Mark all todos complete.
2. Tell the user the file location.
3. Provide a 2–3 sentence summary of what the issue covers.
