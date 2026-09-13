/**
 * The scene's `update()` callback: reads input, advances the local
 * client-side prediction with the shared physics, streams ~20 Hz reports to
 * the server, reconciles against the authoritative broadcast snapshot,
 * snaps the camera to the player's room, and eases remote players.
 */

import type Phaser from "phaser";
import {
  DEFAULT_PLAYER_PHYSICS,
  PLAYER_CHECKPOINT_MESSAGE,
  PLAYER_INPUT_MESSAGE,
  PLAYER_INTERACTION_MESSAGE,
  interactionTileUnderFeet,
  isBoxInDeadZone,
  type PlayerInput,
} from "@monkeyluka/shared";
import { ROOM_HEIGHT, ROOM_WIDTH } from "../map/tiled-map";
import { SNAP_DISTANCE } from "../player/player";
import { syncRemotePlayers } from "../player/remote-players";
import type { JungleRoom } from "../jungle-game";
import { INPUT_INTERVAL_MS } from "./constants";
import type { JungleSceneState } from "./state";

/**
 * Builds the `update(this: Phaser.Scene, time, delta)` callback for the
 * jungle scene. Called by Phaser every frame after `create()` completes.
 */
export function createSceneUpdate(
  phaser: typeof Phaser,
  room: JungleRoom,
  state: JungleSceneState,
): (this: Phaser.Scene, time: number, delta: number) => void {
  return function update(
    this: Phaser.Scene,
    _time: number,
    delta: number,
  ): void {
    // World not built yet (async map load) — nothing to simulate.
    const { player, playerLayer, grid } = state;
    if (!player || !grid || !playerLayer) return;

    const dt = Math.min(delta, 50) / 1000;

    // Connection dropped (SDK auto-reconnecting in the background): freeze
    // local simulation. The server has already stopped this player (no
    // reports arrive), and simulating on would pile up position reports
    // that flush as a burst on reconnect — near-zero wall-clock dt between
    // them looks exactly like a speed hack. Rendering continues so the
    // monkey stays visible where it stopped.
    if (!room.connection.isOpen) {
      player.render(dt);
      syncRemotePlayers(this, room, state.remotePlayers, playerLayer, dt);
      return;
    }

    // --- Read input (edge-triggered jump). The quest box is modal: while a
    // question is up the player answers instead of moving, so movement input
    // (and the E interaction below) is ignored and the reports just keep the
    // standing prediction flowing. ---
    const left = state.questOpen
      ? false
      : Boolean(state.cursors?.left.isDown || state.keyA?.isDown);
    const right = state.questOpen
      ? false
      : Boolean(state.cursors?.right.isDown || state.keyD?.isDown);
    const jumpPressed = state.questOpen
      ? false
      : Boolean(
          (state.cursors &&
            phaser.Input.Keyboard.JustDown(state.cursors.up)) ||
            (state.cursors &&
              phaser.Input.Keyboard.JustDown(state.cursors.space)) ||
            (state.keyW && phaser.Input.Keyboard.JustDown(state.keyW)),
        );

    // --- Interaction tiles: standing on one and pressing E triggers its
    // action on the server. The client probes its OWN predicted feet cell
    // (the freshest spot, like the dead-zone probe below); the sent gid is
    // advisory — the room re-probes its last accepted position with the
    // same shared rule before running the action, so a stale or forged
    // press is a no-op. Edge-triggered (JustDown), and only while grounded
    // (standing on the tile, not jumping through it). Skipped while the
    // quest box is open — the room also drops repeat showquests while one
    // is pending, so a stray E can't swap the question mid-answer. ---
    if (
      !state.questOpen &&
      state.keyE &&
      player.physics.grounded &&
      phaser.Input.Keyboard.JustDown(state.keyE)
    ) {
      const gid =
        state.interactions === null
          ? 0
          : interactionTileUnderFeet(
              state.interactions,
              player.physics.x,
              player.physics.y,
              DEFAULT_PLAYER_PHYSICS.height,
            );
      if (gid !== 0) {
        room.send(PLAYER_INTERACTION_MESSAGE, { gid });
      }
    }

    // --- Debug: R returns to the checkpoint. Only registered when
    // NEXT_PUBLIC_DEBUG is on; the room's checkpoint handler re-baselines
    // its validation at the spawn so the jump isn't a violation. ---
    if (state.keyR && phaser.Input.Keyboard.JustDown(state.keyR)) {
      player.teleportTo(state.checkpoint.x, state.checkpoint.y);
      state.checkpointPending = true;
      room.send(PLAYER_CHECKPOINT_MESSAGE, {});
    }

    // --- Local simulation (shared physics; collision is client-side). ---
    const input: PlayerInput = { left, right, jump: jumpPressed };
    player.setInput(input);
    player.update(dt);

    // --- Dead zone (464 hazard pits): touching one returns the player to
    // its checkpoint. The probe runs on the client's own simulated position
    // (movement is client-simulated, and this wants the freshest spot — the
    // broadcast snapshot is ~one RTT stale), and it reuses the checkpoint
    // message so the server re-baselines at the spawn instead of reading the
    // jump as a teleport violation. `checkpointPending` guards against
    // re-firing while a return is already in flight (the checkpoint is the
    // server-chosen spawn, so it can't be forged past the anti-cheat). ---
    if (
      !state.checkpointPending &&
      isBoxInDeadZone(
        grid,
        player.physics.x,
        player.physics.y,
        DEFAULT_PLAYER_PHYSICS.width,
        DEFAULT_PLAYER_PHYSICS.height,
      )
    ) {
      player.teleportTo(state.checkpoint.x, state.checkpoint.y);
      state.checkpointPending = true;
      room.send(PLAYER_CHECKPOINT_MESSAGE, {});
    }

    // --- Report the predicted state to the server (~20 Hz). Collision is
    // client-side: the server validates this reported trajectory and
    // broadcasts it back; a report that fails validation stops the
    // player. ---
    state.inputAccumulator += delta;
    if (state.inputAccumulator >= INPUT_INTERVAL_MS) {
      state.inputAccumulator %= INPUT_INTERVAL_MS;
      room.send(PLAYER_INPUT_MESSAGE, {
        seq: ++state.inputSeq,
        px: player.physics.x,
        py: player.physics.y,
        vx: player.physics.vx,
        vy: player.physics.vy,
        grounded: player.physics.grounded,
        clinging: player.physics.clinging,
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
        state.checkpointPending &&
        Math.hypot(mine.x - state.checkpoint.x, mine.y - state.checkpoint.y) <=
          SNAP_DISTANCE
      ) {
        state.checkpointPending = false;
      }
      if (!state.checkpointPending) {
        player.applyServerSnapshot({
          x: mine.x,
          y: mine.y,
          vx: mine.vx,
          vy: mine.vy,
          grounded: mine.grounded,
          clinging: mine.clinging,
          facing: mine.facing,
        });
      }
    }
    player.render(dt);

    // --- Room-locked camera: only the ROOM_WIDTH-wide room the player is
    // in is ever visible. The camera snaps to that room (never follows the
    // player smoothly), so the neighboring rooms stay off-screen until the
    // player crosses a room boundary. ---
    if (state.rooms) {
      const col = Math.min(
        state.roomColumns - 1,
        Math.max(0, Math.floor(player.physics.x / ROOM_WIDTH)),
      );
      const row = Math.min(
        state.roomRows - 1,
        Math.max(0, Math.floor(player.physics.y / ROOM_HEIGHT)),
      );
      const roomView = state.rooms[row * state.roomColumns + col];
      this.cameras.main.setScroll(roomView.x, roomView.y);
    }

    syncRemotePlayers(this, room, state.remotePlayers, playerLayer, dt);
  };
}