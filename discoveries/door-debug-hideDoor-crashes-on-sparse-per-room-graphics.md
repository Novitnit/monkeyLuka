# Discovery: hideDoor crashes reading `.setVisible` of undefined (sparse per-room door graphics)

**Date:** 2026-09-13
**Scope:** @monkeyluka/web — `apps/web/src/game/collision/collision-debug.ts`
**Status:** Fixed

## Symptom

With `NEXT_PUBLIC_DOOR_DEBUG` on and a door opening (answer its showquest),
the first open door crashes the frame loop:

```
collision-debug.ts:253 Uncaught TypeError: Cannot read properties of undefined (reading 'setVisible')
    at Object.hideDoor (collision-debug.ts:253:17)
    at syncOpenDoors (door-open.ts:46:20)
```

The door's synced state did flip to `open` and `clearDoorFromGrid` ran — the
crash was purely in the debug overlay, but it wedged the whole scene update
every frame afterward.

## Root cause

`CollisionDebug` draws each door's 2×2 purple perimeter on its **own**
graphics object **per room it crosses**, stored in a plain array indexed by
room index:

```ts
const overlays = doorGraphics.get(key) ?? [];
let doorOverlay = overlays[index];        // undefined when this room isn't used yet
if (!doorOverlay) {
  doorOverlay = scene.add.graphics();
  overlays[index] = doorOverlay;          // ← sparse array: holes for unused rooms
  ...
}
```

A 2×2 door (32×32 px) is always smaller than a room, so its perimeter is
clipped into exactly **one** room. When that room is index 1 or 2 (the debug
log's `room2` / `room3`), the array has `undefined` holes at the earlier
indices. `for...of` over an array **yields `undefined` for holes**, so:

```ts
for (const overlay of doorGraphics.get(key) ?? []) overlay.setVisible(false);
```

called `.setVisible` on `undefined`. The same hole-bug lurked in
`setEnabled` (the debug toggle) and `destroy()`, which iterate the same
sparse arrays — those just hadn't fired yet because `hideDoor` crashed first.

## Fix

Guard the loop bodies against holes — optional chaining / `if (overlay)`
— in all three places that iterate a door's per-room overlay array
(`hideDoor`, `setEnabled`, `destroy`) in `collision-debug.ts`. The map is
still keyed by `doorKey(tx, ty)` and holes are simply skipped: hiding,
toggling, or destroying only touches the graphics that actually exist.

## Verification

`bunx tsc --noEmit` in `apps/web` passes. Playing with
`NEXT_PUBLIC_DOOR_DEBUG=1`, answering room1's showquest, opens room1's door
without a crash; the purple perimeter disappears only for the open door.