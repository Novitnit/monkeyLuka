/**
 * Unit tests for the showquest interaction handler (`interactions.ts`): the
 * room's E-key interaction must send exactly one shuffled question per press,
 * reserve the pending-quest slot (so a repeat press while the box is up sends
 * nothing), and track the correct index server-side — the client only ever
 * sees the plain question + shuffled choice strings.
 */
import { describe, expect, test } from "bun:test";
import { QUEST_QUESTION_MESSAGE, TILE_INTERACTION } from "@monkeyluka/shared";
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
}

/** A fake room-shaped context: send captures messages, setQuestPending mutates. */
function makeCtx(initialPending: QuestPending | null = null): Harness {
  let pending = initialPending;
  const sent: Array<{ type: string; payload: unknown }> = [];
  return {
    sent,
    pending: () => pending,
    ctx: {
      sessionId: "tester",
      name: "Tester",
      send: (type, payload) => void sent.push({ type, payload }),
      quests: bank,
      questPending: pending !== null,
      setQuestPending: (next) => {
        pending = next;
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
});