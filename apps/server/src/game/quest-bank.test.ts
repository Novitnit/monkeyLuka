/**
 * Unit tests for the server's quest-bank loader + randomization: the room
 * must serve questions from the SAME `Assets/question.json` the web client's
 * typesetter renders, and the shuffle must never lose track of which choice
 * is correct (the client only ever sees the shuffled strings + its own pick).
 */
import { describe, expect, test } from "bun:test";
import {
  parseJungleQuestions,
  pickRandomQuestion,
  shuffleChoices,
  type JungleQuestionBank,
} from "./quest-bank";

/** Frozen snapshot of the real question file (Assets/question.json). */
const raw = (await Bun.file(
  new URL("../../../../Assets/question.json", import.meta.url),
).json()) as Parameters<typeof parseJungleQuestions>[0];

function loadBank(): JungleQuestionBank {
  return parseJungleQuestions(raw);
}

describe("question bank loader", () => {
  test("loads the real question.json — 5 derivative questions, 4 choices each", () => {
    const bank = loadBank();
    expect(bank.questions.length).toBe(5);
    for (const question of bank.questions) {
      expect(question.choices.length).toBe(4);
      // The correct choice exists and is one of the choices.
      expect(typeof question.choices[question.answer]!).toBe("string");
      expect(question.choices).toContain(question.choices[question.answer]!);
    }
    expect(bank.questions.map((q) => q.question)).toEqual([
      "d((x^5))/dx",
      "d((3x^2))/dx",
      "d((sin(x)))/dx",
      "d((e^x))/dx",
      "d((ln(x)))/dx",
    ]);
  });

  test("rejects a bank with no questions", () => {
    expect(() => parseJungleQuestions({})).toThrow();
    expect(() => parseJungleQuestions({ questions: [] })).toThrow();
  });

  test("rejects a question whose answer key is not in its choices", () => {
    expect(() =>
      parseJungleQuestions({
        questions: [
          {
            question: "d((x^5))/dx",
            choices: { "1": "5x^4", "2": "4x^5", "3": "5x^5", "4": "x^4" },
            answer: "7",
          },
        ],
      }),
    ).toThrow();
  });
});

describe("question randomization", () => {
  test("shuffle keeps the same choice set and tracks the correct index", () => {
    const bank = loadBank();
    for (const question of bank.questions) {
      for (let i = 0; i < 50; i++) {
        const { choices, correctIndex } = shuffleChoices(question);
        expect(choices.length).toBe(question.choices.length);
        expect([...choices].sort()).toEqual([...question.choices].sort());
        // The graded index still points at the original correct choice.
        expect(choices[correctIndex]).toBe(question.choices[question.answer]);
      }
    }
  });

  test("shuffle actually varies the order across runs (a static order would fail here)", () => {
    const bank = loadBank();
    const question = bank.questions[0]!;
    const orders = new Set<string>();
    for (let i = 0; i < 100; i++) {
      orders.add(shuffleChoices(question).choices.join("|"));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  test("top and bottom slots are randomized — no choice is pinned to a position", () => {
    // The client typesets the rows in the order it receives them, and shows
    // no numbers, so the vertical position of each choice is the only
    // information the player gets. The shuffle must vary BOTH the first
    // (top) and last (bottom) slots across runs, or a fixed position would
    // let a player infer the answer key from the file's order.
    const bank = loadBank();
    for (const question of bank.questions) {
      const tops = new Set<string>();
      const bottoms = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const { choices } = shuffleChoices(question);
        tops.add(choices[0]!);
        bottoms.add(choices[choices.length - 1]!);
      }
      // A deterministic shuffle would keep the same choice in the same row.
      expect(tops.size).toBeGreaterThan(1);
      expect(bottoms.size).toBeGreaterThan(1);
    }
  });

  test("pickRandomQuestion always returns a question from the bank", () => {
    const bank = loadBank();
    for (let i = 0; i < 50; i++) {
      expect(bank.questions).toContain(pickRandomQuestion(bank));
    }
  });
});