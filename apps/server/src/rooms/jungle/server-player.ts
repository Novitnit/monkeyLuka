/**
 * A question currently out to a player, awaiting its `quest:answer`. The
 * correct index is the answer key: it lives only here on the server, and
 * grading compares the client's reported choice against it.
 */
export interface QuestPending {
  /** Index of the correct choice within the shuffled choices that were sent. */
  correctIndex: number;
  /** How many choices the player received (bounds the reported answer). */
  choiceCount: number;
}

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