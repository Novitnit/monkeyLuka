import type { QuestQuestionKind } from "@monkeyluka/shared";

/** Common fields of a question currently out to a player. */
interface QuestPendingBase {
  /** Where the question came from; gates grading (see the room's quest:answer handler). */
  kind: QuestQuestionKind;
  /** Index of the correct choice within the shuffled choices that were sent. */
  correctIndex: number;
  /** How many choices the player received (bounds the reported answer). */
  choiceCount: number;
}

/**
 * An interaction-tile question (showquest): `tx`/`ty` are the signpost that
 * asked — a correct answer marks THAT tile completed (it can't be asked
 * again) and feeds the door-opening gate.
 */
export interface InteractionQuestPending extends QuestPendingBase {
  kind: "interaction";
  /** Grid column of the interaction tile the question came from. */
  tx: number;
  /** Grid row of the interaction tile the question came from. */
  ty: number;
}

/** A death question: a correct answer just revives the player. */
export interface DeathQuestPending extends QuestPendingBase {
  kind: "death";
}

/**
 * A question currently out to a player, awaiting its `quest:answer`. The
 * correct index is the answer key: it lives only here on the server, and
 * grading compares the client's reported choice against it.
 */
export type QuestPending = InteractionQuestPending | DeathQuestPending;

/**
 * Per-connected-client bookkeeping for the client-authoritative model: the
 * client simulates its own movement and the room only validates the reports
 * it sends. `lastValid` is the most recent report that passed validation —
 * the state the room broadcasts to everyone. A failing report never moves it;
 * the player is "stopped" (broadcast frozen, velocity zeroed) while the
 * violation counts toward a kick.
 */
export interface ServerPlayer {
  /** Highest accepted input sequence (WebSocket is ordered, so must rise). */
  lastSeq: number;
  /** Timestamps of accepted input messages, for the flood rate limit. */
  inputStamps: number[];
  /** Last accepted report: state to broadcast + its arrival time. */
  lastValid: BroadcastState;
  lastValidAt: number;
  /** Count of teleport/speed/flood violations before the kick threshold. */
  violations: number;
  /**
   * Deaths the room has counted (one per death question it sent). Feeds
   * the server-computed completion time: each death adds the same 10s
   * penalty the client's HUD applies, so the saved result matches the
   * readout that stopped.
   */
  deaths: number;
  /**
   * True once the player reached the 404 endgame tile and finished: a
   * repeat (or forged) finish press is a silent no-op, and the run is
   * never re-recorded.
   */
  finished: boolean;
  /** The question currently out to this player, if any (one at a time). */
  pendingQuest: QuestPending | null;
}

/** The `PlayerInfo` fields the room relays from one accepted report. */
export interface BroadcastState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  clinging: boolean;
  facing: number;
}