/**
 * Server-side execution of interaction tile actions. The gid → action map
 * lives in the shared registry (`INTERACTION_TILE_ACTIONS` in
 * interaction.ts); this module is where each action actually runs. Adding a
 * new interaction tile = a registry entry there + a handler here (plus the
 * gid placed in the map).
 */

import {
  QUEST_QUESTION_MESSAGE,
  interactionActionForGid,
  type InteractionTileAction,
} from "@monkeyluka/shared";
import {
  pickRandomQuestion,
  shuffleChoices,
  type JungleQuestionBank,
} from "../../game/quest-bank";
import type { QuestPending } from "./server-player";

/** The player context an action handler needs to act on. */
export interface InteractionContext {
  sessionId: string;
  name: string;
  /** Direct server→client channel (the only way an action reaches the player). */
  send(type: string, payload: unknown): void;
  /** The question bank loaded from Assets/question.json at room creation. */
  quests: JungleQuestionBank;
  /** True while this player still has an unanswered question out. */
  questPending: boolean;
  /** Reserve (or release) this player's single pending-quest slot. */
  setQuestPending(pending: QuestPending | null): void;
}

/**
 * The action dispatch: action id → handler. `showquest` is the first
 * interaction action (tile 315): it sends that player a random question from
 * the bank with its choices shuffled. The correct index is tracked
 * server-side (`setQuestPending`) and never sent, so grading in the room's
 * `quest:answer` handler is what tells the client right from wrong.
 */
const INTERACTION_HANDLERS: Record<
  InteractionTileAction,
  (ctx: InteractionContext) => void
> = {
  showquest: (ctx) => {
    // One unanswered question per player at a time: a second press while the
    // box is already up (or forged) is dropped here, so a repeated E can't
    // swap the question out from under a player mid-answer.
    if (ctx.questPending) return;
    const question = pickRandomQuestion(ctx.quests);
    const { choices, correctIndex } = shuffleChoices(question);
    ctx.setQuestPending({ correctIndex, choiceCount: choices.length });
    ctx.send(QUEST_QUESTION_MESSAGE, {
      question: question.question,
      choices,
    });
  },
};

/** Run the action bound to an interaction gid, if it has one. */
export function runInteraction(gid: number, ctx: InteractionContext): void {
  const action = interactionActionForGid(gid);
  if (action !== undefined) {
    INTERACTION_HANDLERS[action]?.(ctx);
  }
}