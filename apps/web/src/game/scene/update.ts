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
  PLAYER_DEATH_MESSAGE,
  PLAYER_INPUT_MESSAGE,
  PLAYER_INTERACTION_MESSAGE,
  interactionTileUnderFeet,
  isBoxInDeadZone,
  isBoxOnMovePlatform,
  isBoxTouchingTrapSpikeRun,
  supportPlayerOnMovePlatform,
  type PlayerInput,
} from "@monkeyluka/shared";
import { onDead } from "../death";
import { ROOM_HEIGHT, ROOM_WIDTH } from "../map/tiled-map";
import { SNAP_DISTANCE } from "../player/player";
import { syncRemotePlayers } from "../player/remote-players";
import { syncOpenDoors } from "../door/door-open";
import { updateRunTimer } from "../timer/run-timer";
import { updateTrapSpikeRunViews } from "../trap/trap-spike-run-render";
import {
  updateMovePlatformViews,
  type MovePlatformView,
} from "../trap/move-platform-render";
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

    // Run timer (top-right HUD): ticks every frame. It counts continuous
    // wall-clock time in the room, so it keeps ticking through quests,
    // deaths, and even a connection drop (the player is still seated) —
    // placed before the connection check for exactly that reason. The
    // elapsed base is the server-stamped joinedAt (authoritative), so the
    // readout survives a reload through the same reconnection flow.
    updateRunTimer(room, state);

    // Movable traps sweep independently of the connection state (they are
    // world objects, not the player's simulation, and never report to the
    // server): advance each trap's shared motion and move its marker to
    // match. No-op until the world (trap layer/views) is built. The debug
    // attack-radius boxes follow the markers, so they redraw right after.
    if (state.trapSpikeRunViews) {
      updateTrapSpikeRunViews(state.trapSpikeRunViews, dt);
      state.trapSpikeRunDebug?.update(state.trapSpikeRunViews);
    }

    // Move platforms sweep the same way — world objects, never reported to
    // the server (the player's support, not the slab, is what the reports
    // describe). The debug lane/slab overlays follow them, so they redraw
    // right after.
    if (state.movePlatformViews) {
      updateMovePlatformViews(state.movePlatformViews, dt);
      state.movePlatformDebug?.update(state.movePlatformViews);
    }

    // Door state is authoritative and synced through the schema: reconcile
    // any door the room opened into the local world (clear its collision
    // cells, drop its debug perimeter) before simulating — the doorway
    // must be passable this frame, not a frame later.
    syncOpenDoors(room, state);

    // Connection dropped (SDK auto-reconnecting in the background): freeze
    // local simulation. The server has already stopped this player (no
    // reports arrive), and simulating on would pile up position reports
    // that flush as a burst on reconnect — near-zero wall-clock dt between
    // them looks exactly like a speed hack. Rendering continues so the
    // monkey stays visible where it stopped.
    if (!room.connection.isOpen) {
      state.connectionWasDown = true;
      player.render(dt);
      syncRemotePlayers(this, room, state.remotePlayers, playerLayer, dt);
      return;
    }

    // Reconnect heal: a drop may have swallowed a checkpoint return that was
    // in flight (a correct death answer or a debug R press → the revive
    // teleport). If the server never re-baselined at the spawn, the first
    // post-reconnect report would read as a teleport and accrue violations
    // toward a kick. Re-send the message once on the first frame back — if
    // the original did arrive, the broadcast is already at the checkpoint
    // and the re-send is an idempotent re-baseline.
    if (state.connectionWasDown) {
      state.connectionWasDown = false;
      if (state.checkpointPending) {
        room.send(PLAYER_CHECKPOINT_MESSAGE, {});
      }
    }

    // --- Read input (edge-triggered jump). The quest box is modal: while a
    // question is up the player answers instead of moving, so movement input
    // (and the E interaction below) is ignored and the reports just keep the
    // standing prediction flowing. Same while dead (`state.dead`, see
    // death.ts): the body is frozen where it fell until its death question
    // is answered correctly — no gravity-walk, no jump, no wall grab. ---
    const frozen = state.questOpen || state.dead;
    // On-screen touch controls merge with the keyboard axes: left/right are
    // held states, jump is a tap edge consumed below. The edge mirrors
    // `Keyboard.JustDown` exactly — while frozen it stays buffered (like a
    // key pressed under the quest modal) and fires once the player is
    // unfrozen, so a tap is never dropped by a gate.
    const touch = state.touchControls;
    const left = frozen
      ? false
      : Boolean(state.cursors?.left.isDown || state.keyA?.isDown || touch?.left);
    const right = frozen
      ? false
      : Boolean(state.cursors?.right.isDown || state.keyD?.isDown || touch?.right);
    const jumpPressed = frozen
      ? false
      : Boolean(
          (state.cursors &&
            phaser.Input.Keyboard.JustDown(state.cursors.up)) ||
            (state.cursors &&
              phaser.Input.Keyboard.JustDown(state.cursors.space)) ||
            (state.keyW && phaser.Input.Keyboard.JustDown(state.keyW)) ||
            touch?.jump,
        );
    // Consume the touch jump edge on every unfrozen frame (one tap = one
    // jump); when frozen the tap stays buffered like the keyboard's.
    if (!frozen && touch) touch.jump = false;

    // --- Interaction tiles: standing on one and pressing E triggers its
    // action on the server. The client probes its OWN predicted feet cell
    // (the freshest spot, like the dead-zone probe below); the sent gid is
    // advisory — the room re-probes its last accepted position with the
    // same shared rule before running the action, so a stale or forged
    // press is a no-op. Edge-triggered (JustDown, or a tap on the on-screen
    // interact button), and only while grounded (standing on the tile, not
    // jumping through it). Skipped while the quest box is open — the room
    // also drops repeat showquests while one is pending, so a stray tap
    // can't swap the question mid-answer. ---
    if (!state.questOpen && !state.dead && player.physics.grounded) {
      const interactPressed =
        (state.keyE && phaser.Input.Keyboard.JustDown(state.keyE)) ||
        Boolean(touch?.interact);
      // Consume the touch interact edge inside the same grounded/ungated
      // branch where JustDown is read, so a tap made mid-air stays buffered
      // until the feet land — matching the keyboard's edge behavior.
      if (touch) touch.interact = false;
      if (interactPressed) {
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
    }

    // --- Debug: R returns to the checkpoint. Only registered when
    // NEXT_PUBLIC_DEBUG is on; the room's checkpoint handler re-baselines
    // its validation at the spawn so the jump isn't a violation. ---
    if (state.keyR && !state.dead && phaser.Input.Keyboard.JustDown(state.keyR)) {
      player.teleportTo(state.checkpoint.x, state.checkpoint.y);
      state.checkpointPending = true;
      room.send(PLAYER_CHECKPOINT_MESSAGE, {});
    }

    // --- Local simulation (shared physics; collision is client-side). ---
    const input: PlayerInput = { left, right, jump: jumpPressed };
    player.setInput(input);
    player.update(dt);

    // --- Move-platform support: standing on a `move_platform` slab grants
    // the feet ground support (grounded, feet on the top) but does NOT
    // carry the player — the slab sweeps its patrol lane independently and
    // the player must walk to follow it, falling like any ledge the moment
    // the feet leave the slab. The probe runs on the client's own
    // simulated position (freshest spot) against every slab, each frame;
    // `vy >= 0` gates the catch so a jump press (negative vy) is never
    // cancelled by the next support snap. A dead body never rides. ---
    if (state.dead || player.physics.vy < 0) {
      state.standingMovePlatformId = null;
    } else if (state.movePlatformViews) {
      const physics = player.physics;
      let supported: MovePlatformView | null = null;
      // Keep supporting the same slab (if the feet are still on it) —
      // otherwise catch the first slab under the feet this frame.
      for (const view of state.movePlatformViews) {
        if (view.platform.id === state.standingMovePlatformId) {
          supported = view;
          break;
        }
      }
      if (
        supported === null ||
        !isBoxOnMovePlatform(
          supported.motion,
          supported.platform,
          physics.x,
          physics.y,
          DEFAULT_PLAYER_PHYSICS.width,
          DEFAULT_PLAYER_PHYSICS.height,
        )
      ) {
        supported = null;
        for (const view of state.movePlatformViews) {
          if (
            isBoxOnMovePlatform(
              view.motion,
              view.platform,
              physics.x,
              physics.y,
              DEFAULT_PLAYER_PHYSICS.width,
              DEFAULT_PLAYER_PHYSICS.height,
            )
          ) {
            supported = view;
            break;
          }
        }
      }
      if (supported) {
        supportPlayerOnMovePlatform(
          physics,
          supported.motion,
          supported.platform,
          DEFAULT_PLAYER_PHYSICS,
        );
        state.standingMovePlatformId = supported.platform.id;
      } else {
        state.standingMovePlatformId = null;
      }
    }

    // --- Death-question self-heal: a dead player with no question box up
    // (the first question never arrived, a wrong answer's 3s penalty just
    // ended, or a lost answer's safety net closed the box) re-requests one.
    // Throttled to once per second so a broken cycle can't spam the room;
    // the room drops a request while a question is already pending. ---
    if (
      state.dead &&
      !state.questOpen &&
      Date.now() - state.deathRequestAt >= 1000
    ) {
      state.deathRequestAt = Date.now();
      room.send(PLAYER_DEATH_MESSAGE, {});
    }

    // --- Movable traps: touching a sweeping spike marker KILLS the player.
    // The probe mirrors the dead-zone one below: it runs on the client's
    // own simulated position (freshest spot; the broadcast is ~one RTT
    // stale) against every trap's current marker, and only while alive with
    // no revive return in flight. The marker's position is the client-side
    // motion stepped above, so the kill follows exactly what the player
    // sees. ---
    if (
      !state.checkpointPending &&
      !state.dead &&
      state.trapSpikeRunViews &&
      state.trapSpikeRunViews.some((view) =>
        isBoxTouchingTrapSpikeRun(
          view.motion,
          view.trapSpikeRun,
          player.physics.x,
          player.physics.y,
          DEFAULT_PLAYER_PHYSICS.width,
          DEFAULT_PLAYER_PHYSICS.height,
        ),
      )
    ) {
      onDead(player, "trap", room, state);
    }

    // --- Dead zone (464 hazard pits): touching one KILLS the player — the
    // kill is handed to `onDead`, which runs the death behaviors for the
    // cause (today: freeze the body and ask for a death question; a correct
    // answer revives it). The probe runs on the client's own simulated
    // position (movement is client-simulated, and this wants the freshest
    // spot — the broadcast snapshot is ~one RTT stale). `dead` guards
    // against re-firing while a death is in progress, `checkpointPending`
    // while a revive return is in flight. ---
    if (
      !state.checkpointPending &&
      !state.dead &&
      isBoxInDeadZone(
        grid,
        player.physics.x,
        player.physics.y,
        DEFAULT_PLAYER_PHYSICS.width,
        DEFAULT_PLAYER_PHYSICS.height,
      )
    ) {
      onDead(player, "dead-zone", room, state);
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