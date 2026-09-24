# Discovery: movePlatformF sheet misread as 16×16 frames, sprites scaled 2× too wide

**Date:** 2026-02-14
**Scope:** `apps/web` (`apps/web/src/game/trap/move-platform-render.ts`) — platform sheet frame layout
**Status:** Fixed

## Symptom

The move-platform slab sprite rendered twice its intended width: a 32×16
platform came out as a 64×16-wide slab on screen. The collision/support
geometry stayed correct (the shared `MOVE_PLATFORM_WIDTH`/`HEIGHT` 32×16
probe), so the player stood on the left half of art that was double-wide,
and the visible slab wandered visually ahead of/behind the actual support
surface.

## Root cause

`movePlatformF.png` (256×16) was assumed to be a single row of sixteen
16×16 cells, and the code compensated by scaling the sprite 2× horizontally
(`sprite.setScale(MOVE_PLATFORM_WIDTH / FRAME_SIZE, ...)` with
`FRAME_SIZE = 16`) in the belief that the 32×16 footprint was "two cells
wide". The sheet is actually **eight 32×16 cells**: decode each 32px column
block and you get a complete slab — top surface spanning the full 32px with
a tooth that retracts/regrows symmetrically (frames 0–3 mirror 7–4). The
previously-registered 16px-wide frames were half-slab slices (the tooth sits
centered, so each slice doubled into its own tooth — the doubled art showed
two bumps where the sheet has one centered tooth).

## Fix

`apps/web/src/game/trap/move-platform-render.ts`:

- before: `FRAME_SIZE = 16`, `MOVE_PLATFORM_COLUMNS = 16`,
  `MOVE_PLATFORM_FRAME_COUNT = 16`, frames registered at `(i*16, 0)` as
  16×16, sprite scaled `(MOVE_PLATFORM_WIDTH/16, MOVE_PLATFORM_HEIGHT/16)`.
- after: `FRAME_WIDTH = MOVE_PLATFORM_WIDTH` (32), `FRAME_HEIGHT =
  MOVE_PLATFORM_HEIGHT` (16), `MOVE_PLATFORM_COLUMNS = 8`,
  `MOVE_PLATFORM_FRAME_COUNT = 8`, frames registered at `(i*32, 0)` as
  32×16, and the sprite is created **unscaled** — each frame already is the
  footprint.

A caller-supplied `movePlatformTexture` override must now likewise provide
32×16 frames (documented on `MovePlatformViewOptions.texture`); a custom
sheet that wants a different displayed size can set its own scale.

## Verification

Decoded the PNG row-by-row (only 3 columns of header + IDAT chunks to
account for — no external deps): 256×16, and the 32px-wide cell dump shows
8 complete slab glyphs with symmetric tooth sizes (0==7, 1==6, 2==5,
3==4). `bun run typecheck` passes; visual check: slab art is one 32×16 slab
per platform, matching the debug outline and the shared `isBoxOnMovePlatform`
probe.

## Related

- `apps/web/AGENTS.md` "move_platform" bullet and root `AGENTS.md` "Moving
  platforms" bullet (both updated: eight 32×16 frames, unscaled).