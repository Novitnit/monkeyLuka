/**
 * Phaser side of the player: a monkey sprite that lives inside a room
 * container. Its sprite sheets are served from `public/player` (a symlink to
 * `Assets/player/sheets`), and spawn coordinates are room-local because the
 * sprite is a child of the room container and inherits its position/scale.
 */

import type Phaser from "phaser";

/** Sprite-sheet texture key the jungle scene loads for the player. */
export const PLAYER_TEXTURE = "player-idle";

/** Player spawn position in room-local pixels (the jungle is one room). */
export const PLAYER_SPAWN = { x: 96, y: 176 } as const;

/** The jungle player — the monkey sprite the game drives. */
export interface Player {
  sprite: Phaser.GameObjects.Sprite;
}

/**
 * Spawns the player sprite at `PLAYER_SPAWN` inside `room` and returns its
 * typed handle. Adding it to the room container inherits the room's
 * scale/position, which is why the spawn coordinates are room-local.
 */
export function createPlayer(
  scene: Phaser.Scene,
  room: Phaser.GameObjects.Container,
): Player {
  const sprite = scene.add.sprite(
    PLAYER_SPAWN.x,
    PLAYER_SPAWN.y,
    PLAYER_TEXTURE,
  );
  room.add(sprite);
  return { sprite };
}