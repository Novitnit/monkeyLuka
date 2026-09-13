/**
 * Mutable scene state shared between the `create()` and `update()`
 * callbacks. `buildJungleScene` (index.ts) constructs one instance per
 * scene config and passes it to both, so the lifecycle callbacks share the
 * same closure over the live world without holding each other's variables.
 */

import type Phaser from "phaser";
import type {
  DoorLinkGroup,
  InteractionGrid,
  SolidGrid,
} from "@monkeyluka/shared";
import type { CollisionDebug } from "../collision/collision-debug";
import { PLAYER_SPAWN, type Player } from "../player/player";
import type { RemotePlayerView } from "../player/remote-players";
import type { TouchControlsState } from "../touch/touch-input";

/** Scene-scoped state shared between create() and update(). */
export interface JungleSceneState {
  player: Player | null;
  grid: SolidGrid | null;
  /**
   * Interaction tiles (gid → action registry) from the same `layer1` the
   * collision grid reads; probed with `interactionTileUnderFeet` on the E
   * key (see update.ts).
   */
  interactions: InteractionGrid | null;
  /**
   * Door-link groups from the room objectgroup's named annotations (see
   * door-links in @monkeyluka/shared): each group holds its showquest
   * interactions and the doors they gate. Built for the
   * NEXT_PUBLIC_DOOR_DEBUG overlay; the server's quest gate opens the same
   * groups' doors when their showquests are all answered.
   */
  doorGroups: DoorLinkGroup[] | null;
  /**
   * The collision-debug overlay handle (always created; visibility gated by
   * the NEXT_PUBLIC_DEBUG flag). The door-open sync drives it via
   * `hideDoor`: an opened door's purple 2×2 perimeter is dropped so the
   * debug lines stop describing the passable doorway — the door's tile art
   * itself keeps rendering as usual.
   */
  collisionDebug: CollisionDebug | null;
  /**
   * Doors already applied on this client (keyed by `doorKey(tx, ty)`):
   * once the synced schema reports a door open, its grid cells are cleared
   * and its debug perimeter hidden exactly once — mirroring the server's
   * quest gate.
   */
  openDoors: Set<string>;
  /**
   * Container holding the player sprites (local + remote): a transform twin
   * of `rooms[0]` added after every room, so players draw on top of the
   * map art in any room (see create.ts).
   */
  playerLayer: Phaser.GameObjects.Container | null;
  /** Room grid from the map render, for the room-locked camera. */
  rooms: Phaser.GameObjects.Container[] | null;
  roomColumns: number;
  roomRows: number;
  cursors: Phaser.Types.Input.Keyboard.CursorKeys | null;
  keyA: Phaser.Input.Keyboard.Key | null;
  keyD: Phaser.Input.Keyboard.Key | null;
  keyW: Phaser.Input.Keyboard.Key | null;
  /** E: trigger the interaction tile under the feet (see update.ts). */
  keyE: Phaser.Input.Keyboard.Key | null;
  /**
   * On-screen control state for touch devices (see touch-controls.tsx): the
   * React HUD writes into this object and the update loop merges it into
   * the keyboard input each frame. Null on keyboard/mouse devices.
   */
  touchControls: TouchControlsState | null;
  /**
   * True while the quest question box is on screen. While open the player's
   * movement input and the interaction key are ignored (modal) — see
   * update.ts. Set by `quest/quest-box.ts`.
   */
  questOpen: boolean;
  /**
   * True from the moment the player dies (dead-zone pit touch, see onDead
   * in death.ts) until its death question is answered correctly. Freezes
   * movement input like `questOpen` (and gates the E/R keys and the pit
   * probe, see update.ts) so the death flow runs exactly once; cleared by
   * `revivePlayer` in death.ts.
   */
  dead: boolean;
  /**
   * Last time a death-question request (`PLAYER_DEATH_MESSAGE`) went out.
   * Throttles the update loop's self-heal re-request — a dead player with
   * no question box up re-asks at most once per second (see update.ts).
   */
  deathRequestAt: number;
  /**
   * True once a connection drop is observed, cleared on the first frame
   * after it reopens. Used to re-send a checkpoint return whose message may
   * have been lost mid-flight (see the reconnect heal in update.ts).
   */
  connectionWasDown: boolean;
  /** Debug only (isDebugEnabled): R teleports back here. */
  checkpoint: { x: number; y: number };
  keyR: Phaser.Input.Keyboard.Key | null;
  /**
   * True between an R press and the server's snapshot confirming the jump.
   * While pending, snapshot reconciliation is skipped: for ~one RTT the
   * broadcast still holds the pre-teleport position, and snapping to it
   * would undo the teleport and make the next report read as a
   * teleport+speed violation against the re-baselined spawn.
   */
  checkpointPending: boolean;
  inputSeq: number;
  inputAccumulator: number;
  remotePlayers: Map<string, RemotePlayerView>;
}

/** Builds the initial scene state (every scene config gets its own copy). */
export function createJungleSceneState(): JungleSceneState {
  return {
    player: null,
    grid: null,
    interactions: null,
    doorGroups: null,
    collisionDebug: null,
    openDoors: new Set(),
    playerLayer: null,
    rooms: null,
    roomColumns: 1,
    roomRows: 1,
    cursors: null,
    keyA: null,
    keyD: null,
    keyW: null,
    keyE: null,
    touchControls: null,
    questOpen: false,
    dead: false,
    deathRequestAt: 0,
    connectionWasDown: false,
    checkpoint: { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y },
    keyR: null,
    checkpointPending: false,
    inputSeq: 0,
    inputAccumulator: 0,
    remotePlayers: new Map(),
  };
}