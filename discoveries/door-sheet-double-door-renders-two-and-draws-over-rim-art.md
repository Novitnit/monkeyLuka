# Discovery: door sheet drafted as a double door — every 1×2 stack rendered two doors

**Date:** 2026-09-24
**Scope:** apps/web (`src/game/door/door-render.ts`, `Assets/door.png`, `map-renderer.ts`, `scene/create.ts`)
**Status:** Fixed

## Symptom

Each 1×2 door stack in the jungle map rendered as **two doors**: the closed
pose showed two narrow, identical panels side-by-side with a hard vertical
crack between them, and the opening animation lifted both. The doors also drew
**over** the map's front decoration layer (`out_tile`) — the doorway sill /
rim art sat behind the panel instead of framing it.

## Root cause

Two independent causes:

1. **The sheet art was a double door.** `Assets/door.png` is a 3×3 grid of
   64×64 cells. Every frame's artwork was drawn as **two identical ~30px door
   panels** separated by a 2px transparent gap (the panels are ~pixel-identical:
   < 30 diff pixels of 1920 between `x[0,30)` and `x[32,62)` on frames 0–4).
   The door sprite maps a whole 64×64 cell onto the door's 1×2 stack with
   non-uniform scale `(16/64, 32/64)` (`door-render.ts`), so the entire
   double-panel cell — both panels and the gap — gets squeezed into the one
   16-map-px-wide doorway. The transparent gap becomes the visible "two doors"
   crack. The art can't do this job as-is: to show **one** door the cell has to
   hold one panel spanning its full width.

2. **The door layer was the top-most map art.** `create.ts` added the door
   layer (a transform twin of room 0) after `renderTiledMap` added every room,
   so the door sprites drew over the whole map including the `out_tile`
   layer — the last tile layer in main.json, whose rim/hedge tiles sit exactly
   where the door stacks are.

## Fix

1. **Rebuild the sheet art as a single door per frame.** For each of the 9
   frames, take the frame's left panel (`x[0,30)` — the two panels are
   duplicate, and the lift frames 5–8 each contain the full story in their left
   panel alone) and bilinearly stretch it horizontally to fill the 64px cell.
   Verified: no fully-transparent middle column remains in any frame, and the
   rendered door region goes from a hard vertical split to one continuous
   silhouette.

2. **Lift `out_tile` above the door layer.** `map-renderer.ts` gained a
   `topTileLayers` option (`TiledMapRenderOptions`): named tile layers are no
   longer drawn inside each room; each is rendered whole into its own
   map-pixel-coordinate container (a transform twin of room 0) returned as
   `TiledMapRender.topLayers`. `create.ts` passes `topTileLayers:
   [OUT_TILE_LAYER_NAME]` (constant in `scene/constants.ts`) and, right after
   building the door layer, raises each top container with
   `this.children.bringToTop(top.container)` — so z-order becomes
   rooms → door layer → `out_tile` → trap layer → player layer. The door panel
   now slides up **behind** the rim art, and the sill tile stays in front of
   the panel's base.

   This is a display-list ordering trick: `bringToTop` is needed because
   `renderTiledMap` adds the top container before `create.ts` adds the door
   layer, so the container must be re-raised after the door layer exists. A
   simpler "put the door below all rooms" doesn't work — the background image
   layer inside each room would then cover the door entirely.

## Verification

- Pixel-diffed the live game (`/play`, 1280×720): screenshot with the door
  visible vs door sprites hidden (`setVisible(false)`). Pixels in the
  `out_tile` artwork rows (screen ~y 423+) are **identical** in both shots
  (rim art covers the door's base) while the door's exposed half still changes
  — the door is genuinely behind `out_tile`, not merely pushed under the whole
  map.
- The old sheet's two-panel split is gone from rendered pixels (single
  continuous door silhouette vs the old central crack).
- `bun run typecheck` (web/server/shared) green, `bun test` 143 pass,
  `bun run build:web` green.

## Future note

When drafting a sprite sheet whose cells are scaled **non-uniformly** onto an
entity (here 64×64 → 16×32), the drawn panel must fill the entire cell width —
any duplicate/adjacent panel or seam the artist adds at 4× reads as extra doors
at the 16px final scale. If the art ever gets redrafted, keep one door per cell
(see the regenerated `Assets/door.png`).