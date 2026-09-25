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
  MOVE_PLATFORM_OBJECT_GROUP_NAME,
  ROOM_OBJECT_GROUP_NAME,
  TRAP_OBJECT_GROUP_NAME,
  buildDoorEntities,
  buildInteractionGrid,
  buildMovePlatforms,
  buildTileGrid,
  buildTrapSpikeRuns,
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
import {
  DOOR_TEXTURE,
  createDoorViews,
  registerDoorAnimations,
} from "../door/door-render";
import { createFinishOverlay } from "../finish/finish-overlay";
import { createQuestBox } from "../quest/quest-box";
import type { QuestionTabletController } from "../quest/question-tablet";
import {
  QUESTION_TABLET_TEXTURE,
  createQuestionTabletViews,
  registerQuestionTabletAnimations,
} from "../quest/question-tablet";
import { createRunTimer } from "../timer/run-timer";
import {
  MOVE_PLATFORM_TEXTURE,
  createMovePlatformDebug,
  createMovePlatformView,
  registerMovePlatformAnimations,
} from "../trap/move-platform-render";
import {
  TRAP_SPIKE_RUN_TEXTURE,
  createTrapSpikeRunDebug,
  createTrapSpikeRunView,
  registerTrapSpikeRunAnimations,
} from "../trap/trap-spike-run-render";
import type { JungleGameOptions, JungleRoom } from "../jungle-game";
import {
  DOOR_SPRITE,
  MAP_DIR,
  MAP_FILE,
  OUT_TILE_LAYER_NAME,
  PLAYER_DIR,
  QUESTION_TABLET_SPRITE,
  TRAP_DIR,
} from "./constants";
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
    // The movable-trap spike sheet (served via the `public/trap` symlink),
    // preloaded so trap views can be built from it once the world loads.
    this.load.image(TRAP_SPIKE_RUN_TEXTURE, `${TRAP_DIR}/Trap_Spike_Run.png`);    // The move-platform sheet (same `public/trap` symlink): a 256×16 strip
    // of sixteen 16×16 slab frames, registered as its looping idle
    // animation by `registerMovePlatformAnimations` (create.ts, right
    // before the views are built).
    this.load.image(MOVE_PLATFORM_TEXTURE, `${TRAP_DIR}/movePlatformF.png`);
    // The door sheet (the `public/door.png` symlink into Assets/door.png):
    // a 3×3 grid of 64×64 cells, frame 0 the idle/closed pose and frames
    // 0–8 the one-shot opening animation (see door-render.ts).
    this.load.image(DOOR_TEXTURE, DOOR_SPRITE);
    // The question-tablet sheet (the `public/question-tablet.png` symlink
    // into `Assets/QuestionTablet.png`): a 112×128 image of 16×32 frames,
    // frame 0 the idle tablet and frames 1–22 the correct/wrong verdict
    // animations (see question-tablet.ts).
    this.load.image(QUESTION_TABLET_TEXTURE, QUESTION_TABLET_SPRITE);
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
            // The front decoration layer is lifted out of the per-room
            // rendering and raised over the door layer in create() (see
            // below), so doors render BEHIND the rim art.
            topTileLayers: [OUT_TILE_LAYER_NAME],
          });

          setDebugHandle("__jungleRender", render);
          setDebugHandle("__jungleMap", map);

          // Collision geometry: boundary edges of the collision blocks
          // (green = vertical wall edges, blue = horizontal floor edges)
          // plus the 110/109/262/287/288/290 slope lines (orange). The same
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
          // inside it — a 315 signpost tile and a 1×2 door stack. Objects
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

          // Door art: the map's 1×2 door stacks (a 375 tile above a 401
          // tile, see buildDoorEntities) render from the dedicated
          // `door.png` sheet (the renderer skips the door gids, see
          // map-renderer.ts), one sprite per door on their own layer — a
          // transform twin of room 0 — added after every room and before
          // the player layer, so doors draw over the map art and under the
          // player sprites, exactly like the trap layer below. Each sprite
          // starts on frame 0 (the closed door); when the synced schema
          // reports the door open, `syncOpenDoors` plays the one-shot
          // opening animation and the sprite hides on completion (see
          // door-open.ts). A door already open at world build (late join)
          // is created hidden instead.
          registerDoorAnimations(this);
          // Question-tablet controller, set below on the DOOR layer (the
          // tablets ride the same container the doors render in). Undefined
          // when the map has no doors — then there is nothing to hang the
          // tablets on and the quest box's verdict falls back to a no-op.
          let questionTablets: QuestionTabletController | undefined;
          if (doors.length > 0) {
            const doorLayer = this.add.container(
              render.rooms[0].x,
              render.rooms[0].y,
            );
            doorLayer.setScale(render.scale);
            state.doorLayer = doorLayer;
            state.doorViews = createDoorViews(
              this,
              doors,
              doorLayer,
              room.state?.doors,
            );

            // Question tablets (tile 315, the showquest signposts) share
            // the door layer: like the doors, the map renderer skips their
            // tileset art (see map-renderer.ts) and each signpost stands
            // as a 16×32 sprite from the QuestionTablet sheet (see
            // question-tablet.ts). Same layer = same display slot, so the
            // tablets draw over the map art and under the player layer
            // below, exactly like the doors — and share their fate when
            // `out_tile` is lifted above the door layer below.
            registerQuestionTabletAnimations(this);
            questionTablets = createQuestionTabletViews(
              this,
              doorLayer,
              interactions,
            );
            setDebugHandle("__jungleQuestionTablets", questionTablets);

            // Lift the map's front decoration layer (`out_tile`) above the
            // door layer: the doors' 1×2 stacks sit flush against the rim
            // art, so the panel must slide up BEHIND it, and the doorway
            // sill (a rim tile) must stay visible over the door's bottom.
            // (The question tablets ride the same layer, so they draw
            // behind the rim art too.)
            for (const top of render.topLayers) {
              this.children.bringToTop(top.container);
            }
          }

          // Movable traps: the `trap` objectgroup's `Trap_Spike_Run`
          // objects (patrol rect + speedMin/speedMax/time2change_speed
          // props) become markers sweeping the rect back and forth, driven
          // by the shared trap model in @monkeyluka/shared. Their layer is
          // another transform twin of room 0 (children are in map-pixel
          // coordinates, mapped through the same scale as the rooms) — but
          // inserted in the display list BEFORE the player layer below, so
          // trap markers draw over the map art and under the player
          // sprites. Each marker renders the `Trap_Spike_Run.png` sheet
          // (frames + looping idle animation registered just before the
          // views are built); pass options.trapSpikeRunTexture to swap in
          // a different caller-loaded sheet.
          registerTrapSpikeRunAnimations(this);
          registerMovePlatformAnimations(this);
          const trapObjects =
            map.objectGroups.find(
              (group) => group.name === TRAP_OBJECT_GROUP_NAME,
            )?.objects ?? [];
          const trapSpikeRuns = buildTrapSpikeRuns(trapObjects);
          // Movable platforms: their OWN objectgroup (`move_platform`) —
          // the group name is the type, each object's rect is the patrol
          // lane its slab sweeps. Unlike the lethal spike markers, a slab
          // is a SUPPORT surface: the update loop grants the player
          // standing on it ground support, but never carries the player
          // along (the player must walk — see isBoxOnMovePlatform /
          // supportPlayerOnMovePlatform in @monkeyluka/shared). Both trap
          // types share the scene's single trap layer.
          const movePlatformObjects =
            map.objectGroups.find(
              (group) => group.name === MOVE_PLATFORM_OBJECT_GROUP_NAME,
            )?.objects ?? [];
          const movePlatforms = buildMovePlatforms(movePlatformObjects);
          if (trapSpikeRuns.length > 0 || movePlatforms.length > 0) {
            const trapLayer = this.add.container(
              render.rooms[0].x,
              render.rooms[0].y,
            );
            trapLayer.setScale(render.scale);
            state.trapLayer = trapLayer;
          }
          if (trapSpikeRuns.length > 0) {
            state.trapSpikeRuns = trapSpikeRuns;
            const views = trapSpikeRuns.map((trapSpikeRun) =>
              createTrapSpikeRunView(this, trapSpikeRun, state.trapLayer!, {
                texture: options.trapSpikeRunTexture ?? TRAP_SPIKE_RUN_TEXTURE,
              }),
            );
            state.trapSpikeRunViews = views;
            // Debug (NEXT_PUBLIC_DEBUG): red attack-radius boxes around
            // each marker — the exact `isBoxTouchingTrapSpikeRun` kill
            // AABB, redrawn every frame as the marker sweeps (update.ts).
            if (options.trapSpikeRunDebug ?? isDebugEnabled()) {
              const trapSpikeRunDebug = createTrapSpikeRunDebug(
                this,
                views,
                state.trapLayer!,
              );
              setDebugHandle("__jungleTrapSpikeRunDebug", trapSpikeRunDebug);
              state.trapSpikeRunDebug = trapSpikeRunDebug;
            }
          }
          if (movePlatforms.length > 0) {
            state.movePlatforms = movePlatforms;
            const views = movePlatforms.map((movePlatform) =>
              createMovePlatformView(this, movePlatform, state.trapLayer!, {
                texture: options.movePlatformTexture ?? MOVE_PLATFORM_TEXTURE,
              }),
            );
            state.movePlatformViews = views;
            // Debug (NEXT_PUBLIC_DEBUG): each platform's patrol LANE
            // (faint outline) + its CURRENT slab box — the exact
            // `isBoxOnMovePlatform` support surface, so a map author sees
            // where the player can stand and where the slab will take
            // them; redrawn every frame as the slab sweeps (update.ts).
            if (options.movePlatformDebug ?? isDebugEnabled()) {
              const movePlatformDebug = createMovePlatformDebug(
                this,
                views,
                state.trapLayer!,
              );
              setDebugHandle("__jungleMovePlatformDebug", movePlatformDebug);
              state.movePlatformDebug = movePlatformDebug;
            }
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

          // On-screen touch controls (touch-controls.tsx): the React HUD
          // writes into this shared object and the update loop merges it
          // into the keyboard input each frame. Null on keyboard/mouse
          // devices.
          state.touchControls = options.touchControls ?? null;

          // Endgame callback (JungleGameOptions.onFinish): fired by
          // update.ts exactly once on the finish transition (the same
          // moment the overlay below shows), so the React layer can raise
          // its leaderboard CTA over the canvas.
          state.onFinish = options.onFinish ?? null;

          // The quest question box (showquest interaction): screen-fixed
          // modal that listens for `quest:question` on the room and returns
          // the player's answer via `quest:answer`. Independent of the map,
          // so it can be created once here. On an interaction verdict it
          // lowers its window and hands the result to the signpost's
          // question tablet (created above on the door layer; a no-op when
          // the map has no doors).
          const questBox = createQuestBox(
            this,
            room,
            state,
            questionTablets,
          );
          setDebugHandle("__jungleQuest", questBox);

          // The endgame completion modal (404 finish tile): screen-fixed
          // panel, hidden until the room stamps `finishedAt` on our synced
          // entry; update.ts then shows it once with the completion time
          // and freezes the player (state.finished). Independent of the
          // map, so it can be created once here.
          const finishOverlay = createFinishOverlay(this);
          setDebugHandle("__jungleFinish", finishOverlay);
          state.finishOverlay = finishOverlay;

          // Top-right run timer: a screen-fixed readout of how long the
          // local player has been in the room, derived from the server-
          // stamped `joinedAt` on its synced PlayerInfo (see run-timer.ts).
          // Ticked every frame by update.ts, independent of the connection
          // state.
          createRunTimer(this, state, room);
        } catch (err) {
          console.error("Failed to load the jungle map:", err);
        }
      })();
    });
    this.load.start();
  };
}