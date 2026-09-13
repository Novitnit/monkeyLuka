/**
 * Mutable scene state shared between the `create()` and `update()`
 * callbacks. `buildJungleScene` (index.ts) constructs one instance per
 * scene config and passes it to both, so the lifecycle callbacks share the
 * same closure over the live world without holding each other's variables.
 */

import type Phaser from "phaser";
import type { InteractionGrid, SolidGrid } from "@monkeyluka/shared";
import { PLAYER_SPAWN, type Player } from "../player/player";
import type { RemotePlayerView } from "../player/remote-players";

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
    playerLayer: null,
    rooms: null,
    roomColumns: 1,
    roomRows: 1,
    cursors: null,
    keyA: null,
    keyD: null,
    keyW: null,
    keyE: null,
    checkpoint: { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y },
    keyR: null,
    checkpointPending: false,
    inputSeq: 0,
    inputAccumulator: 0,
    remotePlayers: new Map(),
  };
}