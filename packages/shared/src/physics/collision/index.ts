/**
 * Collision queries barrel: re-exports the public collision API used by
 * `stepPlayer`, the anti-cheat, and the web client. The code lives split
 * into focused modules:
 * - `masks.ts`       – pixel masks for the mask-shaped kinds (288 stairs /
 *                      464 dead zone) + the shared mask math
 * - `geometry.ts`    – box-vs-cell overlap rect, the cell-walk iterator,
 *                      slope tolerance constants
 * - `point.ts`       – the exact point test (`isPointSolid`)
 * - `box.ts`         – exact AABB-vs-tile tests (`isBoxSolid`,
 *                      `isBoxInDeadZone`, `wallBeside`) + the internal
 *                      per-cell tests they share with `penetration.ts`
 * - `support.ts`     – `slopeSupportsBox` ride-vs-wall slope contact logic
 * - `penetration.ts` – `horizontalPenetration` / `verticalPenetration`
 *
 * Internal helpers are exported from their home modules so sibling modules
 * can import them, but only the six public queries below are re-exported
 * here — the rest of the folder stays package-private.
 */

export { isPointSolid } from "./point";
export { isBoxSolid, isBoxInDeadZone, wallBeside } from "./box";
export { horizontalPenetration, verticalPenetration } from "./penetration";