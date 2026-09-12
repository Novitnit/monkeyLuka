/**
 * Rendering of other players in the room: one sprite per remote session,
 * each easing toward its authoritative server position. Remote positions
 * come straight from the `PlayerInfo` broadcast — no local prediction, no
 * reconciliation.
 */

import type Phaser from "phaser";
import type { JungleRoom } from "../jungle-game";
import { PLAYER_TEXTURE } from "./player";
import { setPlayerAnimation } from "./animations";

/** Remote players ease toward their latest server position; rate per second. */
const REMOTE_LERP_RATE = 12;

/** A remote player's sprite + the server position it eases toward. */
export interface RemotePlayerView {
  sprite: Phaser.GameObjects.Sprite;
  targetX: number;
  targetY: number;
}

/**
 * Keeps one sprite per other player in the room, easing each toward its
 * server position. Called from the scene's update loop with the frame
 * delta; drops sprites for players who left.
 */
export function syncRemotePlayers(
  scene: Phaser.Scene,
  room: JungleRoom,
  views: Map<string, RemotePlayerView>,
  container: Phaser.GameObjects.Container,
  dt: number,
): void {
  const ease = Math.min(1, REMOTE_LERP_RATE * dt);

  for (const [sessionId, info] of room.state.players) {
    if (sessionId === room.sessionId) continue;
    let view = views.get(sessionId);
    if (!view) {
      const sprite = scene.add.sprite(info.x, info.y, PLAYER_TEXTURE);
      sprite.setDepth(9);
      container.add(sprite);
      view = { sprite, targetX: info.x, targetY: info.y };
      views.set(sessionId, view);
    }
    view.targetX = info.x;
    view.targetY = info.y;
    view.sprite.setFlipX(info.facing < 0);
    // Remote animation state comes straight from the authoritative broadcast.
    setPlayerAnimation(view.sprite, info.grounded, info.vx, info.clinging);
  }

  // Remove sprites whose players left the room.
  for (const [sessionId, view] of views) {
    if (!room.state.players.has(sessionId)) {
      view.sprite.destroy();
      views.delete(sessionId);
    }
  }

  for (const view of views.values()) {
    view.sprite.x += (view.targetX - view.sprite.x) * ease;
    view.sprite.y += (view.targetY - view.sprite.y) * ease;
  }
}
