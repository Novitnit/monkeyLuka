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
 * - `tiles.ts`      – tile constants, layer → `SolidGrid`, world bounds
 * - `collision.ts`  – point/AABB collision tests + penetration helpers
 * - `player.ts`     – `stepPlayer` simulation, config, spawn, speed ceiling
 * - `validation.ts` – `player:input` wire contract + `validatePositionReport`
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
 * An AABB "touches" a slope when its extreme corner crosses into the solid
 * half, which gives exact rect-vs-triangle tests (see collision.ts).
 */

export * from "./tiles";
export * from "./collision";
export * from "./player";
export * from "./validation";