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
 * - 110 – diagonal tile, solid on its top-left half (line TL → BR).
 * - 109 – diagonal tile, solid on its top-right half (line TR → BL).
 *
 * A 57 side touching a 109/110 tile emits no straight edge — the slope line
 * takes over that part of the block boundary, so the two belong to the same
 * collision block.
 */

import {
  COLLISION_LAYER_NAME,
  TILE_SLOPE_TL_BR,
  TILE_SLOPE_TR_BL,
  TILE_SOLID,
} from "@monkeyluka/shared";
import type { TiledMap } from "../map/tiled-map";

/** Solid wall tile: merges with neighbors into collision blocks. */
export const WALL_TILE = TILE_SOLID;
/** Diagonal tile, solid on its top-left half (line top-left → bottom-right). */
export const DIAGONAL_TL_TO_BR = TILE_SLOPE_TL_BR;
/** Diagonal tile, solid on its top-right half (line top-right → bottom-left). */
export const DIAGONAL_TR_TO_BL = TILE_SLOPE_TR_BL;

/** Default tile layer holding the collision geometry. */
export const DEFAULT_COLLISION_LAYER = COLLISION_LAYER_NAME;

/**
 * "floor" = a horizontal boundary line (top or bottom of a group); "wall" =
 * a vertical boundary line (left or right side). Debug overlay colors
 * floors blue and walls green.
 */
export type EdgeKind = "floor" | "wall";

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

/** The collision line of one diagonal tile (109/110), in map pixels. */
export interface DiagonalSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Which half of the tile is solid, relative to the line. */
  solidSide: "top-left" | "top-right";
}

export interface CollisionGeometry {
  /** Merged straight boundary edges of the collision blocks. */
  segments: BoundarySegment[];
  /** Slope lines of the 109/110 diagonal tiles. */
  diagonals: DiagonalSegment[];
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
  if (!layer) return { segments: [], diagonals: [] };

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
      gid === DIAGONAL_TL_TO_BR ||
      gid === DIAGONAL_TR_TO_BL
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

  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const gid = gids[ty * width + tx];
      const left = tx * tw;
      const top = ty * th;

      if (gid === WALL_TILE) {
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
      }
    }
  }

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

  // Deterministic output order (grouped by geometry, not by Map insertion).
  const byPosition = (
    a: { x1: number; y1: number; x2: number; y2: number },
    b: { x1: number; y1: number; x2: number; y2: number },
  ): number =>
    a.y1 - b.y1 || a.x1 - b.x1 || a.y2 - b.y2 || a.x2 - b.x2;

  segments.sort(byPosition);
  diagonals.sort(byPosition);

  return { segments, diagonals };
}