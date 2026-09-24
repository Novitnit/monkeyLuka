/**
 * The endgame overlay: a screen-fixed modal shown exactly once, when the
 * room stamps `PlayerInfo.finishedAt` (the 404 endgame interaction tile's E
 * press — the finish action, see update.ts). It displays the completion
 * time and stays up: the run is over, and `state.finished` freezes the
 * player's input for the rest of the session (same gating as the quest
 * modal / death freeze, see update.ts). The React layer is told about the
 * same transition via `JungleGameOptions.onFinish`, so it can raise its
 * "View leaderboard" button over the canvas (play-screen.tsx).
 *
 * The value shown is the server's finish moment minus the same timer base
 * the HUD froze at (see run-timer.ts), so the overlay number matches the
 * stopped readout — and the room's saved result — exactly.
 */

import type Phaser from "phaser";
import { formatRunTime } from "../timer/run-timer";

/** Panel size in screen (canvas) pixels; the 1280×720 game scales as a unit. */
const PANEL_WIDTH = 520;
const PANEL_HEIGHT = 224;

export interface FinishOverlay {
  /** Reveal the panel with the run's completion time (idempotent). */
  show(timeMs: number): void;
  /** Tear the panel down (scene shutdown). */
  destroy(): void;
}

export function createFinishOverlay(scene: Phaser.Scene): FinishOverlay {
  // Screen-fixed (never scrolls with the room-locked camera) and above
  // every room container like the quest box; hidden until the finish.
  const container = scene.add.container(0, 0);
  container.setScrollFactor(0);
  container.setDepth(1000);
  container.setVisible(false);

  const centerX = scene.scale.width / 2;
  const centerY = scene.scale.height / 2;

  const panel = scene.add.rectangle(
    centerX,
    centerY,
    PANEL_WIDTH,
    PANEL_HEIGHT,
    0x0b0f17,
    0.96,
  );
  panel.setStrokeStyle(2, 0x4ade80, 1);
  container.add(panel);

  const title = scene.add
    .text(centerX, centerY - PANEL_HEIGHT / 2 + 34, "RUN COMPLETE", {
      fontFamily: "sans-serif",
      fontSize: 20,
      fontStyle: "bold",
      color: "#4ade80",
    })
    .setOrigin(0.5, 0.5);
  container.add(title);

  const timeText = scene.add
    .text(centerX, centerY + 8, "", {
      fontFamily: "sans-serif",
      fontSize: 52,
      fontStyle: "bold",
      color: "#f8fafc",
    })
    .setOrigin(0.5, 0.5)
    .setShadow(0, 2, "#000000", 4, true, true);
  container.add(timeText);

  const note = scene.add
    .text(centerX, centerY + PANEL_HEIGHT / 2 - 40, "Result saved", {
      fontFamily: "sans-serif",
      fontSize: 16,
      color: "#94a3b8",
    })
    .setOrigin(0.5, 0.5);
  container.add(note);

  let shown = false;
  return {
    show(timeMs: number): void {
      if (shown) return;
      shown = true;
      timeText.setText(formatRunTime(timeMs));
      container.setVisible(true);
    },
    destroy(): void {
      container.destroy();
    },
  };
}