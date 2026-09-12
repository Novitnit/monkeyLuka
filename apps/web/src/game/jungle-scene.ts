/**
 * The Phaser jungle scene: loads the Tiled map + player sprite sheets,
 * renders the rooms, spawns the player, then drives the per-frame loop —
 * input, client-side prediction, ~20 Hz server reports, snapshot
 * reconciliation and remote-player easing.
 *
 * Built by `createJungleGame` (jungle-game.ts) right after its dynamic
 * Phaser import; the factory takes the Phaser namespace as a parameter so
 * this module never touches `window` at module scope (SSR-safe).
 */

import type Phaser from "phaser";
import {
  COLLISION_LAYER_NAME,
  PLAYER_CHECKPOINT_MESSAGE,
  PLAYER_INPUT_MESSAGE,
  buildTileGrid,
  type PlayerInput,
  type SolidGrid,
} from "@monkeyluka/shared";
import {
  ROOM_HEIGHT,
  ROOM_WIDTH,
  resolveTiledMap,
  type RawTiledMap,
} from "./map/tiled-map";
import { renderTiledMap } from "./map/map-renderer";
import { createPlayer, PLAYER_SPAWN, PLAYER_TEXTURE, SNAP_DISTANCE, type Player } from "./player/player";
import {
  PLAYER_JUMP_TEXTURE,
  PLAYER_JOG_TEXTURE,
  registerPlayerAnimations,
} from "./player/animations";
import { buildCollisionGeometry } from "./collision/collision-geometry";
import { createCollisionDebug } from "./collision/collision-debug";
import {
  syncRemotePlayers,
  type RemotePlayerView,
} from "./player/remote-players";
import type { JungleGameOptions, JungleRoom } from "./jungle-game";

/** Where the Tiled map and its tileset assets are served from. */
const MAP_DIR = "/map";
const MAP_FILE = "main.json";

/** Where the player sprite sheets are served from. */
const PLAYER_DIR = "/player";

/** How often the client reports its state to the server, ms (~20 Hz). */
const INPUT_INTERVAL_MS = 50;

/**
 * Whether the NEXT_PUBLIC_DEBUG flag is "1" or "true" (case-insensitive).
 * Plain `DEBUG` is server-only in Next.js — the browser client only sees
 * NEXT_PUBLIC_-prefixed env vars (inlined at build time). Gates the debug
 * extras: the collision overlay and the R-key checkpoint return.
 */
function isDebugEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_DEBUG;
  return flag === "1" || flag?.toLowerCase() === "true";
}

function isCollisionDebugEnabled(): boolean {
  return isDebugEnabled();
}

/**
 * Builds the single-scene config for the jungle room. `phaser` is the
 * runtime namespace returned by `await import("phaser")` in
 * `createJungleGame`.
 *
 * Networking model: collision is client-side — the client simulates locally
 * with the shared physics and renders that immediately. It streams its input
 * plus the predicted state to the server (`PLAYER_INPUT_MESSAGE`); the
 * server validates the reported trajectory and broadcasts accepted state in
 * `JungleState`. The local player reconciles against that broadcast (a
 * rejected report visibly stops it) and remote players render straight from it.
 */
export function buildJungleScene(
  phaser: typeof Phaser,
  room: JungleRoom,
  options: JungleGameOptions,
): Phaser.Types.Scenes.CreateSceneFromObjectConfig {
  // Scene-scoped state shared between create() and update().
  let player: Player | null = null;
  let grid: SolidGrid | null = null;
  let container: Phaser.GameObjects.Container | null = null;
  let cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  let keyA: Phaser.Input.Keyboard.Key | null = null;
  let keyD: Phaser.Input.Keyboard.Key | null = null;
  let keyW: Phaser.Input.Keyboard.Key | null = null;
  /** Debug only (isDebugEnabled): R teleports back here. */
  const checkpoint = { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y };
  let keyR: Phaser.Input.Keyboard.Key | null = null;
  /**
   * True between an R press and the server's snapshot confirming the jump.
   * While pending, snapshot reconciliation is skipped: for ~one RTT the
   * broadcast still holds the pre-teleport position, and snapping to it
   * would undo the teleport and make the next report read as a
   * teleport+speed violation against the re-baselined spawn.
   */
  let checkpointPending = false;
  let inputSeq = 0;
  let inputAccumulator = 0;
  const remotePlayers = new Map<string, RemotePlayerView>();

  return {
    create(this: Phaser.Scene) {
      (window as unknown as Record<string, unknown>).__jungleScene = this;

      this.cameras.main.setBackgroundColor("#0b0e14");

      const me = room.state?.players.get(room.sessionId);
      const name = me?.name ?? "unknown";
      (window as unknown as Record<string, unknown>).__jungleName = name;

      // Load the Tiled map plus the player sprite sheets, then resolve its
      // tilesets, render the rooms, and drop the player at spawn.
      this.load.json("jungle-map", `${MAP_DIR}/${MAP_FILE}`);
      this.load.image(PLAYER_TEXTURE, `${PLAYER_DIR}/sheets/idle.png`);
      this.load.image(PLAYER_JOG_TEXTURE, `${PLAYER_DIR}/sheets/jog.png`);
      this.load.image(PLAYER_JUMP_TEXTURE, `${PLAYER_DIR}/sheets/jump.png`);
      this.load.once(phaser.Loader.Events.COMPLETE, () => {
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

            // Collision geometry: boundary edges of the collision blocks
            // (green = vertical wall edges, blue = horizontal floor edges)
            // plus the 109/110 slope lines (orange). The same `layer1` gids
            // feed the physics grid below.
            const collision = buildCollisionGeometry(map);
            const collisionDebug = createCollisionDebug(
              this,
              map,
              render.rooms,
              collision,
              { enabled: options.collisionDebug ?? isCollisionDebugEnabled() },
            );
            (window as unknown as Record<string, unknown>).__jungleCollision =
              collision;
            (window as unknown as Record<string, unknown>).__jungleCollisionDebug =
              collisionDebug;

            // The physics grid is built from the same layer the server
            // reads from Assets/map/main.json, so prediction can't diverge
            // on geometry.
            const layer = map.layers.find(
              (candidate) => candidate.name === COLLISION_LAYER_NAME,
            );
            if (!layer) {
              throw new Error(
                `Map has no "${COLLISION_LAYER_NAME}" collision layer`,
              );
            }
            grid = buildTileGrid(layer);
            container = render.rooms[0];

            // Register the idle/jog/jump animations (needs the sheets that
            // just finished loading) before any sprite is spawned.
            registerPlayerAnimations(this);

            // Drop the player into the first (only) room at spawn.
            player = createPlayer(this, container, grid);
            (window as unknown as Record<string, unknown>).__junglePlayer =
              player.sprite;

            // Resumed session: start from where the server last accepted this
            // player instead of the default spawn, so the first report is not
            // a teleport and the sprite doesn't pop. If the state hasn't
            // arrived yet, the update loop's snapshot sync snaps it in.
            const resumed = room.state?.players.get(room.sessionId);
            if (resumed) {
              player.applyServerSnapshot({
                x: resumed.x,
                y: resumed.y,
                vx: resumed.vx,
                vy: resumed.vy,
                grounded: resumed.grounded,
                facing: resumed.facing,
              });
            }

            // Keyboard controls: arrows/WASD to move, Space/Up/W to jump.
            const keyboard = this.input.keyboard;
            cursors = keyboard?.createCursorKeys() ?? null;
            keyA = keyboard?.addKey(phaser.Input.Keyboard.KeyCodes.A) ?? null;
            keyD = keyboard?.addKey(phaser.Input.Keyboard.KeyCodes.D) ?? null;
            keyW = keyboard?.addKey(phaser.Input.Keyboard.KeyCodes.W) ?? null;
            // Debug only: R returns to the checkpoint. The room always
            // accepts the checkpoint message (its target is the
            // server-chosen spawn, so it can't bypass the anti-cheat) and
            // re-baselines its validation so the jump isn't a violation.
            keyR = isDebugEnabled()
              ? keyboard?.addKey(phaser.Input.Keyboard.KeyCodes.R) ?? null
              : null;
          } catch (err) {
            console.error("Failed to load the jungle map:", err);
          }
        })();
      });
      this.load.start();
    },

    update(this: Phaser.Scene, _time: number, delta: number) {
      if (!player || !grid || !container) return;

      const dt = Math.min(delta, 50) / 1000;

      // Connection dropped (SDK auto-reconnecting in the background): freeze
      // local simulation. The server has already stopped this player (no
      // reports arrive), and simulating on would pile up position reports
      // that flush as a burst on reconnect — near-zero wall-clock dt between
      // them looks exactly like a speed hack. Rendering continues so the
      // monkey stays visible where it stopped.
      if (!room.connection.isOpen) {
        player.render(dt);
        syncRemotePlayers(this, room, remotePlayers, container, dt);
        return;
      }

      // --- Read input (edge-triggered jump). ---
      const left = Boolean(cursors?.left.isDown || keyA?.isDown);
      const right = Boolean(cursors?.right.isDown || keyD?.isDown);
      const jumpPressed = Boolean(
        (cursors &&
          phaser.Input.Keyboard.JustDown(cursors.up)) ||
          (cursors &&
            phaser.Input.Keyboard.JustDown(cursors.space)) ||
          (keyW && phaser.Input.Keyboard.JustDown(keyW)),
      );

      // --- Debug: R returns to the checkpoint. Only registered when
      // NEXT_PUBLIC_DEBUG is on; the room's checkpoint handler re-baselines
      // its validation at the spawn so the jump isn't a violation. ---
      if (keyR && phaser.Input.Keyboard.JustDown(keyR)) {
        player.teleportTo(checkpoint.x, checkpoint.y);
        checkpointPending = true;
        room.send(PLAYER_CHECKPOINT_MESSAGE, {});
      }

      // --- Local simulation (shared physics; collision is client-side). ---
      const input: PlayerInput = { left, right, jump: jumpPressed };
      player.setInput(input);
      player.update(dt);

      // --- Report the predicted state to the server (~20 Hz). Collision is
      // client-side: the server validates this reported trajectory and
      // broadcasts it back; a report that fails validation stops the
      // player. ---
      inputAccumulator += delta;
      if (inputAccumulator >= INPUT_INTERVAL_MS) {
        inputAccumulator %= INPUT_INTERVAL_MS;
        room.send(PLAYER_INPUT_MESSAGE, {
          seq: ++inputSeq,
          px: player.physics.x,
          py: player.physics.y,
          vx: player.physics.vx,
          vy: player.physics.vy,
          grounded: player.physics.grounded,
          facing: player.physics.facing,
        });
      }

      // --- Reconcile against the authoritative snapshot. While a checkpoint
      // jump is pending, the broadcast still holds the pre-teleport position
      // (~one RTT stale), so reconciliation is frozen until it confirms the
      // jump; otherwise the snap-back generates a teleport+speed violation.
      // Reports keep flowing meanwhile — they are all sent from the spawn
      // point and ordered after the checkpoint message, so the re-baselined
      // server accepts them. ---
      const mine = room.state.players.get(room.sessionId);
      if (mine) {
        if (
          checkpointPending &&
          Math.hypot(mine.x - checkpoint.x, mine.y - checkpoint.y) <=
            SNAP_DISTANCE
        ) {
          checkpointPending = false;
        }
        if (!checkpointPending) {
          player.applyServerSnapshot({
            x: mine.x,
            y: mine.y,
            vx: mine.vx,
            vy: mine.vy,
            grounded: mine.grounded,
            facing: mine.facing,
          });
        }
      }
      player.render(dt);

      syncRemotePlayers(this, room, remotePlayers, container, dt);
    },
  };
}
