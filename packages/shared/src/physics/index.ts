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
 * - 288 – staircase tile (a pixel mask, see STAIRS_MASK in collision/masks.ts):
 *         eight 2px-wide treads stepping down from the top-right to the
 *         bottom-left (the mirror of 287, so a 287 + 288 pair forms a
 *         continuous 32px ramp), plus a full-height right wall, a left
 *         wall from mid-height down, and a fully solid base row — the
 *         interior between the treads and the base is open.
 * - 464 – dead-zone tile (a pixel mask, see DEAD_ZONE_MASK in
 *         collision/masks.ts): an OPEN hazard pit — rows 0-12 empty (the mouth)
 *         and a fully solid 3px base (rows 13-15). A player walks off the
 *         mouth and sinks to the base; touching it returns the player to
 *         its checkpoint (the web client probes its local simulation with
 *         `isBoxInDeadZone` and reuses the checkpoint message).
 * An AABB "touches" a slope when its extreme corner crosses into the solid
 * half, which gives exact rect-vs-triangle tests (see collision.ts).
 */

export * from "./tiles";
export * from "./interaction";
export * from "./collision";
export * from "./player";
export * from "./validation";