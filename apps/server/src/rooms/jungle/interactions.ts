/**
 * Server-side execution of interaction tile actions. The gid → action map
 * lives in the shared registry (`INTERACTION_TILE_ACTIONS` in
 * interaction.ts); this module is where each action actually runs. Adding a
 * new interaction tile = a registry entry there + a handler here (plus the
 * gid placed in the map).
 */

import {
  interactionActionForGid,
  type InteractionTileAction,
} from "@monkeyluka/shared";

/** The player context an action handler needs to act on. */
export interface InteractionContext {
  sessionId: string;
  name: string;
}

/**
 * The action dispatch: action id → handler. `showquest` is the first
 * interaction action (tile 315): for now it just logs to the server log —
 * the quest flow itself (the questions the client would show) is the next
 * step, and the room already proves the player is genuinely standing on the
 * tile before it gets here.
 */
const INTERACTION_HANDLERS: Record<
  InteractionTileAction,
  (ctx: InteractionContext) => void
> = {
  showquest: (ctx) => {
    console.log(
      `[jungle:interaction] ${ctx.name} (${ctx.sessionId}) showquest`,
    );
  },
};

/** Run the action bound to an interaction gid, if it has one. */
export function runInteraction(gid: number, ctx: InteractionContext): void {
  const action = interactionActionForGid(gid);
  if (action !== undefined) {
    INTERACTION_HANDLERS[action]?.(ctx);
  }
}