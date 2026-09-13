/**
 * Server-side load of the jungle quest question bank
 * (`Assets/question.json`), mirroring `jungle-map.ts`: the Colyseus room
 * reads the same tracked file directly from the repo root that the web
 * client's typesetting consumes (the client receives the raw plain-text
 * strings over the wire). Also the randomization primitives the showquest
 * interaction uses: a uniform random question pick and a Fisher–Yates
 * choice shuffle that tracks the correct index without ever leaking it to
 * the client (grading happens server-side in the room).
 */

/** One question as the room hands it to a player (already in file order). */
export interface JungleQuestion {
  /** Plain-text question in ASCII math notation (the client typesets it). */
  question: string;
  /** The answer choices in the file's canonical order. */
  choices: string[];
  /** Index of the correct choice within `choices` (the file's `answer` key). */
  answer: number;
}

/** The parsed question bank (all questions from Assets/question.json). */
export interface JungleQuestionBank {
  questions: JungleQuestion[];
}

/** Minimal raw JSON shape of Assets/question.json. */
interface RawQuestionFile {
  total_questions?: string | number;
  questions?: unknown[];
}

interface RawQuestion {
  question?: unknown;
  choices?: Record<string, unknown>;
  answer?: unknown;
}

/**
 * Default question-bank location, resolved against this source file so it
 * works from any CWD: apps/server/src/game → repo root (four levels up) →
 * Assets/question.json.
 */
const DEFAULT_QUESTIONS_URL = new URL(
  "../../../../Assets/question.json",
  import.meta.url,
);

/** Override point for tests/deploys (absolute path or relative to CWD). */
const QUESTIONS_PATH_ENV = "JUNGLE_QUESTIONS_PATH";

/**
 * Parses the raw question-bank JSON into canonical-ordered questions.
 * Choices are an object keyed "1".."4" in the file; they are ordered by
 * numeric key so parsing is deterministic, and `answer` (a key string) is
 * resolved to the index it becomes. Throws when the bank or any question
 * is malformed — same fail-fast contract as `parseJungleMap`.
 */
export function parseJungleQuestions(raw: RawQuestionFile): JungleQuestionBank {
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) {
    throw new Error("Question bank has no questions array");
  }
  const questions = raw.questions.map((item, index) => {
    const question = item as RawQuestion;
    if (
      typeof question.question !== "string" ||
      question.question.trim().length === 0
    ) {
      throw new Error(`Question ${index} has no question text`);
    }
    if (
      typeof question.choices !== "object" ||
      question.choices === null ||
      Array.isArray(question.choices)
    ) {
      throw new Error(`Question ${index} has no choices map`);
    }
    const keys = Object.keys(question.choices).sort(
      (a, b) => Number(a) - Number(b),
    );
    if (keys.length === 0) {
      throw new Error(`Question ${index} has no choices`);
    }
    const answerKey = String(question.answer);
    const answer = keys.indexOf(answerKey);
    if (answer < 0) {
      throw new Error(
        `Question ${index} answer key "${answerKey}" not in choices`,
      );
    }
    return {
      question: question.question,
      choices: keys.map((key) => String(question.choices![key])),
      answer,
    };
  });
  return { questions };
}

/** Reads and parses the jungle question bank JSON from disk. */
export async function loadJungleQuestions(
  path: string | undefined = process.env[QUESTIONS_PATH_ENV],
): Promise<JungleQuestionBank> {
  const target = path ? path : DEFAULT_QUESTIONS_URL;
  const file = Bun.file(target);
  if (!(await file.exists())) {
    throw new Error(`Jungle questions not found at ${target}`);
  }
  const raw = (await file.json()) as RawQuestionFile;
  return parseJungleQuestions(raw);
}

/** Picks a uniformly random question from the bank. */
export function pickRandomQuestion(
  bank: JungleQuestionBank,
): JungleQuestion {
  const index = Math.floor(Math.random() * bank.questions.length);
  return bank.questions[index]!;
}

/**
 * Fisher–Yates shuffle of a question's choices, tracking the index of the
 * correct choice through every swap. The returned `correctIndex` is the
 * answer key the server grades against; it is never sent to the client.
 */
export function shuffleChoices(
  question: JungleQuestion,
): { choices: string[]; correctIndex: number } {
  const choices = [...question.choices];
  let correctIndex = question.answer;
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    if (i === correctIndex) {
      correctIndex = j;
    } else if (j === correctIndex) {
      correctIndex = i;
    }
    const tmp = choices[i]!;
    choices[i] = choices[j]!;
    choices[j] = tmp;
  }
  return { choices, correctIndex };
}