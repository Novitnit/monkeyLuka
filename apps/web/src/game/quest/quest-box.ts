/**
 * The quest question box: a screen-fixed modal that appears when the server
 * sends `quest:question` and typesets the question + its shuffled choices
 * mathematically (see `math-format.ts`). The verdict feedback is delegated
 * to the in-world **question tablet** (question-tablet.ts): the tablet IS
 * tile 315, the showquest signpost — frame 0 while a question is up and
 * unanswered.
 *
 * Two question kinds ride the same message (`kind`):
 *
 * - **interaction** (showquest signpost): click a choice row (mouse
 *   pointer); the picked index goes back to the room (`quest:answer`),
 *   which grades it server-side (the correct index never reaches the
 *   client) and replies `quest:result`. On the verdict the window lowers
 *   **immediately** (`windowGroup`, the panel + question + rows, hides —
 *   it had been covering the signpost, which is near the screen center)
 *   and `playVerdict` runs on the ONE signpost that asked, named in the
 *   message's `tx`/`ty` (see interactions.ts): correct plays frames 1–9
 *   and holds on frame 9 (the solved signpost keeps its check), wrong
 *   plays frames 10–22 and returns to frame 0. The box auto-closes.
 * - **death** (dead-zone pit, see death.ts): no signpost is involved
 *   (the message carries no tile), so the original feedback stays: a wrong
 *   answer holds "Wrong" on screen for 3 seconds (questOpen keeps the
 *   player frozen — the penalty), then the box closes and update.ts's
 *   self-heal re-requests a fresh death question; this repeats until a
 *   correct answer, which revives the player through the checkpoint flow
 *   (`revivePlayer`).
 *
 * While the box is open the player's movement input is frozen
 * (`state.questOpen`; see update.ts), and the server drops any new showquest
 * until the current question is answered, so a repeated E can't swap the
 * question out mid-answer (death questions are likewise one-at-a-time via
 * the pending slot).
 *
 * Edge cases: if no result ever arrives (the answer was lost in a network
 * blip — the room cleared the pending question on reconnect), the box closes
 * itself 3s after answering so the player is never stuck in the modal; an
 * interaction question just ends there, while a death question's close
 * hands control back to update.ts's self-heal, which re-requests a fresh
 * question.
 */

import type Phaser from "phaser";
import {
  QUEST_ANSWER_MESSAGE,
  QUEST_QUESTION_MESSAGE,
  QUEST_RESULT_MESSAGE,
  type QuestQuestionKind,
} from "@monkeyluka/shared";
import { revivePlayer } from "../death";
import type { JungleRoom } from "../jungle-game";
import type { JungleSceneState } from "../scene/state";
import { renderMathString } from "./math-format";
import type { QuestionTabletController } from "./question-tablet";

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
  questionTablets?: QuestionTabletController,
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

  // The answer window: the panel, title, question, and choice rows. Lives
  // in its own nested container so "lowering the window" on an interaction
  // verdict hides the whole group at once, clearing the screen for the
  // signpost's tablet animation.
  const windowGroup = scene.add.container(0, 0);
  container.add(windowGroup);

  // One question + its answer state at a time.
  let opened = false;
  let answered = false;
  let kind: QuestQuestionKind = "interaction";
  // The interaction tile (315 signpost) that asked the current question —
  // its tablet plays the verdict. Null for death questions.
  let tile: { tx: number; ty: number } | null = null;
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

  /** Hide the answer window but keep the (otherwise empty) container. */
  function lowerWindow(): void {
    windowGroup.setVisible(false);
  }

  function close(): void {
    clearTimers();
    opened = false;
    answered = false;
    tile = null;
    container.setVisible(false);
    state.questOpen = false;
  }

  function showResult(correct: boolean): void {
    if (!opened) return;
    if (answerTimer) {
      answerTimer.remove();
      answerTimer = null;
    }

    if (kind === "interaction") {
      // The verdict is in: lower the window immediately — it had been
      // covering the signpost — and let the question tablet on the signpost
      // that asked play the result in the world (correct = frames 1–9,
      // holding frame 9; wrong = frames 10–22, back to frame 0). The
      // modal's only job was asking, so it closes right away. (Undefined
      // when the map has no doors — tabletless signposts — so no-op.)
      lowerWindow();
      if (tile) questionTablets?.playVerdict(tile.tx, tile.ty, correct);
      close();
      return;
    }

    // Death questions: no signpost tablet (the message carried no tile),
    // so the original feedback flash stays as the verdict. The flash is
    // parented to `windowGroup` (NOT the outer container) on purpose: a
    // wrong answer's penalty ends and update.ts's self-heal re-opens the
    // box with a FRESH question via `open()`, which clears windowGroup
    // (`removeAll(true)`) — so the old verdict is destroyed with it.
    // Parenting to the container instead let stale "Wrong"/"Correct!"
    // text survive into the next question and stack duplicates on
    // repeated wrong answers (see discoveries/). It is added after the
    // rows, so it draws on top of them during the penalty window.
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
    windowGroup.add(feedback);

    if (correct) {
      // Revive through the checkpoint flow (player:checkpoint → the room
      // re-baselines at the spawn). The "Correct!" flash stays up and
      // questOpen keeps movement frozen until it closes; the body is
      // already teleported, so the player simply walks away from spawn
      // when the box drops.
      if (state.player) revivePlayer(state);
      closeTimer = scene.time.delayedCall(1400, close);
    } else {
      // The 3-second penalty: "Wrong" stays on screen (and the modal
      // freezes movement) for 3s, then the box closes so update.ts's
      // self-heal re-requests a fresh death question and re-opens it.
      // Repeat until the player answers correctly — see death.ts.
      closeTimer = scene.time.delayedCall(3000, close);
    }
  }

  function open(question: string, choices: string[]): void {
    clearTimers();
    rows.length = 0;
    opened = true;
    answered = false;
    // Rebuild the window from scratch (a fresh death question re-opens the
    // box with new content; a lower window is raised again).
    windowGroup.removeAll(true);
    windowGroup.setVisible(true);

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
    windowGroup.add(panel);

    const title = scene.add
      .text(centerX, panelTop + 30, "QUEST", {
        fontFamily: "sans-serif",
        fontSize: 20,
        fontStyle: "bold",
        color: "#93c5fd",
      })
      .setOrigin(0.5, 0.5);
    windowGroup.add(title);

    // The question, typeset from its plain-text notation. A fractional
    // question (numerator over a rule) is ~2.5 lines tall, so the rows
    // below start well clear of it.
    const questionMath = renderMathString(scene, question, {
      fontSize: 26,
      color: "#f8fafc",
    });
    for (const object of questionMath.objects) windowGroup.add(object);
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
      windowGroup.add(row);
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
      for (const object of choiceMath.objects) windowGroup.add(object);
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
    const m = message as {
      question?: unknown;
      choices?: unknown;
      kind?: unknown;
      tx?: unknown;
      ty?: unknown;
    };
    if (typeof m.question !== "string" || !Array.isArray(m.choices)) return;
    kind = m.kind === "death" ? "death" : "interaction";
    // The interaction tile that asked rides along so the verdict plays on
    // THIS signpost's tablet; death questions omit it.
    tile =
      kind === "interaction" &&
      typeof m.tx === "number" &&
      typeof m.ty === "number"
        ? { tx: m.tx, ty: m.ty }
        : null;
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