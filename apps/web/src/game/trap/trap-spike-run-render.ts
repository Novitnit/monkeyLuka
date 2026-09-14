/**
 * Phaser side of the Trap_Spike_Run movable traps: the `Trap_Spike_Run`
 * sprite sheet driven by the shared trap model (`TrapSpikeRunEntity` /
 * `createTrapSpikeRunMotion` / `stepTrapSpikeRun` in @monkeyluka/shared).
 * One `TrapSpikeRunView` per trap entity pairs the shared motion with its
 * Phaser game object, positioned in map-pixel coordinates inside the
 * scene's trap layer (a transform twin of room 0 — see create.ts), so it
 * maps to the canvas exactly like every other world object. Future trap
 * types get their own render modules beside this one, sharing the same
 * trap layer.
 *
 * The sprite sheet `Assets/trap/Trap_Spike_Run.png` is a 32×48 image: a
 * 2×3 grid of 16×16 cells, one frame per used cell, row-major — the same
 * packing as the player's jump sheet. Frames 0–4 are near-identical spike
 * strips (the subtle top-edge shimmer is the author's idle "run" pulse);
 * the last cell (frame 5) holds only a stray base sliver, so the looping
 * animation uses frames 0–4 and skips it, mirroring the jump sheet's
 * 5-of-6-used convention. The 16×16 frame matches the trap's 16px patrol
 * strip, so the sprite footprint is identical to the old red-circle
 * placeholder (radius `height / 2`) and to the shared kill probe
 * (`isBoxTouchingTrapSpikeRun`).
 */

import type Phaser from "phaser";
import {
  createTrapSpikeRunMotion,
  stepTrapSpikeRun,
  type TrapSpikeRunEntity,
  type TrapSpikeRunMotion,
} from "@monkeyluka/shared";

/** Texture key for the trap sheet, loaded by the jungle scene. */
export const TRAP_SPIKE_RUN_TEXTURE = "trap-spike-run";

/** Animation key registered by `registerTrapSpikeRunAnimations`. */
export const TRAP_SPIKE_RUN_ANIM = "trap-anim:spike-run";

/** Each sprite-sheet cell is 16×16 (same size as the trap's patrol strip). */
const FRAME_SIZE = 16;

/** The trap sheet is 2 cells wide (a 32×48 image). */
const TRAP_SPIKE_RUN_COLUMNS = 2;

/**
 * 5 of the 6 cells hold spike frames; the last cell (bottom right) is a
 * stray base sliver, so the loop skips it (see the module comment).
 */
const TRAP_SPIKE_RUN_FRAME_COUNT = 5;

/** Placeholder fill for the trap marker (replaced by the sprite sheet). */
export const TRAP_SPIKE_RUN_PLACEHOLDER_COLOR = 0xff0000;

/** The trap's marker: either the red-circle placeholder or a sprite. */
export type TrapSpikeRunGameObject =
  | Phaser.GameObjects.Arc
  | Phaser.GameObjects.Sprite;

/** One rendered trap: the shared motion plus its Phaser game object. */
export interface TrapSpikeRunView {
  trapSpikeRun: TrapSpikeRunEntity;
  motion: TrapSpikeRunMotion;
  gameObject: TrapSpikeRunGameObject;
}

export interface TrapSpikeRunViewOptions {
  /**
   * Sprite-sheet texture key; when set the trap renders that texture
   * instead of the red-circle placeholder. The scene defaults this to the
   * built-in `TRAP_SPIKE_RUN_TEXTURE` (the `Trap_Spike_Run.png` sheet it
   * preloads); the `JungleGameOptions.trapSpikeRunTexture` override swaps
   * in a different caller-loaded sheet (a static frame 0, no animation —
   * only the built-in sheet has its 2×3 layout registered).
   */
  texture?: string;
}

/**
 * Registers the trap sheet's frames and its looping idle animation. Call
 * once, after the trap sheet has finished loading and before any trap view
 * is spawned (create.ts calls it right before the view loop).
 */
export function registerTrapSpikeRunAnimations(scene: Phaser.Scene): void {
  const texture = scene.textures.get(TRAP_SPIKE_RUN_TEXTURE);
  for (let frame = 0; frame < TRAP_SPIKE_RUN_FRAME_COUNT; frame++) {
    texture.add(
      frame,
      0,
      (frame % TRAP_SPIKE_RUN_COLUMNS) * FRAME_SIZE,
      Math.floor(frame / TRAP_SPIKE_RUN_COLUMNS) * FRAME_SIZE,
      FRAME_SIZE,
      FRAME_SIZE,
    );
  }
  scene.anims.create({
    key: TRAP_SPIKE_RUN_ANIM,
    frames: scene.anims.generateFrameNumbers(TRAP_SPIKE_RUN_TEXTURE, {
      start: 0,
      end: TRAP_SPIKE_RUN_FRAME_COUNT - 1,
    }),
    frameRate: 8,
    repeat: -1,
  });
}

/**
 * Creates the view for one trap inside `layer` (the scene's trap layer — a
 * transform twin of room 0, see create.ts), starting the shared motion at
 * its initial position. The marker is a red circle of radius `height / 2`
 * (filling the patrol strip vertically) unless a sprite-sheet `texture`
 * is given — then it renders frame 0 of that texture, playing the built-in
 * looping spike animation when the texture is the default trap sheet.
 */
export function createTrapSpikeRunView(
  scene: Phaser.Scene,
  trapSpikeRun: TrapSpikeRunEntity,
  layer: Phaser.GameObjects.Container,
  options: TrapSpikeRunViewOptions = {},
): TrapSpikeRunView {
  const motion = createTrapSpikeRunMotion(trapSpikeRun);
  let gameObject: TrapSpikeRunGameObject;
  if (options.texture) {
    const sprite = scene.add.sprite(
      motion.x,
      motion.y,
      options.texture,
      0,
    );
    if (options.texture === TRAP_SPIKE_RUN_TEXTURE) {
      sprite.play(TRAP_SPIKE_RUN_ANIM);
    }
    gameObject = sprite;
  } else {
    gameObject = scene.add.arc(
      motion.x,
      motion.y,
      trapSpikeRun.height / 2,
      0,
      360,
      false,
      TRAP_SPIKE_RUN_PLACEHOLDER_COLOR,
      1,
    );
  }
  layer.add(gameObject);
  return { trapSpikeRun, motion, gameObject };
}

/**
 * Advances every trap's shared motion by `dt` seconds and moves its game
 * object to match (map-pixel coordinates; the layer's transform maps them
 * to the canvas like every other world object). `random` is the shared
 * speed-roll RNG injected for determinism (defaults to `Math.random`).
 */
export function updateTrapSpikeRunViews(
  views: readonly TrapSpikeRunView[],
  dt: number,
  random: () => number = Math.random,
): void {
  for (const view of views) {
    stepTrapSpikeRun(view.motion, view.trapSpikeRun, dt, random);
    view.gameObject.setPosition(view.motion.x, view.motion.y);
  }
}

// --- Debug overlay -------------------------------------------------------
//
// `createTrapSpikeRunDebug` draws each trap marker's lethal footprint in
// red: the `trap.height`-square AABB around the marker's current position
// — the exact box `isBoxTouchingTrapSpikeRun` probes against (the same
// `trap.height` the sprite/arc occupies), so a map author sees precisely
// how close a player can get before the kill fires. The marker sweeps, so
// the box is redrawn every frame at the marker's motion position.

/** Box color for the trap attack-radius debug overlay (red). */
export const TRAP_SPIKE_RUN_DEBUG_COLOR = 0xff0000;

export interface TrapSpikeRunDebugOptions {
  /** Show the attack-radius boxes on creation (default true). */
  enabled?: boolean;
  /** Attack-radius box color (default red). */
  radiusColor?: number;
  /** Line width in map-local pixels; scales with the trap layer (default 1). */
  lineWidth?: number;
}

export interface TrapSpikeRunDebug {
  /** Whether the boxes are currently visible. */
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  /**
   * Redraws every box around its view's CURRENT marker position. Call
   * after `updateTrapSpikeRunViews` each frame while the debug overlay
   * exists.
   */
  update(views: readonly TrapSpikeRunView[]): void;
  destroy(): void;
}

/**
 * Draws one red attack-radius box per trap marker, as children of the
 * trap `layer` (map-pixel coordinates, transform-matched to the markers):
 * the `trap.height`-square kill AABB centered on the marker's motion
 * position — the exact footprint `isBoxTouchingTrapSpikeRun` tests, so
 * the box is the player's lethal approach distance. Graphics are created
 * lazily per view (one box each, so a box could be hidden individually
 * later); each `update()` clears and re-strokes them at the marker's
 * current position.
 */
export function createTrapSpikeRunDebug(
  scene: Phaser.Scene,
  views: readonly TrapSpikeRunView[],
  layer: Phaser.GameObjects.Container,
  options: TrapSpikeRunDebugOptions = {},
): TrapSpikeRunDebug {
  const radiusColor = options.radiusColor ?? TRAP_SPIKE_RUN_DEBUG_COLOR;
  const lineWidth = options.lineWidth ?? 1;
  let enabled = options.enabled ?? true;
  const graphics = new Map<TrapSpikeRunView, Phaser.GameObjects.Graphics>();

  const box = (view: TrapSpikeRunView): void => {
    const g = graphics.get(view);
    if (!g) return;
    g.clear();
    if (!enabled) return;
    const { motion, trapSpikeRun } = view;
    const half = trapSpikeRun.height / 2;
    g.lineStyle(lineWidth, radiusColor, 1);
    // The kill AABB: `trap.height` square centered on the marker.
    g.strokeRect(
      motion.x - half,
      motion.y - half,
      trapSpikeRun.height,
      trapSpikeRun.height,
    );
  };

  const ensure = (view: TrapSpikeRunView): void => {
    if (graphics.has(view)) return;
    const g = scene.add.graphics();
    g.setVisible(enabled);
    graphics.set(view, g);
    layer.add(g);
    box(view);
  };
  for (const view of views) ensure(view);

  return {
    get enabled(): boolean {
      return enabled;
    },
    setEnabled(on: boolean): void {
      enabled = on;
      for (const g of graphics.values()) g.setVisible(on);
    },
    update(next: readonly TrapSpikeRunView[]): void {
      for (const view of next) ensure(view);
      for (const view of next) box(view);
    },
    destroy(): void {
      for (const g of graphics.values()) g.destroy();
      graphics.clear();
    },
  };
}