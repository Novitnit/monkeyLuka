# Discovery: door-link gate silently orphaned by a room-object name typo — no debug line, and the quest gate opened the door vacuously

**Date:** 2026-09-13
**Scope:** `Assets/map/main.json` (Tiled `room` objectgroup) + `@monkeyluka/shared` door-link grouping + server `QuestGate`
**Status:** Fixed

## Symptom

With `NEXT_PUBLIC_DOOR_DEBUG` on, `door-debug.ts` logged group counts but
drew **no cyan line** between the signpost and the door, even though the map
had two room objects that were supposed to be linked. The server-side loader
test then failed: `roomObjects.map((o) => o.name)` returned
`["roo1", "room1"]` instead of a shared name, and `groupRoomObjectsByName`
produced two separate groups — one with a showquest and no door, one with a
door and no showquest. Meanwhile the quest-gate test over the real map
*passed*, which made it look like the linkage worked.

## Root cause

1. The real map's `room` objectgroup had been split from the original single
   `room1` bounds rect (0,0,496×272) into **two** rectangles — one over the
   signpost (256,160,64×32), one over the door (464,128,32×32) — clearly
   intended to share the name `room1` so same-name collation forms one gate
   (the exact pattern `physics.test.ts` covers as "same-name rectangles
   collate"). The first rectangle's name was typed `"roo1"` (missing the
   `m`) — an exact-match grouping key, so the typo is a **silent no-op**,
   not an error: nothing validates that the objects meant to be linked
   actually share a name.

2. `groupRoomObjectsByName` (shared, exact-name keys) therefore emitted:
   - `roo1` group → 1 showquest, 0 doors
   - `room1` group → 0 showquests, 1 door
   No group holds both kinds, so `createDoorDebug`'s (showquest, door) pair
   loops draw nothing — hence no debug line.

3. The quest-gate test passed anyway because `QuestGate.markCompleted` used
   `group.showquest.every(...)` and `every` over an **empty** array is
   vacuously `true`: the door-only `room1` group "completed" as soon as
   *any* interaction tile was answered correctly (the stranded signpost in
   the `roo1` group sufficed). The door "worked" for the wrong reason — a
   latent bug that would have opened an ungated door on the first unrelated
   correct answer in any future map with a solo-name door rect.

## Fix

1. `Assets/map/main.json`: renamed the object `"roo1"` → `"room1"` (the
   canonical gate name already used by the second rect, the tests, and the
   docs). Now both rectangles collate into one `room1` group with
   1 showquest (17,11) × 1 door (29,8), and the debug overlay draws the
   signpost→door line (clipped into room 0).
2. `apps/server/src/rooms/jungle/quest-gate.ts`: `markCompleted` now skips
   groups with `showquest.length === 0` — a door with nothing gating it
   must never open, instead of opening on the first unrelated correct
   answer. Added a regression test for the orphaned-door case.
3. Updated the stale descriptions of the map layout in the loader test,
   `door-links.ts`, `door-debug.ts`, `scene/create.ts`, root `AGENTS.md`,
   and `apps/web/AGENTS.md` (they all still claimed "one `room1` bounds
   rect").

Lessons: the room-object name is link identity — there is no
"fuzzy-match" — so a near-miss name (typo, case, trailing space) silently
orphans the gate; and a group with zero showquests is a *disable*, not a
vacuous pass.

## Verification

- `bun test apps/server/src/game/jungle-map.test.ts` — all pass; the
  real-map test now asserts `["room1", "room1"]` names, 2 objects, 1
  showquest × 1 door in the single `room1` group.
- `bun test apps/server/src/rooms/jungle/quest-gate.test.ts` — all pass,
  including the new orphaned-door regression test; the real-map quest-gate
  test now passes for the right reason (the group genuinely links the
  signpost to the door).
- `bun test packages/shared/src/physics.test.ts` — the door-link group
  tests (including "same-name rectangles collate into one gate") still pass.
- With `NEXT_PUBLIC_DOOR_DEBUG=1` the overlay logs
  `"room1": 1 showquest × 1 doors` and draws the cyan/purple line from the
  signpost (280,184) to the door (480,144).

## Map layout update (2026): back to the single bounds rect

Later a Tiled edit merged the two rectangles back into the original
whole-map `room1` bounds rect (0,0,496×272) — this time keeping the
corrected name — and hid the `room` layer. The gate still links signpost
(17,11) → door (29,8) with the same counts (a loader test asserts the new
single-object layout), so no code change was needed; the stale "two
rectangles" descriptions in `door-links.ts`, `door-debug.ts`,
`scene/create.ts`, the loader test, and root `AGENTS.md` were updated to
match.