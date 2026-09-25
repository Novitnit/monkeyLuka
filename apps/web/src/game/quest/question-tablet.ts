/**
 * The question tablet: the world object that stands at every tile-315
 * (showquest signpost) cell, rendered from the `Assets/QuestionTablet.png`
 * sprite sheet (served via the `public/question-tablet.png` symlink — the
 * same pattern as `public/door.png`). The map renderer skips the 315
 * tileset art (`isQuestionTabletTileGid` in @monkeyluka/shared), so the
 * tablet is the signpost's only art.
 *
 * The sheet is a 112×128 image: a 7×4 grid of 16×32 cells, row-major — a
 * 1×2-tile footprint rendered at native 1:1 scale (the image is NOT
 * scaled down; the tablet keeps its full 32px height). Frame 0 is the
 * idle tablet (the question window up); the frames encode the two verdict
 * animations — frames 1–9 the CORRECT answer (the check draws in the
 * window, with two sparkle accents at frames 3 and 8) and frames 10–22
 * the WRONG answer (the red mark fades out, and the sheet's last frames
 * literally redraw the idle window, so the sequence ends back on frame 0).
 *
 * The quest box owns the lifecycle (see quest-box.ts). While a question
 * is up and unanswered the signpost shows frame 0; when `quest:result`
 * arrives the interaction-modal window lowers immediately and
 * `playVerdict(tx, ty, correct)` runs on the ONE signpost that asked (the
 * room names it in `quest:question`'s `tx`/`ty` — see interactions.ts):
 * correct plays frames 1–9, stopping on frame 9 (Phaser `repeat: 0` holds
 * the last frame, so the solved signpost keeps its check), wrong plays
 * frames 10–22 and returns the sprite to frame 0. Death questions carry
 * no tile, so no tablet animates for them.
 */

import type Phaser from "phaser";
import {
  TILE_SIZE,
  isQuestionTabletTileGid,
  type InteractionGrid,
} from "@monkeyluka/shared";

/** Texture key for the tablet sheet, loaded by the jungle scene. */
export const QUESTION_TABLET_TEXTURE = "question-tablet";

/** Animation keys registered by `registerQuestionTabletAnimations`. */
export const QUESTION_TABLET_CORRECT_ANIM = "question-tablet:correct";
export const QUESTION_TABLET_WRONG_ANIM = "question-tablet:wrong";

/** Each sheet cell is 16×32 (a 1×2-tile portrait object). */
const FRAME_WIDTH = 16;
const FRAME_HEIGHT = 32;
/** The sheet is 7 cells wide (a 112×128 image). */
const SHEET_COLUMNS = 7;
/** All 28 cells the sheet holds. */
const FRAME_COUNT = 28;

/** Idle frame (the tablet with its question window up). */
const IDLE_FRAME = 0;
/** Correct-answer frames: play once, hold on the last one (9). */
const CORRECT_FRAMES = { start: 1, end: 9 };
/** Wrong-answer frames: play once, then return to the idle frame. */
const WRONG_FRAMES = { start: 10, end: 22 };

/**
 * The sheet row the tablet's legs bottom out on (rows 28–31 are empty):
 * anchoring every sprite at that row puts its feet flush with the floor
 * the player stands on at the signpost.
 */
const LEG_BOTTOM_ROW = 27;

/**
 * Register the sheet's frames and the two verdict animations. Call once,
 * after the sheet has finished loading and before any tablet is spawned
 * (create.ts calls it right before the views are built).
 */
export function registerQuestionTabletAnimations(
  scene: Phaser.Scene,
): void {
  const texture = scene.textures.get(QUESTION_TABLET_TEXTURE);
  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    texture.add(
      frame,
      0,
      (frame % SHEET_COLUMNS) * FRAME_WIDTH,
      Math.floor(frame / SHEET_COLUMNS) * FRAME_HEIGHT,
      FRAME_WIDTH,
      FRAME_HEIGHT,
    );
  }
  scene.anims.create({
    key: QUESTION_TABLET_CORRECT_ANIM,
    frames: scene.anims.generateFrameNumbers(
      QUESTION_TABLET_TEXTURE,
      CORRECT_FRAMES,
    ),
    frameRate: 12,
    repeat: 0,
  });
  scene.anims.create({
    key: QUESTION_TABLET_WRONG_ANIM,
    frames: scene.anims.generateFrameNumbers(
      QUESTION_TABLET_TEXTURE,
      WRONG_FRAMES,
    ),
    frameRate: 12,
    repeat: 0,
  });
}

export interface QuestionTabletController {
  /**
   * Play the verdict on the signpost at grid cell (tx, ty): a correct
   * answer plays frames 1–9 and holds on frame 9 (the solved signpost
   * keeps its check), a wrong answer plays frames 10–22 and returns to
   * frame 0 so the signpost reads idle again.
   */
  playVerdict(tx: number, ty: number, correct: boolean): void;
}

/**
 * Create one tablet sprite per tile-315 cell in the interaction grid,
 * inside `layer` (the scene's question-tablet layer — a transform twin of
 * room 0, see create.ts). Each sprite is the signpost: frame 0 at native
 * 1:1 size, anchored at `LEG_BOTTOM_ROW` so its feet rest on the floor of
 * the cell the player stands on (the signpost's base is flush with that
 * standing floor). The returned controller lets the quest box play the
 * verdict animation on the single signpost that asked the question.
 */
export function createQuestionTabletViews(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  interactions: InteractionGrid,
): QuestionTabletController {
  const views = new Map<string, Phaser.GameObjects.Sprite>();
  for (let index = 0; index < interactions.gids.length; index++) {
    if (!isQuestionTabletTileGid(interactions.gids[index] ?? 0)) continue;
    const tx = index % interactions.width;
    const ty = Math.floor(index / interactions.width);

    const sprite = scene.add.sprite(
      tx * TILE_SIZE + TILE_SIZE / 2,
      (ty + 1) * TILE_SIZE,
      QUESTION_TABLET_TEXTURE,
      IDLE_FRAME,
    );
    // Native 1:1 — the 16×32 image keeps its full height (a 1×2-tile
    // object standing on the floor at the signpost). Never scaled down.
    sprite.setScale(1);
    sprite.setOrigin(0.5, LEG_BOTTOM_ROW / FRAME_HEIGHT);
    layer.add(sprite);
    views.set(`${tx}:${ty}`, sprite);
  }

  return {
    playVerdict(tx, ty, correct) {
      const sprite = views.get(`${tx}:${ty}`);
      if (!sprite) return;
      if (sprite.anims.isPlaying) sprite.stop();
      if (correct) {
        // `repeat: 0` stops the animation on frame 9, so the check stays
        // on the solved signpost.
        sprite.play(QUESTION_TABLET_CORRECT_ANIM);
      } else {
        sprite.play(QUESTION_TABLET_WRONG_ANIM);
        // The animation's last frames already redraw the idle window, but
        // snap to frame 0 explicitly on completion so the signpost is
        // cleanly idle for the player's retry.
        sprite.once(
          `animationcomplete-${QUESTION_TABLET_WRONG_ANIM}`,
          () => {
            if (sprite.anims.isPlaying) sprite.stop();
            sprite.setFrame(IDLE_FRAME);
          },
        );
      }
    },
  };
}