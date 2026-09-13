# Discovery: interaction tiles (315 → E → "showquest") — the feet probe, the staleness rule, and the geometry foot-gun

**Date:** 2026-09-13
**Scope:** `packages/shared/src/physics/interaction.ts` + `tiles.ts`/`validation.ts`,
`apps/server/src/rooms/jungle/{interactions,jungle-room,input}.ts`,
`apps/web/src/game/scene/{create,state,update}.ts`
**Status:** Fixed

## Symptom

Building the first interaction tile surfaced three non-obvious constraints
that all had to hold at once before "stand on tile 315 + press E → server
logs `showquest`" worked end-to-end:

1. A resting player's feet are **exactly on the tile boundary**, so a naive
   "feet cell" probe reads the *floor* cell, not the signpost perched above it.
2. The client's probe runs on its live prediction, but the server must not
   trust the wire `gid` — it re-probes its own (stale by ~1 RTT) *last
   accepted* position, so pressing E the instant you step onto the tile can be
   a silent no-op until the next accepted report lands on it.
3. The interaction gid must **never** enter `TileKind`/`buildTileGrid`, or
   the penetration fallthrough turns it into a slope wedge.

## Root cause

**1. Flush-boundary pose.** The map places 315 in the cell directly *above*
the floor the player stands on (tile (17,11); solid 57 floor at row 12). A
player at rest has its collider bottom exactly flush with the floor's top —
a cell boundary — so the feet point lands in the *floor* cell, which has no
interaction gid. This is the same class of bug as the dead-zone flush pose
(`discoveries/dead-zone-touch-log-never-fired-flush-pose.md`): the exact
resting pose is the common pose, and the probe must tolerate it.

**2. Server must not trust the wire.** The client sends the gid it found;
the room re-probes `player.lastValid` (the last *accepted* report — the only
state the server trusts, same position it broadcasts) with the identical
shared rule and requires the gids to match *and* `grounded` to be true. The
accepted position lags the client's prediction by ~1 RTT, so a press made in
the same frame the player steps onto the tile is a harmless no-op — the flow
works because the player stands *on* the tile (reports keep landing there at
20 Hz) before pressing E, not mid-step-on.

**3. The kind-fallthrough foot-gun.** `buildTileGrid` folds unknown gids to
0, and the penetration code dispatches on `TileKind` treating every non-57
kind as a slope. If 315 were ever added to `TileKind`, the fallthrough
branches would treat it as a 262-shaped wedge (the same trap documented for a
distinct 65 kind in `tiles.ts`).

## Fix

- `interaction.ts` (new): `INTERACTION_TILE_ACTIONS` (315 → `"showquest"`),
  `InteractionGrid` + `buildInteractionGrid` (which keeps *only* registered
  interaction gids — the collision grid's `buildTileGrid` is untouched and
  folds 315 to 0), and `interactionTileUnderFeet` — probed with an
  `INTERACTION_FEET_SLACK` of 2px: it reads the feet cell, then the cell above
  when the feet sit at/within a cell boundary (the signpost case).
- `validation.ts`: `PLAYER_INTERACTION_MESSAGE` + `PlayerInteractionMessage`
  (one advisory `gid`). Room side (`jungle-room.ts` `onPlayerInteraction` +
  `input.ts` `sanitizePlayerInteraction`): strict shape check (gid must be a
  *registered* interaction gid), then grounds in `lastValid` and re-probes it
  before `runInteraction` (`interactions.ts`, gid → handler map) executes —
  `showquest` logs `[jungle:interaction] <name> (<sessionId>) showquest`.
- Web (`create.ts`/`state.ts`/`update.ts`): `keyE` + the interaction grid
  built beside the collision grid; on edge-triggered E while `grounded`, the
  client probes its local prediction and sends the message.

## Verification

- `bun test` — 6 new interaction tests (registry, grid filtering, gid
  isolation from the collision grid, flush-boundary probe, tile-as-floor
  probe, real-map probe) — 72 pass / 0 fail.
- `bun run typecheck` — clean (web, server, shared).
- Live e2e against a real Colyseus server: a client walking from spawn to
  the 315 signpost floor (paced reports within the teleport/speed limits)
  then pressing E produced exactly one
  `[jungle:interaction] E2E (<sessionId>) showquest` line, while the
  interaction sent *before* any accepted standing report was a silent no-op.

## Related

- `discoveries/dead-zone-touch-log-never-fired-flush-pose.md` — the same
  flush-resting-pose class of probe bug, fixed with a 1px support allowance.
- `packages/shared/src/physics/tiles.ts` — why a distinct 65 kind would
  become a slope wedge; the same reason 315 must stay out of `TileKind`.