/**
 * The quest wire contract: the server typesets nothing — a `showquest`
 * interaction picks a random question from `Assets/question.json`, shuffles
 * its choices, and sends the plain-text strings; the client typesets them
 * (see `apps/web/src/game/quest/`) and reports the chosen choice index back.
 * The correct index never leaves the server, so the client can't look up
 * answers — grading happens in the room against the shuffled order it sent.
 */

/** Server → client: a question to display (choices already shuffled). */
export const QUEST_QUESTION_MESSAGE = "quest:question";

/**
 * Client → server: the player died (dead-zone pit touch, detected by the
 * client's local sim — the room never probes pits). The room answers with
 * a random death question (`quest:question` with `kind: "death"`); the
 * player must answer it correctly to revive. Forged reports are harmless:
 * the only cost is a question, and survival still runs through the
 * server-chosen checkpoint flow.
 */
export const PLAYER_DEATH_MESSAGE = "player:death";

/** Where a question came from; the quest box treats death questions differently. */
export type QuestQuestionKind = "interaction" | "death";

/** Client → server: which choice the player picked (index into choices). */
export const QUEST_ANSWER_MESSAGE = "quest:answer";

/** Server → client: whether the picked choice was the correct one. */
export const QUEST_RESULT_MESSAGE = "quest:result";

/** Payload of `QUEST_QUESTION_MESSAGE`. */
export interface QuestQuestionMessage {
  /** Plain-text question in ASCII math notation (typeset by the client). */
  question: string;
  /** The answer choices, shuffled by the server (2+ entries). */
  choices: string[];
  /**
   * `"death"` for a death question (a wrong answer penalizes + retries
   * until a correct answer revives the player). Interaction questions
   * (showquest tiles) omit it — the client defaults to `"interaction"`.
   */
  kind?: QuestQuestionKind;
  /**
   * Grid cell of the interaction tile (the 315 showquest signpost) that
   * asked the question — present only for interaction questions, and only
   * so the client can play the verdict animation ON that signpost's
   * question tablet. Death questions omit it.
   */
  tx?: number;
  ty?: number;
}

/** Payload of `QUEST_ANSWER_MESSAGE`. */
export interface QuestAnswerMessage {
  /** Index into the `choices` array sent with the question. */
  choice: number;
}

/** Payload of `QUEST_RESULT_MESSAGE`. */
export interface QuestResultMessage {
  /** Whether the reported choice was the correct one. */
  correct: boolean;
}