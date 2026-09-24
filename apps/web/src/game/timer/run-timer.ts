/**
 * The run timer: how long the local player has been in the jungle room —
 * rendered as a screen-fixed HUD readout in the top-right corner of the
 * game canvas (the corner opposite the DOM Exit button).
 *
 * The start moment is server-authoritative: the room stamps `joinedAt`
 * (server wall-clock ms) onto the player's synced `PlayerInfo` the moment
 * it joins, and the schema carries it to every client. The client derives
 * the elapsed time locally each frame (`Date.now() - joinedAt`) — no
 * per-second patches and no server tick loop — and because a reconnected
 * session reuses the same schema entry, the same `joinedAt` survives a page
 * reload: the readout keeps counting instead of restarting.
 *
 * It counts continuous wall-clock time in the room no matter what the
 * player is doing (walking, answering a question, frozen dead — death is
 * part of the run), and a death adds a flat 10-second penalty to the
 * readout (`applyRunTimePenalty`, called once per death by onDead in
 * death.ts): the count jumps 10 seconds forward and the run continues
 * from there.
 */

import type Phaser from "phaser";
import type { JungleRoom } from "../jungle-game";
import type { JungleSceneState } from "../scene/state";

/** Corner inset from the canvas top-right edge, in canvas px (1280×720). */
const TIMER_MARGIN = 24;

/** Formats elapsed ms as `m:ss` — minutes never zero-pad. */
export function formatRunTime(elapsedMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Flat penalty added to the run timer when the player dies (see death.ts). */
const DEATH_TIME_PENALTY_MS = 10_000;

/**
 * A death adds `DEATH_TIME_PENALTY_MS` to the run time: shifting the
 * elapsed base backward makes the next `updateRunTimer` readout jump
 * exactly that much forward. Called once per death from `onDead` — the
 * scene's `dead` guard keeps a death from re-firing, so the penalty is
 * never stacked twice. A no-op until the world has built the readout.
 */
export function applyRunTimePenalty(state: JungleSceneState): void {
  const timer = state.runTimer;
  if (timer) timer.startedAt -= DEATH_TIME_PENALTY_MS;
}

/**
 * Creates the timer readout and commits it to `state.runTimer`. Screen-
 * fixed (scrollFactor 0, so the room-locked camera never moves it) and
 * above every room container like the quest box; right-aligned so the text
 * grows leftward off the margin. The elapsed base is captured ONCE here
 * (the server's `joinedAt` when the synced entry is already present — the
 * normal case, since state sync usually beats the map load — else the
 * mount moment), so the readout never flips bases and never visibly jumps.
 */
export function createRunTimer(
  scene: Phaser.Scene,
  state: JungleSceneState,
  room: JungleRoom,
): void {
  const timer = scene.add
    .text(
      scene.scale.width - TIMER_MARGIN,
      TIMER_MARGIN,
      formatRunTime(0),
      {
        fontFamily: "sans-serif",
        fontSize: 26,
        fontStyle: "bold",
        color: "#f8fafc",
      },
    )
    .setOrigin(1, 0)
    // A soft shadow keeps the white readout legible over map art (the
    // quest box reads fine on its own panel; this text has none).
    .setShadow(0, 2, "#000000", 4, true, true)
    .setScrollFactor(0)
    .setDepth(1000);
  state.runTimer = {
    text: timer,
    startedAt: room.state?.players.get(room.sessionId)?.joinedAt ?? Date.now(),
  };
}

/**
 * Ticks the display every frame: recompute the elapsed time from the fixed
 * base and re-render only when the formatted string changed (the seconds
 * digit ticks once per second, so the string guard keeps the texture from
 * re-rendering every single frame). Time is clamped at 0 so a client whose
 * clock runs behind the server's never shows a negative count.
 */
export function updateRunTimer(
  room: JungleRoom,
  state: JungleSceneState,
): void {
  const timer = state.runTimer;
  if (!timer) return;
  const formatted = formatRunTime(Date.now() - timer.startedAt);
  if (timer.text.text !== formatted) {
    timer.text.setText(formatted);
  }
}