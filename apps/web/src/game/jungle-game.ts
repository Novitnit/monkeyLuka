import type Phaser from "phaser";
import type { Room } from "@colyseus/sdk";
import type { JungleRoomState } from "@monkeyluka/shared";
import {
  ROOM_HEIGHT,
  ROOM_WIDTH,
  resolveTiledMap,
  type RawTiledMap,
} from "./map/tiled-map";
import { renderTiledMap } from "./map/map-renderer";
import { createPlayer, PLAYER_TEXTURE } from "./player/player";
import { buildCollisionGeometry } from "./collision/collision-geometry";
import { createCollisionDebug } from "./collision/collision-debug";

/** A joined jungle room, typed with its synced state. */
export type JungleRoom = Room<unknown, JungleRoomState>;

/** Where the Tiled map and its tileset assets are served from. */
const MAP_DIR = "/map";
const MAP_FILE = "main.json";

/** Where the player sprite sheets are served from. */
const PLAYER_DIR = "/player";

/** Options for booting the jungle game. */
export interface JungleGameOptions {
  /**
   * Draw the collision-geometry debug lines (green vertical walls, blue
   * horizontal floors, orange slopes). Default true — disable via
   * `__jungleCollisionDebug.setEnabled(false)` or pass false here.
   */
  collisionDebug?: boolean;
}

/**
 * Boot the Phaser jungle client inside `parent` and return the game instance.
 *
 * Phaser is imported dynamically on purpose: its bundle touches `window` at
 * module scope, so it must never load during server-side rendering. This
 * function only ever runs from a browser effect.
 */
export async function createJungleGame(
  parent: HTMLElement,
  room: JungleRoom,
  options: JungleGameOptions = {},
): Promise<Phaser.Game> {
  const Phaser = await import("phaser");

  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#0b0e14",
    width: 1280,
    height: 720,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: {
      create(this: Phaser.Scene) {
        const { width, height } = this.scale;

        (window as unknown as Record<string, unknown>).__jungleScene = this;

        this.cameras.main.setBackgroundColor("#0b0e14");

        const me = room.state?.players.get(room.sessionId);
        const name = me?.name ?? "unknown";

        // Load the Tiled map plus the player sprite, then resolve its
        // tilesets, render the rooms, and drop the player at spawn.
        this.load.json("jungle-map", `${MAP_DIR}/${MAP_FILE}`);
        this.load.image(PLAYER_TEXTURE, `${PLAYER_DIR}/sheets/idle.png`);
        this.load.once(Phaser.Loader.Events.COMPLETE, () => {
          void (async () => {
            try {
              const raw = this.cache.json.get("jungle-map") as RawTiledMap;
              const map = await resolveTiledMap(MAP_DIR, raw);

              const render = renderTiledMap(this, map, {
                roomWidth: ROOM_WIDTH,
                roomHeight: ROOM_HEIGHT,
              });

              (window as unknown as Record<string, unknown>).__jungleRender = render;
              (window as unknown as Record<string, unknown>).__jungleMap = map;

              // Drop the player into the first (only) room at spawn.
              const player = createPlayer(this, render.rooms[0]);
              (window as unknown as Record<string, unknown>).__junglePlayer =
                player.sprite;

              // Collision debug overlay: boundary edges of the collision
              // blocks (green = vertical wall edges, blue = horizontal floor
              // edges) plus the 109/110 slope lines (orange) where they take
              // over a block boundary. The geometry is the future collision
              // input.
              const collision = buildCollisionGeometry(map);
              const collisionDebug = createCollisionDebug(
                this,
                map,
                render.rooms,
                collision,
                {
                  enabled: options.collisionDebug ?? true,
                },
              );
              (window as unknown as Record<string, unknown>).__jungleCollision =
                collision;
              (window as unknown as Record<string, unknown>).__jungleCollisionDebug =
                collisionDebug;
            } catch (err) {
              console.error("Failed to load the jungle map:", err);
            }
          })();
        });
        this.load.start();
      },
    },
  });
}
