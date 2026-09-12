import { Room, type Client } from "colyseus";
import {
  ANTI_CHEAT,
  DEFAULT_PLAYER_PHYSICS,
  JungleState,
  MAX_PLAYER_NAME_LENGTH,
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
export class JungleRoom extends Room<{ state: JungleRoomState }> {
  /** Soft cap until matchmaking/filtering lands (Colyseus default is 10). */
  override maxClients = 20;

  private map!: JungleMapData;
  private readonly sim = new Map<string, ServerPlayer>();

  override async onCreate(): Promise<void> {
    this.map = await loadJungleMap();
    this.state = new JungleState();

    this.onMessage(PLAYER_INPUT_MESSAGE, (client, message: unknown) => {
      this.onPlayerInput(client, message);
    });
    // No fixed-timestep simulation: movement is client-simulated, so the room
    // has no per-tick work — validation happens on each input report.
  }

  override onJoin(client: Client, options: { name?: string } = {}): void {
    const name =
      options.name?.trim().slice(0, MAX_PLAYER_NAME_LENGTH) ||
      `Player-${client.sessionId.slice(0, 4)}`;

    const spawn = createPlayerState(DEFAULT_PLAYER_PHYSICS);
    this.sim.set(client.sessionId, {
      lastSeq: -1,
      inputStamps: [],
      lastValid: {
        x: spawn.x,
        y: spawn.y,
        vx: spawn.vx,
        vy: spawn.vy,
        grounded: spawn.grounded,
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
      facing: spawn.facing,
    });
    this.state.players.set(client.sessionId, info);
  }

  override onLeave(client: Client): void {
    this.sim.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
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
      // gameplay-truth channel; velocity is display-only).
      vx: clampVelocity(payload.vx, DEFAULT_PLAYER_PHYSICS.runSpeed),
      vy: clampVelocity(payload.vy, DEFAULT_PLAYER_PHYSICS.maxFallSpeed),
      grounded: payload.grounded,
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
      writeIfChanged(info, "facing", player.lastValid.facing);
    }
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