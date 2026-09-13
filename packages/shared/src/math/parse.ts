/**
 * A tiny plain-text → math-notation parser for the jungle quest questions.
 *
 * The question bank ships as ASCII strings (`d((x^5))/dx`, `5x^4`, `1/e^x`)
 * because they are easy to author and diff; the web client typesets them
 * properly (fractions stacked over a rule, `^` as raised superscripts, `-`
 * as U+2212, explicit `*` as a middle dot) by walking this AST. Pure and
 * engine-free on purpose: the parse→AST stage is unit-testable with
 * `bun test`, and the Phaser rendering stays out of the shared package.
 *
 * Grammar (recursive descent over a flat token stream):
 *   expr   := term (('+'|'-') term)*
 *   term   := unary (('*'|'/') unary | juxtaposed unary)*
 *   unary  := ('+'|'-') unary | power
 *   power  := primary ('^' unary)?
 *   primary:= number | ident '(' expr ')' | ident | '(' expr ')'
 *
 * The AST encodes the rendering semantics:
 *   - `seq`      — implicit multiplication (juxtaposition): `5x^4`
 *   - `binary *` — explicit `*` (rendered as a middle dot, e.g. `x * e^(x-1)`)
 *   - `binary /` — a fraction: numerator over a rule over the denominator
 *   - `apply`    — a bare name applied to a parenthesized argument
 *     (`sin(x)`, `d(x^5)`); an already-parenthesized argument is NOT
 *     double-wrapped, so `d((x^5))` typesets as `d(x⁵)`.
 *   - `sup`      — a raised exponent box (`x^4`, `e^(x-1)`)
 *   - `paren`    — a parenthesized sub-expression
 *
 * Returns null on malformed input (rendering falls back to plain text).
 */

/**
 * A typed math expression tree. Every atom is top-left-anchored when laid
 * out; fractions and superscripts are their own box kinds so the renderer
 * can treat them structurally instead of as flattened strings.
 */
export type MathExpr =
  /** A numeric literal (`5`, `12.5`). */
  | { kind: "num"; value: string }
  /** A bare identifier (`x`, `e`, `dx`, `sin`). */
  | { kind: "ident"; name: string }
  /** A named function applied to one argument (`sin(x)`, `d(x^5)`). */
  | { kind: "apply"; fn: string; arg: MathExpr }
  /** A parenthesized sub-expression (`(x-1)`). */
  | { kind: "paren"; inner: MathExpr }
  /** A unary sign: `-x` (a plus is kept but renders as its operand). */
  | { kind: "unary"; op: "+" | "-"; expr: MathExpr }
  /** A binary operator; `/` typesets as a fraction, `*` as a middle dot. */
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: MathExpr; right: MathExpr }
  /** A superscript: `x^4`, `e^(x-1)` (the exponent box is raised). */
  | { kind: "sup"; base: MathExpr; exp: MathExpr }
  /** Implicit multiplication — juxtaposition (`5x^4` = `5` × `x^4`). */
  | { kind: "seq"; terms: MathExpr[] };

interface MathToken {
  type: "num" | "ident" | "op";
  value: string;
}

/** Splits an input string into maximal numeric/identifier runs and ops. */
function tokenize(input: string): MathToken[] {
  const tokens: MathToken[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let j = i + 1;
      while (j < input.length && /[0-9.]/.test(input[j]!)) j++;
      tokens.push({ type: "num", value: input.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      let j = i + 1;
      while (j < input.length && /[a-zA-Z]/.test(input[j]!)) j++;
      tokens.push({ type: "ident", value: input.slice(i, j) });
      i = j;
      continue;
    }
    tokens.push({ type: "op", value: ch });
    i++;
  }
  return tokens;
}

/**
 * Parses a plain-text math expression into its AST, or null when the input
 * is malformed (unbalanced parens, trailing operators, unknown characters,
 * empty string). Null inputs render as plain text by the typesetter.
 */
export function parseMathExpression(input: string): MathExpr | null {
  const tokens = tokenize(input);
  if (tokens.length === 0) return null;
  let pos = 0;
  const peek = (): MathToken | undefined => tokens[pos];
  const next = (): MathToken | undefined => tokens[pos++];

  const parseExpr = (): MathExpr | null => {
    const left = parseTerm();
    if (left === null) return null;
    let node = left;
    for (;;) {
      const tok = peek();
      if (tok?.type === "op" && (tok.value === "+" || tok.value === "-")) {
        next();
        const right = parseTerm();
        if (right === null) return null;
        node = { kind: "binary", op: tok.value, left: node, right };
      } else {
        return node;
      }
    }
  };

  const parseTerm = (): MathExpr | null => {
    const first = parseUnary();
    if (first === null) return null;
    let node = first;
    for (;;) {
      const tok = peek();
      if (tok?.type === "op" && (tok.value === "*" || tok.value === "/")) {
        next();
        const right = parseUnary();
        if (right === null) return null;
        node = { kind: "binary", op: tok.value, left: node, right };
      } else if (
        tok !== undefined &&
        (tok.type === "num" ||
          tok.type === "ident" ||
          tok.value === "(")
      ) {
        // Implicit multiplication (juxtaposition): `5x^4`, `6x`, `2(x+1)`.
        const right = parseUnary();
        if (right === null) return null;
        const terms =
          node.kind === "seq" ? [...node.terms, right] : [node, right];
        node = { kind: "seq", terms };
      } else {
        return node;
      }
    }
  };

  const parseUnary = (): MathExpr | null => {
    const tok = peek();
    if (tok?.type === "op" && (tok.value === "+" || tok.value === "-")) {
      next();
      const expr = parseUnary();
      if (expr === null) return null;
      return { kind: "unary", op: tok.value, expr };
    }
    return parsePower();
  };

  const parsePower = (): MathExpr | null => {
    const base = parsePrimary();
    if (base === null) return null;
    const tok = peek();
    if (tok?.type === "op" && tok.value === "^") {
      next();
      const exp = parseUnary();
      if (exp === null) return null;
      return { kind: "sup", base, exp };
    }
    return base;
  };

  const parsePrimary = (): MathExpr | null => {
    const tok = next();
    if (tok === undefined) return null;
    if (tok.type === "num") return { kind: "num", value: tok.value };
    if (tok.type === "ident") {
      // Function application: `sin(x)` — only when a paren immediately
      // follows (a lone `e`/`dx` stays an identifier).
      if (peek()?.type === "op" && peek()!.value === "(") {
        next();
        const arg = parseExpr();
        if (arg === null) return null;
        const close = next();
        if (close?.value !== ")") return null;
        return { kind: "apply", fn: tok.value, arg };
      }
      return { kind: "ident", name: tok.value };
    }
    if (tok.value === "(") {
      const inner = parseExpr();
      if (inner === null) return null;
      const close = next();
      if (close?.value !== ")") return null;
      return { kind: "paren", inner };
    }
    return null;
  };

  const result = parseExpr();
  return result !== null && pos === tokens.length ? result : null;
}