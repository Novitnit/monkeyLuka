# Discovery: death-question verdict text overlaps the next question

**Date:** 2025-09-25
**Scope:** `apps/web/src/game/quest/quest-box.ts`
**Status:** Fixed

## Symptom

When answering a death question (pit/trap kill), the "Wrong"/"Correct!"
verdict text renders on top of overlapping text. Two concrete failures,
observed in a headless browser against the running dev servers:

1. After a wrong answer's 3-second penalty, the box re-opens with a **fresh
   death question** (update.ts's self-heal re-request) — but the previous
   verdict ("Wrong", red) is **still visible** floating in the new panel.
2. Answering wrong repeatedly stacks a second "Wrong" at the exact same
   position, so the glyphs double-render/overlap each other (pixel count of
   the red feedback region jumped from 377 → 482 on the second wrong
   answer).

## Root cause

The verdict flash was parented to the wrong container. `createQuestBox`
builds a two-level hierarchy:

- an outer `container` (scrollFactor 0, depth 1000) that is only ever
  hidden/shown and **never cleared**, and
- a nested `windowGroup` inside it that `open()` rebuilds from scratch on
  every question (`windowGroup.removeAll(true)` → destroys panel, title,
  question, and answer rows).

`showResult()`'s death branch created the verdict text and added it to the
**outer `container`** (`container.add(feedback)`), not `windowGroup`. So the
next `open()` (new question after the penalty, or a later death after a
revive) destroyed the window but left the verdict orphaned: it survived into
the new question's panel, and each additional wrong answer added another text
at the identical `(centerX, panelTop + PANEL_HEIGHT - 40)` position → the
duplicates overlapped exactly.

The interaction-question verdict path was unaffected: it lowers the window
and closes immediately, never creating a flash.

## Fix

`apps/web/src/game/quest/quest-box.ts` — parent the verdict into
`windowGroup` instead:

```ts
// before
container.add(feedback);
// after
windowGroup.add(feedback);
```

Why this lever: `open()` already empties `windowGroup` on every question, so
the old verdict dies with the exact lifetime it should have (one penalty
window). The flash is added after the rows, so it still draws on top of them
while the penalty freezes the player. Adding it to the container would
require manual destroy bookkeeping in `close()`/`clearTimers()` for no
layout benefit — the container's only job is show/hide.

## Verification

Drove the real death-loop in a headless browser (forced `player:death` +
`state.dead`/`deathRequestAt` via a temporary `__jungleRoom` debug handle),
clicking answer rows across retries and screenshotting each phase:

- First question: no feedback. One wrong answer: a single 377px "Wrong" band
  at y 512–532 (below the last answer row at 478 — first-death feedback
  position was never the issue).
- Next question after the 3s penalty: **no** leftover feedback (previously
  the stale "Wrong" persisted).
- Second wrong answer: exactly one 377px "Wrong" — no duplicate stacking
  (previously 482px).
- `bun test` — 143 pass / 0 fail; `bun run typecheck` — clean across web,
  server, shared.

## Related

- `apps/web/src/game/quest/quest-box.ts` — `showResult()` death branch,
  `open()`, `close()`.
- `apps/web/src/game/scene/update.ts` — the death-question self-heal that
  re-requests a fresh question after a wrong answer.
- Debug handlers used for verification (`__jungleRoom`, `__jungleState`) were
  temporary local additions to `apps/web/src/game/scene/create.ts` and were
  reverted; only `quest-box.ts` changed.