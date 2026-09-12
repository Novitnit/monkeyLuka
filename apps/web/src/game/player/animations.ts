/**
 * Player motion animations: the idle/jog/jump sprite sheets from
 * `Assets/player/sheets` registered as frame-based Phaser animations and
 * driven by the shared physics state (`grounded` + horizontal speed).
 *
 * Sheet layouts (all cells 16×16, matching the player's physics body):
 * - idle: 16×16 — a single frame.
 * - cling: 16×16 — a single frame (wall grab).
 * - jog:  48×48 — 3×3 cell grid, 8 frames used (row-major, last cell empty).
 * - jump: 32×48 — 2×3 cell grid, 5 frames used (row-major, last cell empty).
 */

import type Phaser from "phaser";

/** Texture keys for the sheets, loaded as images by the jungle scene. */
export const PLAYER_IDLE_TEXTURE = "player-idle";
export const PLAYER_CLING_TEXTURE = "player-cling";
export const PLAYER_JOG_TEXTURE = "player-jog";
export const PLAYER_JUMP_TEXTURE = "player-jump";

/** Animation keys registered by `registerPlayerAnimations`. */
export const PLAYER_IDLE_ANIM = "player-anim:idle";
export const PLAYER_CLING_ANIM = "player-anim:cling";
export const PLAYER_JOG_ANIM = "player-anim:jog";
export const PLAYER_JUMP_ANIM = "player-anim:jump";

/** Each sprite-sheet cell is 16×16 (same size as the physics body). */
const FRAME_SIZE = 16;

/** The jog sheet is 3 cells wide; 8 of its 9 cells hold animation frames. */
const JOG_COLUMNS = 3;
const JOG_FRAME_COUNT = 8;

/** The jump sheet is 2 cells wide; 5 of its 6 cells hold animation frames. */
const JUMP_COLUMNS = 2;
const JUMP_FRAME_COUNT = 5;

/** |vx| (px/s) above which a grounded player plays the jog animation. */
const JOG_SPEED_THRESHOLD = 5;

/** Adds one numbered frame per used cell, scanning the sheet row-major. */
function registerSheetFrames(
  scene: Phaser.Scene,
  key: string,
  columns: number,
  frameCount: number,
): void {
  const texture = scene.textures.get(key);
  for (let frame = 0; frame < frameCount; frame++) {
    texture.add(
      frame,
      0,
      (frame % columns) * FRAME_SIZE,
      Math.floor(frame / columns) * FRAME_SIZE,
      FRAME_SIZE,
      FRAME_SIZE,
    );
  }
}

/**
 * Registers the sheet frames and their animations on the scene. Call once,
 * after the three sheets have finished loading and before any player sprite
 * is spawned. The jump animation is one-shot: it plays its launch → apex →
 * landing arc once (≈ the physics airtime) and holds the landing frame.
 */
export function registerPlayerAnimations(scene: Phaser.Scene): void {
  registerSheetFrames(scene, PLAYER_JOG_TEXTURE, JOG_COLUMNS, JOG_FRAME_COUNT);
  registerSheetFrames(
    scene,
    PLAYER_JUMP_TEXTURE,
    JUMP_COLUMNS,
    JUMP_FRAME_COUNT,
  );

  const anims = scene.anims;
  anims.create({
    key: PLAYER_IDLE_ANIM,
    frames: [{ key: PLAYER_IDLE_TEXTURE, frame: 0 }],
    frameRate: 6,
    repeat: -1,
  });
  anims.create({
    key: PLAYER_CLING_ANIM,
    frames: [{ key: PLAYER_CLING_TEXTURE, frame: 0 }],
    frameRate: 6,
    repeat: 0,
  });
  anims.create({
    key: PLAYER_JOG_ANIM,
    frames: anims.generateFrameNumbers(PLAYER_JOG_TEXTURE, {
      start: 0,
      end: JOG_FRAME_COUNT - 1,
    }),
    frameRate: 10,
    repeat: -1,
  });
  anims.create({
    key: PLAYER_JUMP_ANIM,
    frames: anims.generateFrameNumbers(PLAYER_JUMP_TEXTURE, {
      start: 0,
      end: JUMP_FRAME_COUNT - 1,
    }),
    frameRate: 8,
    repeat: 0,
  });
}

/**
 * Points a player sprite at the animation matching its motion state:
 * clinging → cling, airborne → jump, grounded and moving → jog, grounded
 * and still → idle. Only restarts when the animation actually changes, so
 * the one-shot jump arc plays through and the looping/jog animations don't
 * restart every frame.
 */
export function setPlayerAnimation(
  sprite: Phaser.GameObjects.Sprite,
  grounded: boolean,
  speedX: number,
  clinging: boolean,
): void {
  const key = clinging
    ? PLAYER_CLING_ANIM
    : !grounded
      ? PLAYER_JUMP_ANIM
      : Math.abs(speedX) > JOG_SPEED_THRESHOLD
        ? PLAYER_JOG_ANIM
        : PLAYER_IDLE_ANIM;
  if (sprite.anims.currentAnim?.key !== key) {
    sprite.play(key);
  }
}