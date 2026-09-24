/**
 * Phaser side of the 1×2 door stacks: the `Assets/door.png` sprite sheet
 * (served via the `public/door.png` symlink) driven by the shared door
 * entities (`DoorEntity` / `buildDoorEntities` in @monkeyluka/shared). One
 * `DoorView` per door pairs its entity with a Phaser sprite positioned in
 * map-pixel coordinates inside the scene's door layer (a transform twin of
 * room 0 — see create.ts), so it maps to the canvas exactly like every
 * other world object, mirroring how the trap and move-platform render
 * modules drive their sheets.
 *
 * The sheet is a 192×192 image: a 3×3 grid of 64×64 cells, row-major — the
 * same packing as the player's jump sheet. A cell covers the door's 1×2-
 * tile stack (16 map px wide × 32 tall) at a quarter/half scale (the
 * source cell is square, so the two axes scale differently), and every
 * frame holds ONE door panel (an early draft carried two identical
 * panels — a double door — which read as two doors at this scale). The
 * frames
 * trace the door panel lifting out of the doorway: frames 0–4 are the
 * closed door (a subtle pre-lift pulse), frame 5 starts the slide up, and
 * frames 6–8 progressively reveal the empty doorway as the panel exits
 * the top. Frame 0 is the idle/closed pose; frames 0–8 (`DOOR_OPEN_ANIM`)
 * play **once** when the door opens, and the sprite hides on completion.
 *
 * The door tiles are NOT rendered from the tileset: map-renderer skips the
 * door gids (`isDoorTileGid`), so this sprite is the door's only art
 * and hiding it after the animation leaves a genuinely open doorway
 * instead of the baked-in closed door tiles underneath.
 */

import type Phaser from "phaser";
import { TILE_SIZE, doorKey, type DoorEntity } from "@monkeyluka/shared";

/** Texture key for the door sheet, loaded by the jungle scene. */
export const DOOR_TEXTURE = "door";

/** Animation key registered by `registerDoorAnimations`. */
export const DOOR_OPEN_ANIM = "door-anim:open";

/**
 * Each sheet cell is 64×64 — drafted at 4× the door's 16px tile width and
 * 2× its 32px stack height (a square cell for a portrait doorway). The
 * sprite is scaled per entity so its footprint lands exactly on the
 * 1×2-tile stack (16×32 map px).
 */
const FRAME_SIZE = 64;
/** The sheet is 3 cells wide (a 192×192 image). */
const DOOR_SHEET_COLUMNS = 3;
/** All 9 cells are opening frames (0–4 closed pose, 5–8 the lift). */
const DOOR_FRAME_COUNT = 9;

/**
 * Minimal door-state lookup — the synced `JungleState.doors` map. Kept as
 * an interface (not a Colyseus type) so this render module stays
 * framework-agnostic.
 */
export interface DoorStateLookup {
  get(key: string): { state: string } | undefined;
}

/** One rendered door: the shared entity plus its Phaser sprite. */
export interface DoorView {
  door: DoorEntity;
  sprite: Phaser.GameObjects.Sprite;
  /**
   * Play the one-shot opening animation (frames 0→8, the panel lifting
   * out) and hide the sprite the moment it completes. No-op for a door
   * already hidden or already animating — e.g. a client that joined after
   * the door was opened, whose sprite was born hidden and must not
   * re-animate.
   */
  playOpening(): void;
}

/**
 * Registers the door sheet's frames and its one-shot opening animation.
 * Call once, after the door sheet has finished loading and before any door
 * view is spawned (create.ts calls it right before the view loop). The
 * animation plays the full sequence 0→8 once and stops on the last frame;
 * `DoorView.playOpening` hides the sprite on its completion event.
 */
export function registerDoorAnimations(scene: Phaser.Scene): void {
  const texture = scene.textures.get(DOOR_TEXTURE);
  for (let frame = 0; frame < DOOR_FRAME_COUNT; frame++) {
    texture.add(
      frame,
      0,
      (frame % DOOR_SHEET_COLUMNS) * FRAME_SIZE,
      Math.floor(frame / DOOR_SHEET_COLUMNS) * FRAME_SIZE,
      FRAME_SIZE,
      FRAME_SIZE,
    );
  }
  scene.anims.create({
    key: DOOR_OPEN_ANIM,
    frames: scene.anims.generateFrameNumbers(DOOR_TEXTURE, {
      start: 0,
      end: DOOR_FRAME_COUNT - 1,
    }),
    frameRate: 12,
    repeat: 0,
  });
}

/**
 * Creates the view for every door inside `layer` (the scene's door layer —
 * a transform twin of room 0, see create.ts). Each door renders frame 0 of
 * the sheet at its 1×2-tile stack: origin at the stack's top tile
 * `(tx*TILE_SIZE, ty*TILE_SIZE)` in map-pixel coordinates, scaled so the
 * 64×64 cell covers exactly the 16×32 stack. A door the room has ALREADY
 * opened (a late join — `doorStates` reports "open") is born hidden so it
 * never re-animates.
 */
export function createDoorViews(
  scene: Phaser.Scene,
  doors: readonly DoorEntity[],
  layer: Phaser.GameObjects.Container,
  doorStates?: DoorStateLookup | null,
): Map<string, DoorView> {
  const views = new Map<string, DoorView>();
  for (const door of doors) {
    const key = doorKey(door.tx, door.ty);
    const alreadyOpen = doorStates?.get(key)?.state === "open";

    const sprite = scene.add.sprite(
      door.tx * TILE_SIZE,
      door.ty * TILE_SIZE,
      DOOR_TEXTURE,
      0,
    );
    sprite.setOrigin(0, 0);
    // Non-uniform: the square 64×64 cell maps onto the door's 1×2-tile
    // (16×32 map-px) stack. Kept per-entity so a future door shape (e.g.
    // a wide 2×1 block) only needs its own cols/rows.
    sprite.setScale(
      (door.cols * TILE_SIZE) / FRAME_SIZE,
      (door.rows * TILE_SIZE) / FRAME_SIZE,
    );
    sprite.setVisible(!alreadyOpen);
    layer.add(sprite);

    const view: DoorView = {
      door,
      sprite,
      playOpening() {
        if (!sprite.visible || sprite.anims.isPlaying) return;
        // One-shot animation: hide the now-open doorway the moment the
        // lift finishes. The keyed completion event (animationcomplete-
        // door-anim:open) can't be confused with another animation's.
        sprite.once(
          `animationcomplete-${DOOR_OPEN_ANIM}`,
          () => sprite.setVisible(false),
        );
        sprite.play(DOOR_OPEN_ANIM);
      },
    };
    views.set(key, view);
  }
  return views;
}