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
import type { InteractionLink } from "@monkeyluka/shared";
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
  /** Grid cell of the interaction tile the press happened on (its identity). */
  tile: InteractionLink;
  /** True when this tile has already been answered correctly (done). */
  completed: boolean;
  /**
   * True once this player already finished the run (the 404 endgame tile):
   * the room stamps `finished` exactly once, so a repeat/forged press is a
   * silent no-op and the result is never re-recorded.
   */
  finished: boolean;
  /**
   * End the run: the room stamps the server finish moment on the synced
   * `PlayerInfo.finishedAt`, freezes the client's timer at it and persists
   * the completion time to its SQLite store (see `run-results.ts`). No-op
   * unless `finished` is false.
   */
  finish(): void;
}

/**
 * The action dispatch: action id → handler. `showquest` is the first
 * interaction action (tile 315): it sends that player a random question from
 * the bank with its choices shuffled. The correct index is tracked
 * server-side (`setQuestPending`) and never sent, so grading in the room's
 * `quest:answer` handler is what tells the client right from wrong. A
 * completed tile (answered correctly before) refuses to send again — see
 * the `completed` flag.
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
    // Solved once: the tile was answered correctly before, so it can never
    // be answered again — a repeat press (or a forged one) is a silent no-op.
    if (ctx.completed) return;
    const question = pickRandomQuestion(ctx.quests);
    const { choices, correctIndex } = shuffleChoices(question);
    // The tile the question came from rides along in the pending slot; the
    // room's grading uses it to mark THAT signpost completed on a correct
    // answer (and to open its linked doors when all are done).
    ctx.setQuestPending({
      kind: "interaction",
      correctIndex,
      choiceCount: choices.length,
      tx: ctx.tile.tx,
      ty: ctx.tile.ty,
    });
    ctx.send(QUEST_QUESTION_MESSAGE, {
      question: question.question,
      choices,
      // The asking signpost's grid cell: the client plays the verdict
      // animation on THAT tile-315 question tablet (quest-box.ts →
      // question-tablet.ts), not on every signpost.
      tx: ctx.tile.tx,
      ty: ctx.tile.ty,
    });
  },
  // The endgame tile (gid 404): ending the run. The press was already
  // validated by the room's feet probe (the player is genuinely standing on
  // the tile, grounded), so the handler only enforces the once-per-run rule
  // and hands the rest to the room: it stamps the server finish moment on
  // the synced PlayerInfo (the client freezes its timer at it and shows the
  // completion time) and persists the result to its SQLite store. Not gated
  // by a pending question — an unfinished showquest doesn't block finishing.
  finish: (ctx) => {
    if (ctx.finished) return;
    ctx.finish();
  },
};

/** Run the action bound to an interaction gid, if it has one. */
export function runInteraction(gid: number, ctx: InteractionContext): void {
  const action = interactionActionForGid(gid);
  if (action !== undefined) {
    INTERACTION_HANDLERS[action]?.(ctx);
  }
}