# Discovery: player stayed "grounded" after walking off a ledge

**Date:** 2026-02-13
**Scope:** `packages/shared` (`stepPlayer`)
**Status:** Fixed

## Symptom

A unit test that walked the collider off the end of a platform observed
`state.grounded === true` several frames into free fall. Consequences for the
game: jumps could fire well after leaving a ledge (coyote time never
decremented), and `grounded` broadcast to clients lied about the server's
actual state.

## Root cause

`stepPlayer` only ever *set* `state.grounded = true` when the vertical
collision pass resolved a downward penetration (`dir > 0 && pen > 0`). Nothing
ever set it back to `false` when the player moved off an edge: the flag
persisted from the last grounded step until a ceiling hit or a jump. The
vertical pass simply found no collision and returned, leaving the stale flag.

## Fix

Re-derive ground state from the vertical pass every step: clear the flag right
before integrating the vertical axis, and set it only on an actual landing
(or the world-floor clamp). `result.grounded` is then assigned from the
post-step state (`packages/shared/src/physics.ts`):

```ts
// Ground is re-derived from the vertical pass every step: a player who
// walks off a ledge must stop being grounded immediately.
state.grounded = false;
...
if (dir > 0) { state.grounded = true; result.landed = true; }
...
result.grounded = state.grounded;
```

Gravity guarantees a small downward move every step, so a player standing
still re-lands every step and stays grounded — the flag is stable on floors
and clears the instant support disappears.

## Verification

`packages/shared/src/physics.test.ts`, "coyote time lets a jump fire just
after walking off a ledge" asserts `state.grounded === false` after walking
off the ledge, then that a jump fired within the coyote window still works.
The full suite (`bun test`, 32 tests) passes.

## Related

- `packages/shared/src/physics.ts` — `stepPlayer`.
- `packages/shared/AGENTS.md` — physics contract.
