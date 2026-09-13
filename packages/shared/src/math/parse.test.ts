/**
 * Parser verification for the quest question typesetter: every question and
 * choice in the real Assets/question.json must parse into the expected AST,
 * so the renderer can typeset fractions (numerator over denominator),
 * superscripts, function applications, and implicit multiplication from a
 * trustable tree instead of string sloppiness. Run with `bun test`.
 */
import { describe, expect, test } from "bun:test";
import { parseMathExpression, type MathExpr } from "./parse";

function num(value: string): MathExpr {
  return { kind: "num", value };
}
function ident(name: string): MathExpr {
  return { kind: "ident", name };
}
function sup(base: MathExpr, exp: MathExpr): MathExpr {
  return { kind: "sup", base, exp };
}
function apply(fn: string, arg: MathExpr): MathExpr {
  return { kind: "apply", fn, arg };
}
function paren(inner: MathExpr): MathExpr {
  return { kind: "paren", inner };
}
function unary(op: "+" | "-", expr: MathExpr): MathExpr {
  return { kind: "unary", op, expr };
}
function binary(
  op: "+" | "-" | "*" | "/",
  left: MathExpr,
  right: MathExpr,
): MathExpr {
  return { kind: "binary", op, left, right };
}
function seq(...terms: MathExpr[]): MathExpr {
  return { kind: "seq", terms };
}

describe("math parser", () => {
  test("1/2 is a fraction: numerator 1 over denominator 2", () => {
    expect(parseMathExpression("1/2")).toEqual(binary("/", num("1"), num("2")));
  });

  test("derivative questions parse as d(...) over dx", () => {
    expect(parseMathExpression("d((x^5))/dx")).toEqual(
      binary("/", apply("d", paren(sup(ident("x"), num("5")))), ident("dx")),
    );
    expect(parseMathExpression("d((3x^2))/dx")).toEqual(
      binary(
        "/",
        apply(
          "d",
          paren(seq(num("3"), sup(ident("x"), num("2")))),
        ),
        ident("dx"),
      ),
    );
    expect(parseMathExpression("d((sin(x)))/dx")).toEqual(
      binary("/", apply("d", paren(apply("sin", ident("x")))), ident("dx")),
    );
    expect(parseMathExpression("d((e^x))/dx")).toEqual(
      binary("/", apply("d", paren(sup(ident("e"), ident("x")))), ident("dx")),
    );
    expect(parseMathExpression("d((ln(x)))/dx")).toEqual(
      binary("/", apply("d", paren(apply("ln", ident("x")))), ident("dx")),
    );
  });

  test("functions, powers, and implicit multiplication in the choices", () => {
    // 5x^4 → implicit multiplication of 5 and x⁴; no explicit star.
    expect(parseMathExpression("5x^4")).toEqual(
      seq(num("5"), sup(ident("x"), num("4"))),
    );
    expect(parseMathExpression("6x")).toEqual(seq(num("6"), ident("x")));
    expect(parseMathExpression("6x^2")).toEqual(
      seq(num("6"), sup(ident("x"), num("2"))),
    );
    expect(parseMathExpression("e^x")).toEqual(sup(ident("e"), ident("x")));
    expect(parseMathExpression("sin(x)")).toEqual(apply("sin", ident("x")));
    expect(parseMathExpression("1/x")).toEqual(binary("/", num("1"), ident("x")));
    expect(parseMathExpression("-cos(x)")).toEqual(
      unary("-", apply("cos", ident("x"))),
    );
    expect(parseMathExpression("tan(x)")).toEqual(apply("tan", ident("x")));
  });

  test("an explicit star stays a binary op (rendered as a middle dot)", () => {
    expect(parseMathExpression("x * e^(x-1)")).toEqual(
      binary(
        "*",
        ident("x"),
        sup(ident("e"), paren(binary("-", ident("x"), num("1")))),
      ),
    );
    expect(parseMathExpression("1/e^x")).toEqual(
      binary("/", num("1"), sup(ident("e"), ident("x"))),
    );
    expect(parseMathExpression("-1/x")).toEqual(
      binary("/", unary("-", num("1")), ident("x")),
    );
  });

  test("malformed input returns null (renderer falls back to plain text)", () => {
    expect(parseMathExpression("")).toBeNull();
    expect(parseMathExpression("   ")).toBeNull();
    expect(parseMathExpression("(x")).toBeNull();
    expect(parseMathExpression("x)")).toBeNull();
    expect(parseMathExpression("x^")).toBeNull();
    expect(parseMathExpression("sin(")).toBeNull();
    expect(parseMathExpression("x @ y")).toBeNull();
    expect(parseMathExpression("2/")).toBeNull();
  });
});