# Agent guide

Start with `CLAUDE.md` in this directory: repo map, commands, conventions,
performance bar, release process, and the skills index. For frontend and
design-system work, `frontend/AGENTS.md` is the binding contract.

## Delegate implementation work

When the session is running on a high-capability model (Fable, Opus) and the
task contains a well-scoped, delegatable chunk (writing or editing code,
running builds, mechanical refactors), do not implement it inline. Plan the
change yourself, hand the implementation to a subagent with a precise brief
(files, exact edits or behaviour, constraints), then test and review the
result yourself. This keeps the expensive model's context for design,
verification, and judgement rather than token-heavy file editing.
