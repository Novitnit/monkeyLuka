/**
 * The scene's `create()` callback: loads the Tiled map JSON + player sprite
 * sheets, resolves tilesets and renders the rooms, builds the collision
 * grid/geometry, spawns the local player, and registers keyboard controls.
 * Everything the world build produces is committed to `state` so `update()`
 * (update.ts) can drive it the next frame.
 *
 * `this` is the live Phaser scene; the Phaser namespace is passed in so the
 * module never touches `window` at module scope (SSR-safe).
 */

import type Phaser from "phaser";
import {
  COLLISION_LAYER_NAME,
  ROOM_OBJECT_GROUP_NAME,
  buildDoorEntities,
  buildInteractionGrid,
  buildTileGrid,
  groupRoomObjectsByName,
} from "@monkeyluka/shared";
import {
  ROOM_HEIGHT,
  ROOM_WIDTH,
  resolveTiledMap,
  type RawTiledMap,
} from "../map/tiled-map";
import { renderTiledMap } from "../map/map-renderer";
import { createPlayer, PLAYER_TEXTURE } from "../player/player";
import {
  PLAYER_CLING_TEXTURE,
  PLAYER_JOG_TEXTURE,
  PLAYER_JUMP_TEXTURE,
  registerPlayerAnimations,
} from "../player/animations";
import { buildCollisionGeometry } from "../collision/collision-geometry";
import { createCollisionDebug } from "../collision/collision-debug";
import { createDoorDebug } from "../door/door-debug";
import { createQuestBox } from "../quest/quest-box";
import type { JungleGameOptions, JungleRoom } from "../jungle-game";
import { MAP_DIR, MAP_FILE, PLAYER_DIR } from "./constants";
import {
  isCollisionDebugEnabled,
  isDebugEnabled,
  isDoorDebugEnabled,
  setDebugHandle,
} from "./debug";
import type { JungleSceneState } from "./state";

/**
 * Builds the `create(this: Phaser.Scene)` callback for the jungle scene.
 * Called once by Phaser when the scene starts.
 */
export function createSceneCreate(
  phaser: typeof Phaser,
  room: JungleRoom,
  options: JungleGameOptions,
  state: JungleSceneState,
): (this: Phaser.Scene) => void {
  return function create(this: Phaser.Scene): void {
    setDebugHandle("__jungleScene", this);

    this.cameras.main.setBackgroundColor("#0b0e14");

    const me = room.state?.players.get(room.sessionId);
    const name = me?.name ?? "unknown";
    setDebugHandle("__jungleName", name);

    // Load the Tiled map plus the player sprite sheets, then resolve its
    // tilesets, render the rooms, and drop the player at spawn.
    this.load.json("jungle-map", `${MAP_DIR}/${MAP_FILE}`);
    this.load.image(PLAYER_TEXTURE, `${PLAYER_DIR}/sheets/idle.png`);
    this.load.image(PLAYER_CLING_TEXTURE, `${PLAYER_DIR}/sheets/cling.png`);
    this.load.image(PLAYER_JOG_TEXTURE, `${PLAYER_DIR}/sheets/jog.png`);
    this.load.image(PLAYER_JUMP_TEXTURE, `${PLAYER_DIR}/sheets/jump.png`);
    this.load.once(phaser.Loader.Events.COMPLETE, () => {
      void (async () => {
        try {
          const raw = this.cache.json.get("jungle-map") as RawTiledMap;
          const map = await resolveTiledMap(MAP_DIR, raw);

          // The world is one continuous map: rooms must abut exactly (gap
          // 0) so tile, physics, and camera coordinates line up across the
          // room seams. ROOM_WIDTH is the designed 480px room and the
          // renderer scales it to exactly the 1280px camera width
          // (scale = canvasWidth / ROOM_WIDTH), so each rendered room is
          // exactly the viewport and the next room never peeks in.
          const render = renderTiledMap(this, map, {
            roomWidth: ROOM_WIDTH,
            roomHeight: ROOM_HEIGHT,
            gap: 0,
          });

          setDebugHandle("__jungleRender", render);
          setDebugHandle("__jungleMap", map);

          // Collision geometry: boundary edges of the collision blocks
          // (green = vertical wall edges, blue = horizontal floor edges)
          // plus the 110/109/262/287 slope lines (orange). The same
          // `layer1` gids feed the physics grid below.
          const collision = buildCollisionGeometry(map);
          const collisionDebug = createCollisionDebug(
            this,
            map,
            render.rooms,
            collision,
            { enabled: options.collisionDebug ?? isCollisionDebugEnabled() },
          );
          setDebugHandle("__jungleCollision", collision);
          setDebugHandle("__jungleCollisionDebug", collisionDebug);
          state.collisionDebug = collisionDebug;

          // The physics grid is built from the same layer the server reads
          // from Assets/map/main.json, so prediction can't diverge on
          // geometry.
          const layer = map.layers.find(
            (candidate) => candidate.name === COLLISION_LAYER_NAME,
          );
          if (!layer) {
            throw new Error(
              `Map has no "${COLLISION_LAYER_NAME}" collision layer`,
            );
          }
          const grid = buildTileGrid(layer);
          // Interaction tiles live in a separate grid from the same layer:
          // they are NOT collision geometry, so they never enter `grid`
          // (buildTileGrid folds non-solid gids to 0) — only the feet
          // probe (E key, update.ts) reads this one.
          const interactions = buildInteractionGrid(layer);

          // Door-link groups: each room objectgroup rectangle is a named
          // region that contains the tile entities whose centers fall
          // inside it — a 315 signpost tile and a 2×2 door block. Objects
          // that share a name form one gate: the showquest gating that
          // door. The real map has a single room object named `room1` — a
          // whole-map bounds rect (0,0,496M-CM-^-272) containing the signpost
          // and the door by center — so they share one group whose signpost
          // and door are linked. Foundation for "answer the question → open the door"
          // (the room will read the same groups); today only the debug
          // overlay below draws them (NEXT_PUBLIC_DOOR_DEBUG).
          const doors = buildDoorEntities(layer);
          const roomObjects =
            map.objectGroups.find(
              (group) => group.name === ROOM_OBJECT_GROUP_NAME,
            )?.objects ?? [];
          const doorGroups = groupRoomObjectsByName(
            roomObjects,
            doors,
            interactions,
          );
          state.doorGroups = doorGroups;
          if (options.doorDebug ?? isDoorDebugEnabled()) {
            const doorDebug = createDoorDebug(
              this,
              map,
              render.rooms,
              doorGroups,
              {linkColor:0xbb68f2}
            );
            setDebugHandle("__jungleDoorDebug", doorDebug);
          }

          // Player sprites get their own layer instead of living inside
          // `rooms[0]`: a container renders as one unit at its display-list
          // slot, and each later room is added after (drawn above) the
          // previous one — so a player parented to room 0 ends up hidden
          // underneath room 2's background/tiles once the room-locked
          // camera shows it. The layer is created after all the rooms and
          // transform-twins room 0 (same position/scale), keeping player
          // coordinates exactly as room-local, but it draws on top of
          // every room's art.
          const playerLayer = this.add.container(
            render.rooms[0].x,
            render.rooms[0].y,
          );
          playerLayer.setScale(render.scale);

          // Register the idle/jog/jump animations (needs the sheets that
          // just finished loading) before any sprite is spawned.
          registerPlayerAnimations(this);

          // Drop the player into the room-local player layer at spawn.
          const player = createPlayer(this, playerLayer, grid);
          setDebugHandle("__junglePlayer", player.sprite);

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
              clinging: resumed.clinging,
              facing: resumed.facing,
            });
          }

          // Commit everything the update loop reads next frame.
          state.grid = grid;
          state.interactions = interactions;
          state.rooms = render.rooms;
          state.roomColumns = render.columns;
          state.roomRows = render.rows;
          state.playerLayer = playerLayer;
          state.player = player;

          // Keyboard controls: arrows/WASD to move, Space/Up/W to jump.
          const keyboard = this.input.keyboard;
          state.cursors = keyboard?.createCursorKeys() ?? null;
          state.keyA =
            keyboard?.addKey(phaser.Input.Keyboard.KeyCodes.A) ?? null;
          state.keyD =
            keyboard?.addKey(phaser.Input.Keyboard.KeyCodes.D) ?? null;
          state.keyW =
            keyboard?.addKey(phaser.Input.Keyboard.KeyCodes.W) ?? null;
          // E: interaction tiles (see update.ts). Gameplay key — not
          // debug-gated like R.
          state.keyE =
            keyboard?.addKey(phaser.Input.Keyboard.KeyCodes.E) ?? null;
          // Debug only: R returns to the checkpoint. The room always
          // accepts the checkpoint message (its target is the
          // server-chosen spawn, so it can't bypass the anti-cheat) and
          // re-baselines its validation so the jump isn't a violation.
          state.keyR = isDebugEnabled()
            ? keyboard?.addKey(phaser.Input.Keyboard.KeyCodes.R) ?? null
            : null;

          // The quest question box (showquest interaction): screen-fixed
          // modal that listens for `quest:question` on the room and returns
          // the player's answer via `quest:answer`. Independent of the map,
          // so it can be created once here.
          const questBox = createQuestBox(this, room, state);
          setDebugHandle("__jungleQuest", questBox);
        } catch (err) {
          console.error("Failed to load the jungle map:", err);
        }
      })();
    });
    this.load.start();
  };
}