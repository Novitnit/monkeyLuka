import { CloseCode, Room, type Client } from "colyseus";
import {
  ANTI_CHEAT,
  DEFAULT_PLAYER_PHYSICS,
  DoorInfo,
  INPUT_INTERVAL_MS,
  JungleState,
  MAX_PLAYER_NAME_LENGTH,
  PLAYER_CHECKPOINT_MESSAGE,
  PLAYER_DEATH_MESSAGE,
  PLAYER_INPUT_MESSAGE,
  PLAYER_INTERACTION_MESSAGE,
  QUEST_ANSWER_MESSAGE,
  QUEST_QUESTION_MESSAGE,
  QUEST_RESULT_MESSAGE,
  PlayerInfo,
  clearDoorFromGrid,
  createPlayerState,
  doorKey,
  groupRoomObjectsByName,
  probeInteractionTile,
  runCompletionTimeMs,
  validatePositionReport,
  type DoorEntity,
  type JungleRoomState,
} from "@monkeyluka/shared";
import { loadJungleMap, type JungleMapData } from "../../game/jungle-map";
import {
  loadJungleQuestions,
  pickRandomQuestion,
  shuffleChoices,
  type JungleQuestionBank,
} from "../../game/quest-bank";
import { initRunResultsDb, type RunResultsStore } from "../../game/run-results";
import {
  clampVelocity,
  sanitizePlayerInput,
  sanitizePlayerInteraction,
  sanitizeQuestAnswer,
} from "./input";
import { runInteraction } from "./interactions";
import { QuestGate } from "./quest-gate";
import { writeIfChanged } from "./schema-write";
import type { ServerPlayer } from "./server-player";

/**
 * Consecutive failing movement reports before the player is stopped and a
 * violation is counted. One failing report is absorbed silently (a burst-
 * delivered honest report through a jittery tunnel can read as a teleport or
 * speed); the stop/count fires only for sustained abnormal movement.
 */
const FAILING_REPORTS_TO_STOP = 2;

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

/**
 * How long a finished room outlives the run, ms: long enough for the client
 * to receive the `finishedAt` state patch it freezes its timer and shows the
 * completion overlay from, before the room is destroyed. The result is
 * already persisted to SQLite by then, so a tight window only risks the
 * overlay/CTA, never the record.
 */
const FINISH_DISPOSE_DELAY_MS = 2_000;

export class JungleRoom extends Room<{ state: JungleRoomState }> {
  /**
   * One run per room: Play always creates a fresh room and the server
   * destroys it when the run ends or the player leaves, so a room never has
   * more than this single occupant — and never shares its solved signposts /
   * opened doors with another run. Reconnection still works: a dropped
   * client's reserved seat fulfills the same session, so maxClients never
   * blocks the owner's own reconnect.
   */
  override maxClients = 1;

  private map!: JungleMapData;
  private quests!: JungleQuestionBank;
  private gate!: QuestGate;
  /** Completed-run persistence (SQLite under apps/server/data). */
  private results!: RunResultsStore;
  private readonly sim = new Map<string, ServerPlayer>();

  override async onCreate(): Promise<void> {
    this.map = await loadJungleMap();
    this.quests = await loadJungleQuestions();
    // Endgame results land in the SQLite store as runs finish (see
    // run-results.ts); the store keeps its own file handle until dispose.
    this.results = initRunResultsDb();
    this.state = new JungleState();
    if(debug){ console.log(`Room ${this.roomId} created`) }
    // Room-level puzzle progress: which interaction tiles are solved, and
    // which doors their completions have opened. Doors start closed;
    // answering every showquest interaction linked to a door (per the room
    // objectgroup's name groups) opens it for good.
    this.gate = new QuestGate(
      groupRoomObjectsByName(
        this.map.roomObjects,
        this.map.doors,
        this.map.interactions,
      ),
    );
    // Mirror every door entity into the synced schema so clients (and late
    // joiners) learn about opens through the same state channel as players.
    for (const door of this.map.doors) {
      this.state.doors.set(
        doorKey(door.tx, door.ty),
        new DoorInfo({ tx: door.tx, ty: door.ty, state: door.state }),
      );
    }
    this.onMessage(PLAYER_INPUT_MESSAGE, (client, message: unknown) => {
      this.onPlayerInput(client, message);
    });
    this.onMessage(PLAYER_INTERACTION_MESSAGE, (client, message: unknown) => {
      this.onPlayerInteraction(client, message);
    });
    this.onMessage(QUEST_ANSWER_MESSAGE, (client, message: unknown) => {
      this.onQuestAnswer(client, message);
    });
    this.onMessage(PLAYER_DEATH_MESSAGE, (client) => {
      this.onPlayerDeath(client);
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
      failStreak: 0,
      deaths: 0,
      finished: false,
      pendingQuest: null,
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
      // Authoritative start moment for the client's run timer (top-right
      // HUD): stamped here, never by the client. Survives reconnects
      // because the reconnect reuses this same schema entry.
      joinedAt: Date.now(),
      // 0 = run in progress; the endgame finish handler stamps the moment.
      finishedAt: 0,
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
      player.failStreak = 0;
      // A reconnected page or socket has no live quest box: drop any pending
      // question so a future showquest can send a fresh one (the client also
      // closes a box that never gets its result, so a blip mid-answer still
      // self-heals on the next press).
      player.pendingQuest = null;
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

  /**
   * Trigger an interaction tile (the E key, sent by the web client when its
   * local feet probe finds a gid). The room does not trust the wire `gid`
   * alone: it re-probes its OWN last accepted position with the shared
   * `probeInteractionTile` rule (same one the client uses) and only runs
   * the action when both agree — so a forged message can only fire an
   * interaction the player is genuinely standing on, and a stale report (the
   * player just stepped onto the tile) is a harmless no-op until the next
   * accepted report lands on it. The action must additionally be grounded in
   * the accepted report (standing, not jumping through). The probe also
   * resolves the interaction tile's CELL, its identity for the completion
   * gate and the linked-door puzzle.
   */
  private onPlayerInteraction(client: Client, message: unknown): void {
    const player = this.sim.get(client.sessionId);
    if (!player) return;

    const payload = sanitizePlayerInteraction(message);
    if (!payload) return;

    // Must be standing on the tile in the last ACCEPTED report — never the
    // client-supplied position (the schema holds only accepted reports).
    if (!player.lastValid.grounded) return;
    const probe = probeInteractionTile(
      this.map.interactions,
      player.lastValid.x,
      player.lastValid.y,
      DEFAULT_PLAYER_PHYSICS.height,
    );
    if (!probe || probe.gid !== payload.gid) return;

    const info = this.state.players.get(client.sessionId);
    runInteraction(payload.gid, {
      sessionId: client.sessionId,
      name: info?.name ?? client.sessionId,
      send: (type, body) => client.send(type, body),
      quests: this.quests,
      questPending: player.pendingQuest !== null,
      setQuestPending: (pending) => {
        player.pendingQuest = pending;
      },
      tile: { tx: probe.tx, ty: probe.ty },
      completed: this.gate.isCompleted(probe.tx, probe.ty),
      finished: player.finished,
      finish: () => this.finishRun(client, player, info),
    });
  }

  /**
   * End the run (the 404 endgame tile's "finish" action — see
   * interactions.ts). The press was already validated by the shared feet
   * probe in `onPlayerInteraction`, so reaching here means the player is
   * genuinely standing on the tile; this stamps the server-authoritative
   * finish moment on the synced `PlayerInfo` — the client freezes its run
   * timer at it and displays the completion time — and persists the result
   * to the SQLite run-results store. `player.finished` keeps a repeat or
   * forged press (or a reconnect re-delivering the message) from ending or
   * re-recording the run twice.
   *
   * The recorded time includes the death penalties the room counted (its
   * own +10s per death question sent), matching the live HUD readout that
   * stopped — see `runCompletionTimeMs` in @monkeyluka/shared. A rare
   * reconnect blip mid-death can make the server count one death more than
   * the client applied, which only inflates the saved time (never enables
   * a better one).
   */
  private finishRun(
    client: Client,
    player: ServerPlayer,
    info: PlayerInfo | undefined,
  ): void {
    player.finished = true;
    const finishedAt = Date.now();
    const joinedAt = info?.joinedAt ?? finishedAt;
    const timeMs = runCompletionTimeMs(joinedAt, finishedAt, player.deaths);
    if (info) info.finishedAt = finishedAt;
    try {
      this.results.record({
        sessionId: client.sessionId,
        name: info?.name ?? `Player-${client.sessionId.slice(0, 4)}`,
        timeMs,
        finishedAt,
        roomId: this.roomId,
      });
    } catch (err) {
      // A disk error must never take down the room or undo the finish: the
      // schema already stamped `finishedAt` (the client has its result), so
      // log and move on — only persistence is lost.
      console.error(`[jungle] failed to record run for ${client.sessionId}:`, err);
    }
    if (debug) {
      console.log(
        `${info?.name ?? client.sessionId} finished in ${timeMs}ms (${player.deaths} deaths)`,
      );
    }
    // The run is over: destroy the room shortly after the finish so the
    // client still receives the `finishedAt` patch (freezes its timer, shows
    // the completion overlay) before the seat is torn down. The result is
    // already in SQLite, so nothing is lost with the room. Scheduled on the
    // room clock so a normal leave during the grace window (auto-dispose on
    // the last client) clears the pending dispose instead of double-firing.
    this.clock.setTimeout(() => {
      if (debug) console.log(`Room ${this.roomId} disposed after a finished run`);
      void this.disconnect();
    }, FINISH_DISPOSE_DELAY_MS);
  }

  /**
   * A client reports its own death (dead-zone pit touch — detected by its
   * local sim; the room never probes pits). The room can't verify the death
   * (movement is client-simulated), but a forged report is harmless: the
   * only effect is sending this player a death question, and survival still
   * requires the correct answer plus the client-driven checkpoint flow
   * (server-chosen spawn), so there is no anti-cheat bypass.
   *
   * One question at a time like `showquest`: a repeat death message while a
   * question is already out is dropped, so a stuck cycle can't stack
   * pendings. The client re-sends this message after a wrong answer's 3s
   * penalty (and self-heals a lost question by re-sending it, throttled —
   * see update.ts), so each retry gets a fresh random question with a fresh
   * server-side answer key.
   */
  private onPlayerDeath(client: Client): void {
    const player = this.sim.get(client.sessionId);
    if (!player || player.pendingQuest) return;
    // Count the death AFTER the one-question-at-a-time gate: a repeat death
    // message while a question is already out (the client's ~1/s self-heal
    // re-request) is dropped without counting a second death. The client
    // applies its +10s HUD penalty once per actual death (onDead), and this
    // counter feeds the same penalty into the recorded completion time.
    player.deaths += 1;
    const question = pickRandomQuestion(this.quests);
    const { choices, correctIndex } = shuffleChoices(question);
    player.pendingQuest = {
      kind: "death",
      correctIndex,
      choiceCount: choices.length,
    };
    client.send(QUEST_QUESTION_MESSAGE, {
      question: question.question,
      choices,
      kind: "death",
    });
  }

  /**
   * Grade a question the player was sent (by a `showquest` interaction or a
   * death). Only runs when a question is actually pending for this player (a
   * forged or stray answer is a no-op), and the reported choice is bounded by
   * the `choiceCount` that was sent. The correct index is compared
   * server-side and only the boolean result leaves the room, so the client
   * can't learn the key by probing answers. A correct interaction answer
   * completes the tile that asked and may open its linked doors; a correct
   * death answer just means "revive" (the client runs the checkpoint flow
   * itself) — completion state is never touched.
   */
  private onQuestAnswer(client: Client, message: unknown): void {
    const player = this.sim.get(client.sessionId);
    if (!player?.pendingQuest) return;

    const payload = sanitizeQuestAnswer(message);
    if (!payload || payload.choice >= player.pendingQuest.choiceCount) return;

    const correct = payload.choice === player.pendingQuest.correctIndex;
    // Only interaction-tile questions feed the completion gate: a correct
    // death-question answer revives the player (client-driven checkpoint
    // flow) and must not complete a signpost or open a door.
    if (correct && player.pendingQuest.kind === "interaction") {
      for (const door of this.gate.markCompleted(
        player.pendingQuest.tx,
        player.pendingQuest.ty,
      )) {
        this.openDoor(door);
      }
    }
    player.pendingQuest = null;
    client.send(QUEST_RESULT_MESSAGE, { correct });
  }

  /**
   * Make an opened door passable for everyone: clear its cells from the
   * room's validation grid (a report sent from inside the doorway must not
   * read as buried-in-geometry) and flip the synced schema entry so every
   * client clears its own prediction grid and hides the door art. The
   * entity's own `state` was already flipped to "open" by the quest gate.
   */
  private openDoor(door: DoorEntity): void {
    clearDoorFromGrid(this.map.grid, door.tx, door.ty);
    const synced = this.state.doors.get(doorKey(door.tx, door.ty));
    if (synced) synced.state = "open";
  }

  private removePlayer(sessionId: string): void {
    this.sim.delete(sessionId);
    this.state.players.delete(sessionId);
  }

  override onDispose(): void {
    this.results.close();
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
    // gap between accepted reports. The gap is floored by the client's own
    // report cadence (see below): the browser sends every INPUT_INTERVAL_MS
    // and seq must rise by exactly one per report, so a jittery tunnel that
    // delivers a 50 ms-spaced stream back-to-back can never under-count the
    // time a legitimately-spaced trajectory took.
    const wallDt =
      player.lastValidAt > 0 ? (now - player.lastValidAt) / 1000 : null;
    const cadenceDt =
      (payload.seq - player.lastSeq) * (INPUT_INTERVAL_MS / 1000);
    const dt =
      player.lastValidAt > 0 ? Math.max(wallDt ?? 0, cadenceDt) : null;
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
      // Absorb a single isolated failing report: a jittery transport can
      // make ONE honest report read as teleport/speed (a long delivery
      // stall mid-fall, a burst that the cadence floor can't fully span).
      // Only `FAILING_REPORTS_TO_STOP` consecutive failures mean sustained
      // abnormal movement — then stop the player (x/y in the schema still
      // hold the last accepted position, so zeroing the velocity is what
      // freezes the broadcast) and count a violation as before.
      player.failStreak += 1;
      if (player.failStreak < FAILING_REPORTS_TO_STOP) return;
      const info = this.state.players.get(client.sessionId);
      if (info) {
        writeIfChanged(info, "vx", 0);
        writeIfChanged(info, "vy", 0);
      }
      this.registerViolation(client, player, violations.join("+"));
      return;
    }

    player.failStreak = 0;

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