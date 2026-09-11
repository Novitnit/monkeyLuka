# AGENTS.md — discoveries/

Instructions for writing files in `discoveries/`. Read the root `AGENTS.md`
first; this file covers only the discovery notes kept here.

## What this directory is

A durable log of **non-obvious bugs, their root causes, and how they were
fixed** — the "why" that's too detailed for a workspace `AGENTS.md` but too
valuable to bury in a commit message. These notes exist so the next person (or
agent) doesn't re-tread the same dead ends.

Write a discovery when:

- A bug took real debugging to understand (not a typo or obvious one-liner).
- The root cause is surprising: framework internals, version-specific quirks,
  interacting layers, or a fix that must not be "cleaned up" later.
- You hit a dead end worth warning others about.
- The fix depends on non-obvious context that isn't visible from the diff.

Do **not** write one for routine changes — commit messages cover those.

## One file per discovery

- One discovery = one file. Never append a different bug to an existing note,
  and never create a shared "misc" file.
- File name: a short kebab-case slug naming the symptom, ending in `.md` —
  e.g. `playground-assets-stall-better-call-res-end.md`.
- Keep the directory flat (no subdirectories).

## File format

Start from this template:

```md
# Discovery: <one-line symptom or finding>

**Date:** YYYY-MM-DD
**Scope:** <workspace / package / subsystem affected>
**Status:** <Fixed | Worked around | Open | Investigated only>

## Symptom

What was observed and how it presented. Include the exact command/URL/error
where useful, and note what *did* work to bound the problem.

## Root cause

The actual mechanism. Cite files, functions, and versions. Use numbered layers
when several things stack up, and small code snippets where they clarify.

## Fix

The change that resolved it, with the file path and a before/after snippet.
State why this lever and not another.

## Verification

The commands/checks that confirmed the fix (and that nothing else regressed).
Paste the observed output.

## Related

Links to the workspace `AGENTS.md` section (if the fix changed documented
behavior), source files, and dependency internals.
```

Optional sections:

- **Dead end I hit first** — approaches that seemed right but failed, and why.
  Include the failure mode so nobody repeats them.
- **Follow-ups** — remaining issues or things to revisit.

## Conventions

- **Update the relevant `AGENTS.md`** when a fix changes documented behavior or
  establishes a rule, then link to it from the note. The note is history; the
  `AGENTS.md` is the current contract.
- Keep the note **self-contained**: name workspaces and paths in full so it
  reads without the surrounding repo context.
- Mark uncertain claims as uncertain; don't present a guess as a root cause.
- Prefer concrete evidence (stack traces, status codes, source line refs) over
  narrative.
- Dates use `YYYY-MM-DD`.
