/**
 * Unit tests for the interaction handlers (`interactions.ts`): `showquest`
 * (the room's E-key signpost must send exactly one shuffled question per
 * press, reserve the pending-quest slot — so a repeat press while the box
 * is up sends nothing — track the correct index server-side — the client
 * only ever sees the plain question + shuffled choice strings — record
 * which interaction tile asked, so a correct answer completes THAT signpost
 * and refuse to send again once the tile is completed) and `finish` (the
 * 404 endgame tile must end the run exactly once, handing the actual
 * stamping + persistence to the room via `ctx.finish`).
 */
import { describe, expect, test } from "bun:test";
import {
  QUEST_QUESTION_MESSAGE,
  TILE_ENDGAME,
  TILE_INTERACTION,
} from "@monkeyluka/shared";
import {
  parseJungleQuestions,
  type JungleQuestionBank,
} from "../../game/quest-bank";
import { runInteraction, type InteractionContext } from "./interactions";
import type { QuestPending } from "./server-player";

/** Frozen snapshot of the real question file (Assets/question.json). */
const bank = parseJungleQuestions(
  (await Bun.file(
    new URL("../../../../../Assets/question.json", import.meta.url),
  ).json()) as Parameters<typeof parseJungleQuestions>[0],
);

interface Harness {
  ctx: InteractionContext;
  sent: Array<{ type: string; payload: unknown }>;
  pending: () => QuestPending | null;
  finished: () => boolean;
}

/** A fake room-shaped context: send captures messages, setQuestPending mutates. */
function makeCtx(
  initialPending: QuestPending | null = null,
  tile: { tx: number; ty: number } = { tx: 17, ty: 11 },
  completed = false,
  alreadyFinished = false,
): Harness {
  let pending = initialPending;
  let finished = alreadyFinished;
  const sent: Array<{ type: string; payload: unknown }> = [];
  return {
    sent,
    pending: () => pending,
    finished: () => finished,
    ctx: {
      sessionId: "tester",
      name: "Tester",
      send: (type, payload) => void sent.push({ type, payload }),
      quests: bank,
      questPending: pending !== null,
      setQuestPending: (next) => {
        pending = next;
      },
      tile,
      completed,
      finished,
      finish: () => {
        finished = true;
      },
    },
  };
}

describe("showquest interaction handler", () => {
  test("sends one shuffled question and reserves the pending slot", () => {
    const { ctx, sent, pending } = makeCtx();
    runInteraction(TILE_INTERACTION, ctx);

    expect(sent.length).toBe(1);
    const { type, payload } = sent[0]!;
    expect(type).toBe(QUEST_QUESTION_MESSAGE);
    const message = payload as { question: string; choices: string[] };

    // A real question from the bank.
    expect(bank.questions.map((q) => q.question)).toContain(message.question);
    // All four choices, no duplicates, still the same set as the file.
    expect(message.choices.length).toBe(4);
    expect(new Set(message.choices).size).toBe(4);

    // The server keeps the answer key; it never leaves through `send`.
    const reserved = pending();
    expect(reserved).not.toBeNull();
    expect(reserved!.choiceCount).toBe(4);
    expect(message.choices[reserved!.correctIndex]).toBeTypeOf("string");
    // It is an interaction-tile question, and the interacted tile rides
    // along, so the room can mark THAT signpost completed when the answer
    // comes back correct.
    if (reserved!.kind !== "interaction") {
      throw new Error("expected an interaction-tile question");
    }
    expect(reserved!.tx).toBe(17);
    expect(reserved!.ty).toBe(11);
  });

  test("a second press while a question is pending sends nothing", () => {
    // Simulate the room's one-at-a-time gate: after the first press the
    // harness's pending slot is full, so the second is dropped.
    const harness = makeCtx();
    runInteraction(TILE_INTERACTION, harness.ctx);
    expect(harness.sent.length).toBe(1);

    const { ctx, sent } = makeCtx(harness.pending());
    runInteraction(TILE_INTERACTION, ctx);
    expect(sent.length).toBe(0);
  });

  test("a completed interaction is permanently silent", () => {
    // The tile was answered correctly before — the room's gate marks it
    // completed, and pressing E on it again must not send another question.
    const { ctx, sent } = makeCtx(null, { tx: 17, ty: 11 }, true);
    runInteraction(TILE_INTERACTION, ctx);
    expect(sent.length).toBe(0);
  });
});

describe("finish interaction handler", () => {
  test("ends the run exactly once and hands the rest to the room", () => {
    // The 404 endgame tile: the press was already validated by the room's
    // feet probe, so the handler just flips the finished flag (the room's
    // `finish` closure stamps `PlayerInfo.finishedAt` + persists the
    // result). It sends nothing itself.
    const harness = makeCtx(null, { tx: 7, ty: 11 });
    runInteraction(TILE_ENDGAME, harness.ctx);
    expect(harness.finished()).toBe(true);
    expect(harness.sent.length).toBe(0);

    // A repeat press (or a forged one) after finishing is a silent no-op —
    // the run is not re-ended and the room's finish closure is not re-run.
    const second = makeCtx(null, { tx: 7, ty: 11 }, false, true);
    runInteraction(TILE_ENDGAME, second.ctx);
    expect(second.finished()).toBe(true);
    expect(second.sent.length).toBe(0);
  });

  test("finishing is not gated by a pending question slot", () => {
    // Unlike showquest, a finish press is not dropped while an unanswered
    // question is out: an unfinished quest doesn't block ending the run.
    const harness = makeCtx({
      kind: "interaction",
      correctIndex: 2,
      choiceCount: 4,
      tx: 17,
      ty: 11,
    });
    runInteraction(TILE_ENDGAME, harness.ctx);
    expect(harness.finished()).toBe(true);

    // And it never touches the pending slot (the room's grading keeps it).
    const resolved = harness.pending();
    expect(resolved).not.toBeNull();
    expect(resolved!.kind).toBe("interaction");
  });
});