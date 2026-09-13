/**
 * The quest question box: a screen-fixed modal that appears when the server
 * sends `quest:question` (from a showquest interaction) and typesets the
 * question + its shuffled choices mathematically (see `math-format.ts`).
 *
 * Interaction: click a choice row (mouse pointer); the picked index goes
 * back to the room (`quest:answer`), which grades it server-side (the
 * correct index never reaches the client) and replies `quest:result` — the
 * box then
 * flashes "Correct!"/"Wrong" and auto-closes. While the box is open the
 * player's movement input is frozen (`state.questOpen`; see update.ts), and
 * the server drops any new showquest until this one is answered, so a
 * repeated E can't swap the question out mid-answer.
 *
 * Edge cases: if no result ever arrives (the answer was lost in a network
 * blip — the room cleared the pending question on reconnect), the box closes
 * itself 3s after answering so the player is never stuck in the modal; the
 * server's `onReconnect` also clears its pending slot so the next E sends a
 * fresh question.
 */

import type Phaser from "phaser";
import {
  QUEST_ANSWER_MESSAGE,
  QUEST_QUESTION_MESSAGE,
  QUEST_RESULT_MESSAGE,
} from "@monkeyluka/shared";
import type { JungleRoom } from "../jungle-game";
import type { JungleSceneState } from "../scene/state";
import { renderMathString } from "./math-format";

/** Panel size in screen (canvas) pixels; the 1280×720 game scales as a unit. */
const PANEL_WIDTH = 640;
const PANEL_HEIGHT = 400;
/** Width of each answer-choice row (centered inside the panel). */
const ROW_WIDTH = 560;
const ROW_HEIGHT = 38;
const ROW_STEP = 50;

export interface QuestBox {
  /** Tear the box down (scene shutdown). Message listeners stay on the room. */
  destroy(): void;
}

export function createQuestBox(
  scene: Phaser.Scene,
  room: JungleRoom,
  state: JungleSceneState,
): QuestBox {
  // Screen-fixed (never scrolls with the room-locked camera) and above
  // every room container; hidden until the first question arrives.
  const container = scene.add.container(0, 0);
  container.setScrollFactor(0);
  container.setDepth(1000);
  container.setVisible(false);

  const centerX = scene.scale.width / 2;
  const centerY = scene.scale.height / 2;
  const panelTop = centerY - PANEL_HEIGHT / 2;

  // One question + its answer state at a time.
  let opened = false;
  let answered = false;
  let answerTimer: Phaser.Time.TimerEvent | null = null;
  let closeTimer: Phaser.Time.TimerEvent | null = null;
  const rows: Phaser.GameObjects.Rectangle[] = [];

  function clearTimers(): void {
    if (answerTimer) {
      answerTimer.remove();
      answerTimer = null;
    }
    if (closeTimer) {
      closeTimer.remove();
      closeTimer = null;
    }
  }

  function answer(choice: number): void {
    if (!opened || answered) return;
    answered = true;
    // Highlight the picked row, dim the rest, lock further input.
    rows.forEach((row, index) => {
      row.setFillStyle(index === choice ? 0x0284c7 : 0x0f172a);
    });
    room.send(QUEST_ANSWER_MESSAGE, { choice });
    // Safety net: if the room never grades this answer (lost in a blip —
    // its pending question is cleared on reconnect), close the box so the
    // player isn't stuck in the modal.
    answerTimer = scene.time.delayedCall(3000, () => {
      if (opened) close();
    });
  }

  function close(): void {
    clearTimers();
    opened = false;
    answered = false;
    container.setVisible(false);
    state.questOpen = false;
  }

  function showResult(correct: boolean): void {
    if (!opened) return;
    if (answerTimer) {
      answerTimer.remove();
      answerTimer = null;
    }
    const feedback = scene.add
      .text(
        centerX,
        panelTop + PANEL_HEIGHT - 40,
        correct ? "Correct!" : "Wrong",
        {
          fontFamily: "sans-serif",
          fontSize: 22,
          fontStyle: "bold",
          color: correct ? "#4ade80" : "#f87171",
        },
      )
      .setOrigin(0.5, 0.5);
    container.add(feedback);
    closeTimer = scene.time.delayedCall(1400, close);
  }

  function open(question: string, choices: string[]): void {
    clearTimers();
    rows.length = 0;
    opened = true;
    answered = false;
    container.removeAll(true);

    // Panel + border.
    const panel = scene.add.rectangle(
      centerX,
      centerY,
      PANEL_WIDTH,
      PANEL_HEIGHT,
      0x0b0f17,
      0.96,
    );
    panel.setStrokeStyle(2, 0x3b82f6, 1);
    container.add(panel);

    const title = scene.add
      .text(centerX, panelTop + 30, "QUEST", {
        fontFamily: "sans-serif",
        fontSize: 20,
        fontStyle: "bold",
        color: "#93c5fd",
      })
      .setOrigin(0.5, 0.5);
    container.add(title);

    // The question, typeset from its plain-text notation. A fractional
    // question (numerator over a rule) is ~2.5 lines tall, so the rows
    // below start well clear of it.
    const questionMath = renderMathString(scene, question, {
      fontSize: 26,
      color: "#f8fafc",
    });
    for (const object of questionMath.objects) container.add(object);
    questionMath.place(centerX - questionMath.width / 2, panelTop + 50);

    // The four answer choices, each row clickable + hover-highlighted.
    choices.forEach((choice, index) => {
      const rowY = panelTop + 130 + index * ROW_STEP;
      const row = scene.add.rectangle(
        centerX,
        rowY + ROW_HEIGHT / 2,
        ROW_WIDTH,
        ROW_HEIGHT,
        0x1e293b,
        1,
      );
      row.setStrokeStyle(1, 0x334155, 1);
      container.add(row);
      rows.push(row);

      // The interactive row must carry scrollFactor 0 like its container:
      // Phaser's input manager compensates hit-test coordinates with the
      // OBJECT's own scrollFactor (not the container's), so a default-(1,1)
      // child of a screen-fixed (0,0) container is tested against a world
      // point offset by the room-locked camera's scroll — clicks would only
      // land when the camera is at (0,0). See
      // discoveries/showquest-quest-loop-answer-key-typesetting.md.
      row.setScrollFactor(0);

      // No numbers before the choices: the server sent a shuffled order, so
      // a player can't correlate a position with the file's key — the row's
      // vertical slot IS the only information. The choice text is centered.
      const choiceMath = renderMathString(scene, choice, {
        fontSize: 20,
        color: "#f8fafc",
      });
      for (const object of choiceMath.objects) container.add(object);
      choiceMath.place(
        centerX - choiceMath.width / 2,
        rowY + (ROW_HEIGHT - choiceMath.height) / 2,
      );

      row.setInteractive({ useHandCursor: true });
      row.on("pointerover", () => {
        if (!answered) row.setFillStyle(0x334155);
      });
      row.on("pointerout", () => {
        if (!answered) row.setFillStyle(0x1e293b);
      });
      row.on("pointerdown", () => answer(index));
    });

    container.setVisible(true);
    state.questOpen = true;
  }

  // Server → client wiring. The room is authoritative; the shape checks are
  // just enough to keep malformed data from crashing the box.
  room.onMessage(QUEST_QUESTION_MESSAGE, (message: unknown) => {
    const m = message as { question?: unknown; choices?: unknown };
    if (typeof m.question !== "string" || !Array.isArray(m.choices)) return;
    open(m.question, m.choices.filter((c): c is string => typeof c === "string"));
  });
  room.onMessage(QUEST_RESULT_MESSAGE, (message: unknown) => {
    const m = message as { correct?: unknown };
    if (typeof m.correct !== "boolean") return;
    showResult(m.correct);
  });

  // Keys are not used for answering — the row order is the shuffle, so a
  // number key would be an unlabeled guess; selection is by mouse click on
  // the row (see the `pointerdown` handler above).

  return {
    destroy(): void {
      clearTimers();
      container.destroy();
    },
  };
}