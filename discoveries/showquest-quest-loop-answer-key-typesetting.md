# Discovery: showquest quest loop — the answer key stays server-side, the math typesets, and the modal can't wedge

**Date:** 2026-09-13
**Scope:** `packages/shared/src/{math,quest.ts}`,
`apps/server/src/game/quest-bank.ts`, `apps/server/src/rooms/jungle/{interactions,jungle-room,input,server-player}.ts`,
`apps/web/src/game/quest/{math-format,quest-box}.ts`, `scene/{state,update,create}.ts`
**Status:** Fixed

## Symptom

Turning the 315 signpost's `showquest` from a server log line into an actual
question-answer box surfaced three non-obvious constraints that all had to
hold at once:

1. A client that receives the answer key can trivially answer every question
   (the bank is a static file shipped with the repo).
2. The question strings ship in ASCII math notation
   (`d((x^5))/dx`, `5x^4`, `1/e^x`) that is unreadable rendered verbatim.
3. A question that never gets answered — answer dropped in a network blip, or
   the player reloads mid-question — must not permanently wedge that
   player's signpost (one-pending-question gating otherwise blocks every
   future `showquest` forever).
4. Mouse-click selection on the answer rows only worked while the room-locked
   camera sat at scroll (0,0): the rows render screen-fixed through a
   `scrollFactor: 0` container, but Phaser's input hit-test compensates
   pointer coordinates with each object's *own* scrollFactor, not the
   container's — so clicks were tested against a world point offset by the
   camera scroll everywhere else.

## Root cause

**1. Answer-key leakage.** `Assets/question.json` maps each question to an
answer by a *choice key* (`"1"`…`"4"`). If the client received the choices in
file order, or displayed their file key (1–4 labels), a player could read the
`answer` field from the shipped JSON and answer by position. The fix has two
halves: the server shuffles the choices (Fisher–Yates, `shuffleChoices` in
`quest-bank.ts`) while tracking the correct index through every swap, and the
client UI deliberately renders **no numbers** next to the choices — the
shuffled row order is the only information a player gets, so neither the
file's key nor a fixed position leaks the answer. The graded index lives only
in `ServerPlayer.pendingQuest`; `quest:question` carries just `{question,
choices}` and `quest:result` just `{correct}`.

**2. ASCII math needs a typesetter, and the typesetter needs a parse stage.**
The choices/questions are single-line plain text by design (easy to author),
so the client must typeset them: fractions stacked with a rule (the explicit
`1/2` requirement), `^` as a raised superscript, minus as −, explicit `*` as
a middle dot, implicit multiplication as juxtaposition, and `d((x^5))`
collapsed to `d(x⁵)` (an apply whose argument is already parenthesized must
not double-wrap). The parse→AST stage (`packages/shared/src/math/parse.ts`)
is pure and engine-free so it lives in shared and is unit-testable with
`bun test`; the layout stage (`apps/web/src/game/quest/math-format.ts`) is
Phaser-specific (Text/Rectangle objects) and walks that AST. Malformed
strings return null from the parser and fall back to plain text rather than
crashing the box.

**3. The wedging hazard.** One unanswered question per player (`pendingQuest`
nonzero → `showquest` handler returns early) means any path that orphans a
pending question blocks the tile for that session. Two orphans exist:
(a) reload mid-question — the new page has no quest box but keeps the seat
   via `allowReconnection`, and `onReconnect` must clear `pendingQuest`;
(b) the answer itself lost in a blip that auto-reconnects — the box is still
   up client-side but the room (post-`onReconnect` clearing) has no pending
   question, so `quest:answer` is a no-op and `quest:result` never arrives,
   leaving a modal that freezes movement input with no exit.
   The client closes a box that gets no result 3s after answering, so the
   player is never stuck; the next E sends a fresh question.

## Fix

- `packages/shared/src/math/parse.ts` (+ `parse.test.ts`): tokenizer +
  recursive descent → `MathExpr | null` (`num/ident/apply/paren/unary/
  binary/sup/seq`), re-exported from the package index.
- `packages/shared/src/quest.ts`: `quest:question` / `quest:answer` /
  `quest:result` + payload types (no answer index anywhere).
- `apps/server/src/game/quest-bank.ts` (+ test): loads `Assets/question.json`
  (same `../../../../Assets/` resolution + env-override pattern as
  `jungle-map.ts`), `pickRandomQuestion`, `shuffleChoices` with correct-index
  tracking; tests pin that top and bottom row positions vary across shuffles
  and the graded index always points at the original correct string.
- `apps/server/src/rooms/jungle/`: `ServerPlayer.pendingQuest`, the
  `interactions.ts` `showquest` handler (gate + send), the room's
  `onQuestAnswer` (sanitize via `sanitizeQuestAnswer`, bound by
  `choiceCount`, graded, slot cleared, result sent), and `onReconnect`
  clearing the slot.
- `apps/web/src/game/quest/math-format.ts`: the box layout engine (atoms
  measure synchronously on creation, then compose horizontally, into
  fractions with a rectangle rule, or into superscripts anchored ~72% of the
  base font size down).
- `apps/web/src/game/quest/quest-box.ts`: screen-fixed modal
  (`scrollFactor 0`, depth 1000) — click a row (mouse only; the shuffled
  row order is the only information, so keys would be an unlabeled guess),
  highlight the
  pick, Correct!/Wrong feedback, auto-close; `state.questOpen` freezes
  movement input + the E key (update.ts). No number labels on the rows.

  **Input gotcha:** each interactive row must also carry `setScrollFactor(0)`
  (not just its screen-fixed container). Phaser's `InputManager.hitTest`
  compensates pointer coordinates with the *object's own* `scrollFactor`,
  not the container's, so a default-(1,1) child of a (0,0) container is hit
  against a world point offset by the camera scroll — clicks only land when
  the room-locked camera is at scroll (0,0). Matching the row's factor to
  the container's makes the hit-test compensation cancel the scroll exactly.

## Verification

- `bun test` — 85 pass / 0 fail (new: 5 math-parser tests over every real
  question/choice AST, 7 quest-bank tests incl. top/bottom randomization,
  2 showquest-interaction tests: exactly one message + pending reserved, and
  repeat press while pending sends nothing).
- `bun run typecheck` — clean across shared, server, web.
- `bun run build:web` — Turbopack production build passes (validates the new
  `@monkeyluka/shared` exports through `transpilePackages`).
- Live boot: Colyseus server on a scratch port, an SDK client joined the
  jungle room — `onCreate` (map + question-bank load) completed and the
  session left cleanly. The full E-on-signpost flow is exercised by the unit
  tests above (the interaction handler is a clean seam — a fake `send`
  harness stands in for the socket).

## Related

- `discoveries/interaction-tiles-315-e-key-showquest.md` — the interaction
  plumbing this builds on (feet probe, staleness rule, no-kind-fallthrough).
- `packages/shared/AGENTS.md` → "Quest questions & math notation" section;
  `apps/server/AGENTS.md` → "Interaction tiles" step 3;
  `apps/web/AGENTS.md` → the E-key bullet; root `AGENTS.md` → the quest
  bullet.
- Follow-up if scoring ever matters: the room already holds the graded
  result transiently; persist into `PlayerInfo`/a schema field if a quest
  completion counter becomes a product requirement.