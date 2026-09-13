import { CloseCode, Room, type Client } from "colyseus";
import {
  ANTI_CHEAT,
  DEFAULT_PLAYER_PHYSICS,
  JungleState,
  MAX_PLAYER_NAME_LENGTH,
  PLAYER_CHECKPOINT_MESSAGE,
  PLAYER_INPUT_MESSAGE,
  PlayerInfo,
  createPlayerState,
  validatePositionReport,
  type JungleRoomState,
} from "@monkeyluka/shared";
import { loadJungleMap, type JungleMapData } from "../../game/jungle-map";
import { clampVelocity, sanitizePlayerInput } from "./input";
import { writeIfChanged } from "./schema-write";
import type { ServerPlayer } from "./server-player";

const debug = true

/**
 * The jungle matchmaking room. Registers players in the shared `JungleState`,
 * then relays **client-simulated** movement: collision runs client-side with
 * the shared physics, and clients send the resulting position/velocity/
 * grounded/facing as `PLAYER_INPUT_MESSAGE` reports (~20 Hz). The room does
 * **no
 * simulation** — per report it only validates the trajectory (malformed /
 * flood / teleport / abnormal speed / buried-in-geometry), broadcasts reports
 * that pass, and "stops" the player at the last accepted position when one
 * fails while counting the violation toward a kick. Client-supplied positions
 * are never written to the schema unvalidated.
 *
 * Split into focused modules under this directory (see `index.ts`):
 * `server-player.ts` holds the per-client bookkeeping types, `input.ts` the
 * wire-payload sanitizing + advisory-velocity clamp, and `schema-write.ts`
 * the patch-churn-reducing `PlayerInfo` writes.
 */

/**
 * How long a dropped client's seat + world entry stay held for reconnection,
 * seconds (env `JUNGLE_RECONNECT_SECONDS`). Long enough for a page reload or
 * a short network blip; the seat counts toward maxClients while held.
 */
const RECONNECT_GRACE_SECONDS = Number(
  process.env.JUNGLE_RECONNECT_SECONDS ?? 30,
);

export class JungleRoom extends Room<{ state: JungleRoomState }> {
  /** Soft cap until matchmaking/filtering lands (Colyseus default is 10). */
  override maxClients = 20;

  private map!: JungleMapData;
  private readonly sim = new Map<string, ServerPlayer>();

  override async onCreate(): Promise<void> {
    this.map = await loadJungleMap();
    this.state = new JungleState();
    if(debug){ console.log(`Room ${this.roomId} created`) }
    this.onMessage(PLAYER_INPUT_MESSAGE, (client, message: unknown) => {
      this.onPlayerInput(client, message);
    });
    this.onMessage(PLAYER_CHECKPOINT_MESSAGE, (client) => {
      this.onCheckpointReturn(client);
    });
    // No fixed-timestep simulation: movement is client-simulated, so the room
    // has no per-tick work — validation happens on each input report.
  }

  override onJoin(client: Client, options: { name?: string } = {}): void {
    const name =
      options.name?.trim().slice(0, MAX_PLAYER_NAME_LENGTH) ||
      `Player-${client.sessionId.slice(0, 4)}`;

    const spawn = createPlayerState(DEFAULT_PLAYER_PHYSICS);
    if(debug){ console.log(`${name} join room ${this.roomId}`) }
    this.sim.set(client.sessionId, {
      lastSeq: -1,
      inputStamps: [],
      lastValid: {
        x: spawn.x,
        y: spawn.y,
        vx: spawn.vx,
        vy: spawn.vy,
        grounded: spawn.grounded,
        clinging: false,
        facing: spawn.facing,
      },
      lastValidAt: 0,
      violations: 0,
    });

    const info = new PlayerInfo({
      name,
      x: spawn.x,
      y: spawn.y,
      vx: spawn.vx,
      vy: spawn.vy,
      grounded: spawn.grounded,
      clinging: false,
      facing: spawn.facing,
    });
    this.state.players.set(client.sessionId, info);
  }

  /**
   * Non-consented disconnect (tab close, page reload, network blip): hold
   * the player's seat + world entry so the same session can reconnect within
   * the grace window. Colyseus reuses the sessionId on reconnect without
   * calling `onJoin`, so the player's name and last accepted position
   * survive. While away the player stays in `state.players` frozen at the
   * last accepted spot; if the seat expires without a reconnect, `removePlayer`
   * cleans up (the deferred rejects on timeout / room disposal).
   */
  override onDrop(client: Client): void {
    const reconnection = this.allowReconnection(
      client,
      RECONNECT_GRACE_SECONDS,
    );
    if(debug){ console.log(`${this.state.players.get(client.sessionId)!.name} in ${this.roomId} drop`) }
    reconnection.catch(() => this.removePlayer(client.sessionId));
  }

  /**
   * Consented leave (Exit button, anti-cheat kick, or room disposal): the
   * client is gone for good, so release the entry. Non-consented drops never
   * reach this method — Colyseus routes them to `onDrop` when it's defined.
   */
  override onLeave(client: Client): void {
    if(debug){ console.log(`${this.state.players.get(client.sessionId)!.name} in ${this.roomId} leave`) }
    this.removePlayer(client.sessionId);
  }

  /**
   * Called when a dropped client rejoins through the reserved seat. A
   * reloaded page restarts its report `seq` at 0, so reset the ordering gate
   * (otherwise every report is dropped as a retransmit) and re-baseline the
   * speed clock (the first report may also arrive as a flushed buffer with
   * near-zero wall-clock dt, which would otherwise look like a speed hack).
   */
  override onReconnect(client: Client): void {
    const player = this.sim.get(client.sessionId);
    if(debug){ console.log(`${this.state.players.get(client.sessionId)!.name} in ${this.roomId} reconnect`) }
    if (player) {
      player.lastSeq = -1;
      player.inputStamps = [];
      player.lastValidAt = 0;
    }
  }

  /**
   * Teleport a client back to its checkpoint (the browser R key, sent only
   * by debug-enabled clients). Registered **unconditionally**: the handler's
   * target is the server-chosen `PLAYER_SPAWN`, never a client-supplied
   * position, so accepting it can't bypass the anti-cheat — a forged message
   * merely resets the sender to spawn. Leaving it unregistered instead
   * drops the client outright (Colyseus `client.leave`s on a message with
   * no handler in non-dev mode), and gating it on the server's debug flag
   * would let a flag mismatch (web debug on, server off) kick the player via
   * teleport violations. See
   * `discoveries/checkpoint-message-drops-player-unregistered-handler.md`.
   *
   * The server re-baselines its validation state at the spawn point and
   * broadcasts the jump, so the client's next reports validate instead of
   * reading as a teleport violation (which would stop and eventually kick
   * the player).
   */
  private onCheckpointReturn(client: Client): void {
    const player = this.sim.get(client.sessionId);
    if (!player) return;
    const spawn = createPlayerState(DEFAULT_PLAYER_PHYSICS);
    player.lastValid = {
      x: spawn.x,
      y: spawn.y,
      vx: spawn.vx,
      vy: spawn.vy,
      grounded: spawn.grounded,
      clinging: false,
      facing: spawn.facing,
    };
    // Re-baseline the speed clock so the next report isn't compared against
    // the pre-teleport position.
    player.lastValidAt = Date.now();
    const info = this.state.players.get(client.sessionId);
    if (info) {
      writeIfChanged(info, "x", player.lastValid.x);
      writeIfChanged(info, "y", player.lastValid.y);
      writeIfChanged(info, "vx", player.lastValid.vx);
      writeIfChanged(info, "vy", player.lastValid.vy);
      writeIfChanged(info, "grounded", player.lastValid.grounded);
      writeIfChanged(info, "clinging", player.lastValid.clinging);
      writeIfChanged(info, "facing", player.lastValid.facing);
    }
  }

  private removePlayer(sessionId: string): void {
    this.sim.delete(sessionId);
    this.state.players.delete(sessionId);
  }

  override onDispose(): void {
    this.sim.clear();
    this.state.players.clear();
  }

  /**
   * Validates one movement report against the last accepted report.
   *
   * Clean report: becomes the new broadcast state. Failing report: the
   * player is "stopped" — the broadcast keeps the last accepted position
   * with velocity zeroed so every client sees the halt — and the violation
   * counts toward a kick. A client-supplied position is never written to the
   * schema unvalidated, and no report ever moves the player server-side;
   * after a stop the player only moves again once a report passes validation
   * (a one-off glitch resumes in ~one report interval; sustained abnormal
   * movement freezes the player and escalates to a kick).
   */
  private onPlayerInput(client: Client, message: unknown): void {
    const player = this.sim.get(client.sessionId);
    if (!player) return;

    const payload = sanitizePlayerInput(message);
    if (!payload) {
      this.registerViolation(client, player, "malformed");
      return;
    }

    const now = Date.now();

    // Flood rate limit: keep only arrivals inside the last second.
    player.inputStamps = player.inputStamps.filter(
      (stamp) => stamp >= now - 1000,
    );
    if (player.inputStamps.length >= ANTI_CHEAT.maxInputRatePerSecond) {
      this.registerViolation(client, player, "input-flood");
      return;
    }
    player.inputStamps.push(now);

    // Ordering: WebSocket delivery is ordered, so a non-increasing seq means
    // the client is retransmitting or forging — drop silently.
    if (payload.seq <= player.lastSeq) return;
    player.lastSeq = payload.seq;

    // Trajectory validation against the last accepted report: the reported
    // spot must be out of solid geometry, near the last accepted position,
    // and reachable within the physical speed ceiling given the wall-clock
    // gap between accepted reports.
    const dt =
      player.lastValidAt > 0 ? (now - player.lastValidAt) / 1000 : null;
    const violations = validatePositionReport(
      this.map.grid,
      { px: payload.px, py: payload.py },
      { x: player.lastValid.x, y: player.lastValid.y },
      { px: player.lastValid.x, py: player.lastValid.y },
      dt,
      DEFAULT_PLAYER_PHYSICS,
    );
    if (violations.length > 0) {
      if (process.env.JUNGLE_DEBUG_VALIDATION) {
        console.log(
          `[jungle:debug] seq=${payload.seq} reported=(${payload.px.toFixed(1)},${payload.py.toFixed(1)}) accepted=(${player.lastValid.x.toFixed(1)},${player.lastValid.y.toFixed(1)}) dt=${dt?.toFixed(3)} flags=${violations.join("+")} violations=${player.violations + 1}`,
        );
      }
      // Stop the player: x/y in the schema already hold the last accepted
      // position, so zeroing the velocity is what freezes the broadcast.
      const info = this.state.players.get(client.sessionId);
      if (info) {
        writeIfChanged(info, "vx", 0);
        writeIfChanged(info, "vy", 0);
      }
      this.registerViolation(client, player, violations.join("+"));
      return;
    }

    player.lastValid = {
      x: payload.px,
      y: payload.py,
      // Advisory velocity is clamped to the physics max so forged values
      // can't leak absurd numbers into the broadcast (position is the only
      // gameplay-truth channel; velocity is display-only). Wall jumps launch
      // faster than runSpeed, so the horizontal clamp follows the ceiling.
      vx: clampVelocity(
        payload.vx,
        Math.max(
          DEFAULT_PLAYER_PHYSICS.runSpeed,
          DEFAULT_PLAYER_PHYSICS.wallJumpSpeed,
        ),
      ),
      vy: clampVelocity(payload.vy, DEFAULT_PLAYER_PHYSICS.maxFallSpeed),
      grounded: payload.grounded,
      clinging: payload.clinging,
      facing: payload.facing,
    };
    player.lastValidAt = now;

    // The accepted report is the authoritative state — write it to the schema
    // (Colyseus patches only the changed fields).
    const info = this.state.players.get(client.sessionId);
    if (info) {
      writeIfChanged(info, "x", player.lastValid.x);
      writeIfChanged(info, "y", player.lastValid.y);
      writeIfChanged(info, "vx", player.lastValid.vx);
      writeIfChanged(info, "vy", player.lastValid.vy);
      writeIfChanged(info, "grounded", player.lastValid.grounded);
      writeIfChanged(info, "clinging", player.lastValid.clinging);
      writeIfChanged(info, "facing", player.lastValid.facing);
    }

    // No more dead-zone probing here: the 464 hazard pits are handled on the
    // client (see `scene/update.ts` — on touch it returns the player to its
    // checkpoint through `PLAYER_CHECKPOINT_MESSAGE`, whose handler above
    // re-baselines validation at the spawn).
  }

  private registerViolation(client: Client, player: ServerPlayer, reason: string): void {
    player.violations += 1;
    console.warn(
      `[jungle:anti-cheat] ${client.sessionId} ${reason} (${player.violations}/${ANTI_CHEAT.maxViolations})`,
    );
    if (player.violations >= ANTI_CHEAT.maxViolations) {
      console.warn(`[jungle:anti-cheat] kicking ${client.sessionId} (${reason})`);
      try {
        client.leave(4000, "movement violation");
      } catch {
        // the socket may already be gone
      }
    }
  }
}