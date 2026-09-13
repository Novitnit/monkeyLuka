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