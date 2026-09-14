/**
 * Engine-free collision and player physics. The Phaser client runs it for
 * local prediction + rendering (collision is client-side); the Colyseus
 * server imports the same module for its movement-report validation. No
 * Phaser, no DOM, no Colyseus — plain math over a tile grid, so the geometry
 * both sides reason about is byte-identical.
 *
 * Barrel entry point: the physics code is split into focused modules that
 * are re-exported here so existing consumers (`@monkeyluka/shared`,
 * `./physics`) keep working unchanged:
 * - `tiles.ts`        – tile constants, layer → `SolidGrid`, world bounds
 * - `interaction.ts`  – interaction tiles: the gid → action registry
 *                       (`INTERACTION_TILE_ACTIONS`), the `InteractionGrid`
 *                       + `buildInteractionGrid`, and the
 *                       `interactionTileUnderFeet` feet probe (E key)
 * - `door.ts`        – door entities: the 2×2 door blocks (gids
 *                       375/376/401/402) recognized as single open/closed
 *                       door world objects (`buildDoorEntities`); a closed
 *                       door is a solid, NON-sticky block — the grid folds
 *                       their gids into the TILE_DOOR kind, which blocks
 *                       walking but can't be grabbed (no wall cling)
 * - `door-links.ts`  – door-link groups: the room objectgroup's named
 *                       objects grouped by name and classified against the
 *                       tile entities (showquest interaction vs door) so a
 *                       signpost knows which doors it gates
 * - `trap-spike-run.ts` – movable traps: the `trap` objectgroup's
 *                       `Trap_Spike_Run` objects (patrol rect +
 *                       speedMin/speedMax/time2change_speed props) become
 *                       `TrapSpikeRunEntity`s; `stepTrapSpikeRun` sweeps
 *                       the marker back and forth inside the rect,
 *                       re-rolling a random speed every
 *                       `time2change_speed` seconds, and
 *                       `isBoxTouchingTrapSpikeRun` is the lethal contact
 *                       probe the web client runs against the player's box

 * - `collision/`      – point/AABB collision tests + penetration helpers +
 *                       the `wallBeside` wall-adjacency probe, split into
 *                       `masks.ts` (pixel masks), `geometry.ts`, `point.ts`,
 *                       `box.ts`, `support.ts`, `penetration.ts`
 * - `player/`         – `stepPlayer` simulation (coyote/buffered jump + wall
 *                       cling), split into `config.ts`, `state.ts`, `step.ts`
 * - `validation.ts`   – `player:input` wire contract + `validatePositionReport`
 *
 * Coordinate space is map pixel space, origin top-left, y growing down,
 * matching the tile grid: tile (tx, ty) occupies `[tx*tw, (tx+1)*tw) ×
 * [ty*th, (ty+1)*th)`. The player collider is an axis-aligned box defined by
 * its center (x, y) and its width/height from the physics config.
 *
 * Solid tiles (gids in the Tiled map's collision layer):
 * - 57  – fully solid block.
 * - 110 – diagonal tile, solid on its top-left half (line TL → BR). A point
 *         inside the tile with local coords (dx, dy) is solid when dy ≤ dx.
 * - 109 – diagonal tile, solid on its top-right half (line TR → BL); a point
 *         is solid when dx + dy ≤ 16 (the half above the descending line).
 * - 262 – diagonal tile, solid on its bottom-right half (the mirror of 109,
 *         same TR → BL line); a point is solid when dx + dy ≥ 16.
 * - 287 – shallow diagonal tile, the 2:1 ramp (16px run, 8px rise): solid
 *         below the line from the bottom-left corner (0, 16) to the right
 *         edge's midpoint (16, 8) — the ramp sits flush on the tile's
 *         bottom edge, with a solid back column under the apex;
 *         a point is solid when dx + 2·dy ≥ 32.
 * - 290 – shallow diagonal tile, the mirror of 287 flipped left-right: solid
 *         below the line from the bottom-right corner (16, 16) to the left
 *         edge's midpoint (0, 8) — a point is solid when 2·dy − dx ≥ 16.
 *         Same flush foot (from the right side), left back column under
 *         the apex, flat underside; climbed by walking LEFT.
 * - 288 – staircase tile (a pixel mask, see STAIRS_MASK in collision/masks.ts):
 *         eight 2px-wide treads stepping down from the top-right to the
 *         bottom-left (the mirror of 287, so a 287 + 288 pair forms a
 *         continuous 32px ramp), plus a full-height right wall, a left
 *         wall from mid-height down, and a fully solid base row — the
 *         interior between the treads and the base is open.
 * - 289 – staircase tile, the mirror of 288 flipped left-right (a pixel
 *         mask, see STAIRS_MIRROR_MASK in collision/masks.ts): eight 2px-wide
 *         treads stepping down from the top-LEFT to the bottom-right
 *         (288's staircase read right-to-left, so a 289 placed left of a
 *         290 continues that shallow mirror ramp down), plus a full-height
 *         LEFT wall, a right wall from mid-height down, and a fully solid
 *         base row — the interior between the treads and the base is open.
 * - 464 – dead-zone tile (a pixel mask, see DEAD_ZONE_MASK in
 *         collision/masks.ts): an OPEN hazard pit — rows 0-12 empty (the mouth)
 *         and a fully solid 3px base (rows 13-15). A player walks off the
 *         mouth and sinks to the base; touching it returns the player to
 *         its checkpoint (the web client probes its local simulation with
 *         `isBoxInDeadZone` and reuses the checkpoint message).
 * - 375/376/401/402 – door tiles (a closed door): `buildTileGrid` folds
 *         the four gids into the single TILE_DOOR kind — a full solid
 *         block, so the player cannot walk through a closed door, but
 *         NON-sticky: the wall-cling grab skips TILE_DOOR faces, so
 *         jumping into one slides off instead of hanging (every door
 *         starts closed; the entity model lives in door.ts).
 * An AABB "touches" a slope when its extreme corner crosses into the solid
 * half, which gives exact rect-vs-triangle tests (see collision.ts).
 */

export * from "./tiles";
export * from "./interaction";
export * from "./door";
export * from "./door-links";
export * from "./trap-spike-run";
export * from "./collision";
export * from "./player";
export * from "./validation";