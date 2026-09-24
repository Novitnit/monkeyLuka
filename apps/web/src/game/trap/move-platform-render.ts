/**
 * Phaser side of the move_platform movable platforms: the `movePlatformF.png`
 * sprite sheet driven by the shared platform model (`MovePlatformEntity` /
 * `createMovePlatformMotion` / `stepMovePlatform` in @monkeyluka/shared).
 * One `MovePlatformView` per platform entity pairs the shared motion with
 * its Phaser game object, positioned in map-pixel coordinates inside the
 * scene's trap layer (a transform twin of room 0 — see create.ts), so it
 * maps to the canvas exactly like every other world object.
 *
 * The sprite sheet `Assets/trap/movePlatformF.png` is a 256×16 image: a
 * single row of eight 32×16 cells, one frame per cell — each frame is
 * ALREADY the platform's full 32×16 footprint (no scaling). The slab
 * shape stays constant on top (the standing surface is the frame's top
 * edge) while a lower tooth retracts and regrows across the loop — a
 * symmetric cycle (frames 0–3 mirror 7–4), the author's idle
 * "breathing" animation. The placeholder/debug geometry use the same
 * 32×16 box. Unlike the lethal spike-run marker, the platform grants
 * support, not death: the update loop snaps a player whose feet probe
 * the slab top to it as ground, but never carries the player along (see
 * `supportPlayerOnMovePlatform` in the shared model).
 */

import type Phaser from "phaser";
import {
  MOVE_PLATFORM_HEIGHT,
  MOVE_PLATFORM_WIDTH,
  createMovePlatformMotion,
  stepMovePlatform,
  type MovePlatformEntity,
  type MovePlatformMotion,
} from "@monkeyluka/shared";

/** Texture key for the platform sheet, loaded by the jungle scene. */
export const MOVE_PLATFORM_TEXTURE = "move-platform";

/** Animation key registered by `registerMovePlatformAnimations`. */
export const MOVE_PLATFORM_ANIM = "trap-anim:move-platform";

/** Each sprite-sheet frame is 32×16 — exactly the platform's footprint. */
const FRAME_WIDTH = MOVE_PLATFORM_WIDTH;
const FRAME_HEIGHT = MOVE_PLATFORM_HEIGHT;

/** The sheet is a single row of 8 frames (a 256×16 image). */
const MOVE_PLATFORM_COLUMNS = 8;

/** All 8 cells hold the slab animation (no stray cells to skip). */
const MOVE_PLATFORM_FRAME_COUNT = 8;

/** Placeholder fill for the platform (replaced by the sprite sheet). */
export const MOVE_PLATFORM_PLACEHOLDER_COLOR = 0x6ec5ff;

/** The platform's marker: either the rectangle placeholder or a sprite. */
export type MovePlatformGameObject =
  | Phaser.GameObjects.Rectangle
  | Phaser.GameObjects.Sprite;

/** One rendered platform: the shared motion plus its Phaser game object. */
export interface MovePlatformView {
  platform: MovePlatformEntity;
  motion: MovePlatformMotion;
  gameObject: MovePlatformGameObject;
}

export interface MovePlatformViewOptions {
  /**
   * Sprite-sheet texture key; when set the platform renders that texture
   * instead of the rectangle placeholder. The scene defaults this to the
   * built-in `MOVE_PLATFORM_TEXTURE` (the `movePlatformF.png` sheet it
   * preloads); the `JungleGameOptions.movePlatformTexture` override swaps
   * in a different caller-loaded sheet (a static frame 0, no animation —
   * only the built-in sheet has its 8-frame row layout registered).
   */
  texture?: string;
}

/**
 * Registers the platform sheet's frames and its looping idle animation.
 * Call once, after the platform sheet has finished loading and before any
 * platform view is spawned (create.ts calls it right before the view
 * loop). The 8 cells run left-to-right in the single row: frame `i` sits
 * at `(i * 32, 0)`, each already the full 32×16 footprint.
 */
export function registerMovePlatformAnimations(scene: Phaser.Scene): void {
  const texture = scene.textures.get(MOVE_PLATFORM_TEXTURE);
  for (let frame = 0; frame < MOVE_PLATFORM_FRAME_COUNT; frame++) {
    texture.add(
      frame,
      0,
      (frame % MOVE_PLATFORM_COLUMNS) * FRAME_WIDTH,
      Math.floor(frame / MOVE_PLATFORM_COLUMNS) * FRAME_HEIGHT,
      FRAME_WIDTH,
      FRAME_HEIGHT,
    );
  }
  scene.anims.create({
    key: MOVE_PLATFORM_ANIM,
    frames: scene.anims.generateFrameNumbers(MOVE_PLATFORM_TEXTURE, {
      start: 0,
      end: MOVE_PLATFORM_FRAME_COUNT - 1,
    }),
    frameRate: 32,
    repeat: -1,
  });
}

/**
 * Creates the view for one platform inside `layer` (the scene's trap layer —
 * a transform twin of room 0, see create.ts), starting the shared motion at
 * its initial position. The marker is the 32×16 `MOVE_PLATFORM_WIDTH`×
 * `MOVE_PLATFORM_HEIGHT` slab (a rectangle placeholder) unless a
 * sprite-sheet `texture` is given — then frame 0 of that texture at its
 * native 32×16 footprint (no scaling), playing the built-in looping slab
 * animation when the texture is the default move-platform sheet.
 */
export function createMovePlatformView(
  scene: Phaser.Scene,
  platform: MovePlatformEntity,
  layer: Phaser.GameObjects.Container,
  options: MovePlatformViewOptions = {},
): MovePlatformView {
  const motion = createMovePlatformMotion(platform);
  let gameObject: MovePlatformGameObject;
  if (options.texture) {
    const sprite = scene.add.sprite(motion.x, motion.y, options.texture, 0);
    // Each frame is already the full 32×16 slab — render it unscaled (a
    // caller-supplied custom sheet must likewise provide 32×16 frames).
    if (options.texture === MOVE_PLATFORM_TEXTURE) {
      sprite.play(MOVE_PLATFORM_ANIM);
    }
    gameObject = sprite;
  } else {
    gameObject = scene.add.rectangle(
      motion.x,
      motion.y,
      MOVE_PLATFORM_WIDTH,
      MOVE_PLATFORM_HEIGHT,
      MOVE_PLATFORM_PLACEHOLDER_COLOR,
      1,
    );
  }
  layer.add(gameObject);
  return { platform, motion, gameObject };
}

/**
 * Advances every platform's shared motion by `dt` seconds and moves its
 * game object to match (map-pixel coordinates; the layer's transform maps
 * them to the canvas like every other world object). The slab sweeps its
 * patrol lane independently of the connection state — platforms are world
 * objects, never reported to the server (the player's support, not the
 * platform, is what the reports describe).
 */
export function updateMovePlatformViews(
  views: readonly MovePlatformView[],
  dt: number,
): void {
  for (const view of views) {
    stepMovePlatform(view.motion, view.platform, dt);
    view.gameObject.setPosition(view.motion.x, view.motion.y);
  }
}

// --- Debug overlay -------------------------------------------------------
//
// `createMovePlatformDebug` draws each platform's patrol LANE (the full
// object rect the slab sweeps, a faint outline) plus the slab's CURRENT
// position (the 32×16 support surface, a box at the motion position) —
// the exact geometry `isBoxOnMovePlatform` probes, so a map author sees
// where the player can stand and how far the slab will take them. The
// slab sweeps, so both are redrawn every frame.

/** Color for the platform debug overlay (light blue). */
export const MOVE_PLATFORM_DEBUG_COLOR = 0x6dd8ff;

export interface MovePlatformDebugOptions {
  /** Show the overlays on creation (default true). */
  enabled?: boolean;
  /** Overlay color (default light blue). */
  color?: number;
  /** Line width in map-local pixels; scales with the trap layer (default 1). */
  lineWidth?: number;
}

export interface MovePlatformDebug {
  /** Whether the overlays are currently visible. */
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  /**
   * Redraws every lane + slab around its view's CURRENT motion position.
   * Call after `updateMovePlatformViews` each frame while the debug
   * overlay exists.
   */
  update(views: readonly MovePlatformView[]): void;
  destroy(): void;
}

/**
 * Draws one lane outline + one current-slab box per platform, as children
 * of the trap `layer` (map-pixel coordinates, transform-matched to the
 * markers). Graphics are created lazily per view; each `update()` clears
 * and re-strokes them at the motion's current position.
 */
export function createMovePlatformDebug(
  scene: Phaser.Scene,
  views: readonly MovePlatformView[],
  layer: Phaser.GameObjects.Container,
  options: MovePlatformDebugOptions = {},
): MovePlatformDebug {
  const color = options.color ?? MOVE_PLATFORM_DEBUG_COLOR;
  const lineWidth = options.lineWidth ?? 1;
  let enabled = options.enabled ?? true;
  const graphics = new Map<MovePlatformView, Phaser.GameObjects.Graphics>();

  const draw = (view: MovePlatformView): void => {
    const g = graphics.get(view);
    if (!g) return;
    g.clear();
    if (!enabled) return;
    const { platform, motion } = view;
    // The patrol lane: the object rect the slab sweeps (faint outline).
    g.lineStyle(lineWidth, color, 0.4);
    g.strokeRect(platform.x, platform.y, platform.width, platform.height);
    // The current slab: the 32×16 support surface.
    const halfW = MOVE_PLATFORM_WIDTH / 2;
    const halfH = MOVE_PLATFORM_HEIGHT / 2;
    g.lineStyle(lineWidth, color, 1);
    g.strokeRect(
      motion.x - halfW,
      motion.y - halfH,
      MOVE_PLATFORM_WIDTH,
      MOVE_PLATFORM_HEIGHT,
    );
  };

  const ensure = (view: MovePlatformView): void => {
    if (graphics.has(view)) return;
    const g = scene.add.graphics();
    g.setVisible(enabled);
    graphics.set(view, g);
    layer.add(g);
    draw(view);
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
    update(next: readonly MovePlatformView[]): void {
      for (const view of next) ensure(view);
      for (const view of next) draw(view);
    },
    destroy(): void {
      for (const g of graphics.values()) g.destroy();
      graphics.clear();
    },
  };
}