/**
 * Collision geometry extracted from the Tiled map layers. Engine-free (no
 * Phaser, no DOM) so it typechecks and runs on its own — the output feeds the
 * debug overlay today and becomes the input for collision calculations later
 * (segment vs. point / AABB tests).
 *
 * Coordinate space is map pixel space, origin top-left with y growing down,
 * matching the tile grid: tile (tx, ty) occupies `[tx*tw, (tx+1)*tw) ×
 * [ty*th, (ty+1)*th)`.
 *
 * Tiles in the collision layer form one solid block wherever they are
 * adjacent:
 * - 57  – solid wall tile; block boundaries are traced as straight edges
 *         (horizontal edges are "floor", vertical edges are "wall").
 * - 65  – plain full block (brick texture) with the same solid footprint
 *         as 57; traced the same way and merged with 57 neighbors.
 * - 110 – diagonal tile, solid on its top-left half (line TL → BR).
 * - 109 – diagonal tile, solid on its top-right half (line TR → BL).
 * - 262 – diagonal tile, solid on its bottom-right half (line TR → BL).
 * - 287 – shallow diagonal tile, solid below the bottom-aligned 2:1 line
 *         from the bottom-left corner (0, 16) to the right edge's midpoint
 *         (16, 8) — 262 at half the rise, sitting on the cell's bottom edge
 *         with a solid back column under the apex. Besides the diagonal,
 *         the back column and the bottom base row are emitted as wall and
 *         floor boundary edges where they face open space.
 * - 288 – staircase tile (a pixel-mask shape): eight 2px treads stepping
 *         down from the top-right to the bottom-left — the mirror of 287,
 *         so a 287 + 288 pair forms a continuous ramp — with a full-height
 *         right wall, a left wall from mid-height down, and a solid base
 *         row. Outlined like the other slopes; the block's bounding edges
 *         are traced and the staircase line (0, 8) → (16, 0) is emitted as
 *         its diagonal, with the full-height right wall and the base row
 *         emitted as wall and floor boundary edges where they face open
 *         space.
 * - 464 – dead-zone tile (a pixel-mask hazard pit, see DEAD_ZONE_MASK in
 *         @monkeyluka/shared): an OPEN basin — no solid wall geometry to
 *         trace, just a 3px base at the cell's bottom. It is emitted as
 *         `kind: "hazard"` segments (the debug overlay draws them RED):
 *         the mouth rim (top edge), the side walls down to the basin
 *         floor, and the floor line, drawn around the perimeter of each
 *         connected 464 group — a face is covered only by an adjacent 464
 *         neighbor (other collision types are ignored, so the pit outline
 *         is self-contained and never hidden under a bordering wall/floor
 *         block's own edges).
 * - 375/376/401/402 – door tiles: each recognized 2×2 door block (see
 *         buildDoorEntities in @monkeyluka/shared) is carried on
 *         `CollisionGeometry.doors` as its own `DoorEntity`, and the debug
 *         overlay draws each Entity's full PURPLE perimeter — four sides
 *         around the whole 2×2 block — grouped per Entity so an opened
 *         door's lines can be hidden individually (see the `hideDoor` on
 *         the overlay handle) while the rest of the overlay stays put.
 *         Like the 464 pit, the outline is self-contained: other
 *         collision types are never merged into it (a bordering 57 wall
 *         hides nothing). A closed door IS solid in the physics grid
 *         (buildTileGrid folds the gids into the TILE_DOOR kind), but it
 *         is NON-sticky — the wall-cling grab can't grab it — and its
 *         debug identity stays its own purple perimeter instead of
 *         wall/floor block edges.
 *
 * A 57 side touching a 109/110 tile emits no straight edge — the slope line
 * takes over that part of the block boundary, so the two belong to the same
 * collision block.
 */

import {
  COLLISION_LAYER_NAME,
  TILE_DEAD_ZONE,
  TILE_SLOPE_BR,
  TILE_SLOPE_SHALLOW,
  TILE_SLOPE_TL_BR,
  TILE_SLOPE_TR_BL,
  TILE_SOLID,
  TILE_SOLID_65,
  TILE_STAIRS,
  buildDoorEntities,
  type DoorEntity,
} from "@monkeyluka/shared";
import type { TiledMap } from "../map/tiled-map";

/** Solid wall tile: merges with neighbors into collision blocks. */
export const WALL_TILE = TILE_SOLID;
/**
 * Plain full block tile (gid 65, brick texture): the same solid footprint
 * as WALL_TILE/57, so it merges with 57 neighbors and traces edges the
 * same way.
 */
export const WALL_TILE_65 = TILE_SOLID_65;
/** Diagonal tile, solid on its top-left half (line top-left → bottom-right). */
export const DIAGONAL_TL_TO_BR = TILE_SLOPE_TL_BR;
/** Diagonal tile, solid on its top-right half (line top-right → bottom-left). */
export const DIAGONAL_TR_TO_BL = TILE_SLOPE_TR_BL;
/** Diagonal tile, solid on its bottom-right half (line top-right → bottom-left). */
export const DIAGONAL_TR_TO_BL_BOTTOM = TILE_SLOPE_BR;
/**
 * Shallow diagonal tile (2:1 ramp): solid below the bottom-aligned line
 * from the bottom-left corner (0, 16) to the right edge's midpoint (16, 8)
 * of the cell.
 */
export const DIAGONAL_SHALLOW = TILE_SLOPE_SHALLOW;
/**
 * Staircase tile (pixel-mask shape): eight 2px treads stepping down from
 * the top-right to the bottom-left — the mirror of 287, so a 287 + 288
 * pair forms a continuous ramp — with a full-height right wall, a left
 * wall from mid-height down, and a solid base row.
 */
export const STAIR_STEPS = TILE_STAIRS;

/** Default tile layer holding the collision geometry. */
export const DEFAULT_COLLISION_LAYER = COLLISION_LAYER_NAME;

/**
 * "floor" = a horizontal boundary line (top or bottom of a group); "wall" =
 * a vertical boundary line (left or right side). Debug overlay colors
 * floors blue and walls green; "hazard" marks the dead-zone (464) pit
 * outline, drawn red. Door perimeters are NOT segments — they live on
 * `CollisionGeometry.doors` as per-Entity 2×2 perimeters (drawn purple by
 * the overlay) so an opened door's lines can be hidden individually.
 */
export type EdgeKind = "floor" | "wall" | "hazard";

/** Which tile side a boundary edge lies on; the solid group is behind it. */
export type TileSide = "top" | "bottom" | "left" | "right";

/** One straight boundary edge of a collision block, in map pixels. */
export interface BoundarySegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** "floor" for horizontal edges (blue), "wall" for vertical (green). */
  kind: EdgeKind;
  /** Tile side the edge lies on — the solid group is on the inward side. */
  side: TileSide;
}

/** The collision line of one diagonal tile (110/109/262/287), in map pixels. */
export interface DiagonalSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Which half of the tile is solid, relative to the line. */
  solidSide: "top-left" | "top-right" | "bottom-right";
}

export interface CollisionGeometry {
  /** Merged straight boundary edges of the collision blocks. */
  segments: BoundarySegment[];
  /** Slope lines of the diagonal tiles (110/109/262/287). */
  diagonals: DiagonalSegment[];
  /**
   * Door entities (each recognized 2×2 door block, see door.ts in
   * @monkeyluka/shared): the debug overlay draws each one's own full purple
   * perimeter, on its own graphics, so an opened door's lines can be
   * hidden individually while the rest of the overlay stays.
   */
  doors: DoorEntity[];
}

/**
 * Extracts the collision geometry from `layerName` (default "layer1").
 * Adjacent wall/slope tiles form one solid block: 57 sides emit edges only
 * where they face open space, and 109/110 tiles contribute their diagonal
 * line each; maximal straight runs are merged. Boundary edges of a block
 * that borders a slope line end exactly at the slope's corners.
 */
export function buildCollisionGeometry(
  map: TiledMap,
  layerName: string = DEFAULT_COLLISION_LAYER,
): CollisionGeometry {
  const layer = map.layers.find((candidate) => candidate.name === layerName);
  if (!layer) return { segments: [], diagonals: [], doors: [] };

  const { width, height, gids } = layer;
  const tw = map.tileWidth;
  const th = map.tileHeight;

  // A cell is part of the collision block when it is a wall tile or a slope
  // tile; cells outside the map count as open space. Edges are drawn only
  // where a block tile faces open space, so a 57 side bordering a 109/110
  // yields no straight line — the slope line takes over that boundary.
  const isSolid = (tx: number, ty: number): boolean => {
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return false;
    const gid = gids[ty * width + tx];
    return (
      gid === WALL_TILE ||
      gid === WALL_TILE_65 ||
      gid === DIAGONAL_TL_TO_BR ||
      gid === DIAGONAL_TR_TO_BL ||
      gid === DIAGONAL_TR_TO_BL_BOTTOM ||
      gid === DIAGONAL_SHALLOW ||
      gid === STAIR_STEPS
    );
  };

  // Unit edges bucketed per (axis, fixed coordinate, side) so collinear
  // neighbors merge into maximal straight runs at the end.
  const horizontalRun = { top: new Map<number, number[]>(), bottom: new Map<number, number[]>() };
  const verticalRun = { left: new Map<number, number[]>(), right: new Map<number, number[]>() };
  const pushEdge = (
    bucket: Map<number, number[]>,
    fixed: number,
    offset: number,
  ): void => {
    const offsets = bucket.get(fixed) ?? [];
    offsets.push(offset);
    bucket.set(fixed, offsets);
  };

  const diagonals: DiagonalSegment[] = [];
  // Straight boundary edges of the slope-shape tiles (287/288): their back
  // wall and bottom base row, emitted per tile alongside the diagonal but
  // only where the face borders open space (a solid neighbor covers it,
  // like the 57 block edges above).
  const shapeEdges: BoundarySegment[] = [];

  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const gid = gids[ty * width + tx];
      const left = tx * tw;
      const top = ty * th;

      if (gid === WALL_TILE || gid === WALL_TILE_65) {
        // A side faces open space — that side is a boundary edge of the
        // block (horizontal = floor/blue, vertical = wall/green). Sides
        // touching another block tile (57 or a 109/110 slope) emit nothing.
        if (!isSolid(tx, ty - 1)) pushEdge(horizontalRun.top, top, left);
        if (!isSolid(tx, ty + 1)) pushEdge(horizontalRun.bottom, top + th, left);
        if (!isSolid(tx - 1, ty)) pushEdge(verticalRun.left, left, top);
        if (!isSolid(tx + 1, ty)) pushEdge(verticalRun.right, left + tw, top);
      } else if (gid === DIAGONAL_TL_TO_BR) {
        diagonals.push({
          x1: left,
          y1: top,
          x2: left + tw,
          y2: top + th,
          solidSide: "top-left",
        });
      } else if (gid === DIAGONAL_TR_TO_BL) {
        diagonals.push({
          x1: left + tw,
          y1: top,
          x2: left,
          y2: top + th,
          solidSide: "top-right",
        });
      } else if (gid === DIAGONAL_TR_TO_BL_BOTTOM) {
        diagonals.push({
          x1: left + tw,
          y1: top,
          x2: left,
          y2: top + th,
          solidSide: "bottom-right",
        });
      } else if (gid === DIAGONAL_SHALLOW) {
        // 287: the face runs from the bottom-left corner to the right
        // edge's midpoint — 16px of run, 8px of rise, aligned with the
        // tile's bottom edge. It is not a corner-to-corner line, so the
        // segment ends at the right edge's midpoint.
        diagonals.push({
          x1: left,
          y1: top + th,
          x2: left + tw,
          y2: top + th / 2,
          solidSide: "bottom-right",
        });
        // The shape's other two boundaries: the back side (the solid
        // right column below the apex) and the bottom base row. Drawn only
        // where the face borders open space — a solid neighbor (a 288 to
        // the right, a 57 floor below) covers the face, like the merged
        // 57 block edges.
        if (!isSolid(tx + 1, ty)) {
          shapeEdges.push({
            x1: left + tw,
            y1: top + th / 2,
            x2: left + tw,
            y2: top + th,
            kind: "wall",
            side: "right",
          });
        }
        if (!isSolid(tx, ty + 1)) {
          shapeEdges.push({
            x1: left,
            y1: top + th,
            x2: left + tw,
            y2: top + th,
            kind: "floor",
            side: "bottom",
          });
        }
      } else if (gid === STAIR_STEPS) {
        // 288: the mirror of 287 — the staircase line runs from mid-height
        // on the left (0, 8) to the cell's top-right corner (16, 0). The
        // treads step down from the top-right; the solid sits below.
        diagonals.push({
          x1: left,
          y1: top + th / 2,
          x2: left + tw,
          y2: top,
          solidSide: "bottom-right",
        });
        // The shape's other two boundaries: the full-height right wall
        // (back) and the solid base row (bottom), drawn only where the
        // face borders open space — a solid neighbor (a 57 to the right,
        // a 57 floor below) covers the face, like the merged 57 block
        // edges.
        if (!isSolid(tx + 1, ty)) {
          shapeEdges.push({
            x1: left + tw,
            y1: top,
            x2: left + tw,
            y2: top + th,
            kind: "wall",
            side: "right",
          });
        }
        if (!isSolid(tx, ty + 1)) {
          shapeEdges.push({
            x1: left,
            y1: top + th,
            x2: left + tw,
            y2: top + th,
            kind: "floor",
            side: "bottom",
          });
        }
      } else if (gid === TILE_DEAD_ZONE) {
        // 464 dead-zone pit: an OPEN basin (rows 0-12 open, a 3px solid
        // base at rows 13-15 — see DEAD_ZONE_MASK in @monkeyluka/shared), so
        // there is no wall geometry to trace like the slopes. The hazard is
        // emitted as its own `hazard` segments — the mouth rim (top edge),
        // the two side walls down to the basin floor, and the floor line —
        // tracing the perimeter of each connected 464 group: a face is
        // covered only by an adjacent 464 neighbor (adjacent pits merge
        // into one trench outline). Other collision types are deliberately
        // NOT consulted, unlike the 57/288 block edges — a bordering 57
        // wall or floor still gets the pit's own outline drawn (they
        // overlap visually in the debug overlay, but the hazard shape stays
        // self-contained).
        const baseTop = top + th - 3; // top of the 3px base rows (13-15)
        const isDeadZone = (nx: number, ny: number): boolean =>
          nx >= 0 && ny >= 0 && nx < width && ny < height &&
          gids[ny * width + nx] === TILE_DEAD_ZONE;
        if (!isDeadZone(tx, ty - 1)) {
          shapeEdges.push({
            x1: left,
            y1: top,
            x2: left + tw,
            y2: top,
            kind: "hazard",
            side: "top",
          });
        }
        if (!isDeadZone(tx + 1, ty)) {
          shapeEdges.push({
            x1: left + tw,
            y1: top,
            x2: left + tw,
            y2: baseTop,
            kind: "hazard",
            side: "right",
          });
        }
        if (!isDeadZone(tx - 1, ty)) {
          shapeEdges.push({
            x1: left,
            y1: top,
            x2: left,
            y2: baseTop,
            kind: "hazard",
            side: "left",
          });
        }
        if (!isDeadZone(tx, ty + 1)) {
          shapeEdges.push({
            x1: left,
            y1: baseTop,
            x2: left + tw,
            y2: baseTop,
            kind: "hazard",
            side: "bottom",
          });
        }
      }
    }
  }

  // Door entities (see door.ts in @monkeyluka/shared): every recognized 2×2
  // door block is carried on `CollisionGeometry.doors`; the debug overlay
  // draws each Entity's own full perimeter (PURPLE) — four sides around the
  // whole 2×2 block, grouped per Entity so an opened door's lines can be
  // hidden individually (see `hideDoor` on the overlay handle). Like the
  // 464 hazard outline, a door face is covered only by the door itself —
  // other collision types are deliberately NOT consulted, so a bordering
  // 57 wall/floor never hides the outline: the outline is the Entity, not
  // a block boundary.
  const doors = buildDoorEntities(layer);

  const segments: BoundarySegment[] = [];

  // Merge collinear horizontal unit edges into straight runs.
  for (const side of ["top", "bottom"] as const) {
    for (const [y, xs] of horizontalRun[side]) {
      xs.sort((a, b) => a - b);
      let runStart = xs[0];
      let runEnd = xs[0];
      for (const x of xs.slice(1)) {
        if (x === runEnd + tw) {
          runEnd = x;
        } else {
          segments.push({
            x1: runStart,
            y1: y,
            x2: runEnd + tw,
            y2: y,
            kind: "floor",
            side,
          });
          runStart = x;
          runEnd = x;
        }
      }
      segments.push({
        x1: runStart,
        y1: y,
        x2: runEnd + tw,
        y2: y,
        kind: "floor",
        side,
      });
    }
  }

  // Same for vertical unit edges.
  for (const side of ["left", "right"] as const) {
    for (const [x, ys] of verticalRun[side]) {
      ys.sort((a, b) => a - b);
      let runStart = ys[0];
      let runEnd = ys[0];
      for (const y of ys.slice(1)) {
        if (y === runEnd + th) {
          runEnd = y;
        } else {
          segments.push({
            x1: x,
            y1: runStart,
            x2: x,
            y2: runEnd + th,
            kind: "wall",
            side,
          });
          runStart = y;
          runEnd = y;
        }
      }
      segments.push({
        x1: x,
        y1: runStart,
        x2: x,
        y2: runEnd + th,
        kind: "wall",
        side,
      });
    }
  }

  // Slope-shape boundary edges join the merged block edges; the sort below
  // keeps the output order deterministic.
  segments.push(...shapeEdges);

  // Deterministic output order (grouped by geometry, not by Map insertion).
  const byPosition = (
    a: { x1: number; y1: number; x2: number; y2: number },
    b: { x1: number; y1: number; x2: number; y2: number },
  ): number =>
    a.y1 - b.y1 || a.x1 - b.x1 || a.y2 - b.y2 || a.x2 - b.x2;

  segments.sort(byPosition);
  diagonals.sort(byPosition);

  return { segments, diagonals, doors };
}