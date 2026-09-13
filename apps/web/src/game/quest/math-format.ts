/**
 * Phaser typesetting of the shared `MathExpr` AST: turns the quest bank's
 * plain ASCII math (`1/2`, `x^4`, `d((x^5))/dx`) into proper typeset
 * notation — fractions with the numerator stacked over a rule, `^` as a
 * raised superscript, `-` as U+2212, explicit `*` as a middle dot. Engine-
 * specific (it creates Text/Rectangle objects), unlike the parser in
 * `@monkeyluka/shared` which this walks.
 *
 * Layout model: every expression is sized first (each Text measures itself
 * synchronously on creation — Phaser computes width/height in the
 * constructor) into a box `{ w, h, place(x, y) }` that positions its objects
 * relative to the box's top-left. Boxes compose horizontally, into
 * fractions, or into superscripts; the top-level call anchors the finished
 * expression wherever the caller wants it and hands back every created
 * object (so the quest box can parent them into its container).
 */

import type Phaser from "phaser";
import { parseMathExpression, type MathExpr } from "@monkeyluka/shared";

/** Style for the typeset math (base size; superscripts scale down from it). */
export interface MathRenderStyle {
  /** Base font size in px. */
  fontSize: number;
  /** Text color as a CSS string ("#ffffff"); also colors the fraction rule. */
  color?: string;
}

export interface RenderedMath {
  /** The expression's laid-out size, in local units. */
  readonly width: number;
  readonly height: number;
  /** Every Phaser object created for the expression (add to a container). */
  readonly objects: Phaser.GameObjects.GameObject[];
  /** Position the objects so the expression occupies [0,width]×[0,height] at (x, y). */
  place(x: number, y: number): void;
  /** Destroy every created object. */
  destroy(): void;
}

/** A sized box of positioned objects, anchored top-left. */
interface Box {
  w: number;
  h: number;
  place(x: number, y: number): void;
}

/** "#rrggbb" → the number Phaser fill colors expect (default white). */
function colorToNumber(css: string): number {
  const hex = css.replace(/^#/, "");
  const value = Number.parseInt(hex, 16);
  return Number.isFinite(value) ? value : 0xffffff;
}

/** The default color when a style omits it. */
const DEFAULT_COLOR = "#ffffff";

/** Walks a `MathExpr` into a sized box, remembering created objects. */
function layoutExpr(
  scene: Phaser.Scene,
  expr: MathExpr,
  fontSize: number,
  color: string,
  objects: Phaser.GameObjects.GameObject[],
): Box {
  const horizontal = (parts: Box[], gap: number): Box => {
    const w = parts.reduce(
      (sum, part, i) => sum + part.w + (i + 1 < parts.length ? gap : 0),
      0,
    );
    const h = parts.reduce((max, part) => Math.max(max, part.h), 0);
    return {
      w,
      h,
      place(x, y) {
        let cursor = 0;
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]!;
          part.place(x + cursor, y);
          cursor += part.w + (i + 1 < parts.length ? gap : 0);
        }
      },
    };
  };

  // A single text atom, top-left anchored.
  const atom = (text: string): Box => {
    const label = scene.add.text(0, 0, text, {
      fontFamily: "sans-serif",
      fontSize,
      color,
    });
    objects.push(label);
    return {
      w: label.width,
      h: label.height,
      place(x, y) {
        label.setPosition(x, y);
      },
    };
  };

  const fraction = (numerator: Box, denominator: Box): Box => {
    const padding = 4;
    const rule = 2;
    const gap = 3;
    const w = Math.max(numerator.w, denominator.w) + padding * 2;
    const ruleY = numerator.h + gap;
    const denominatorY = ruleY + rule + gap;
    const h = denominatorY + denominator.h;
    const line = scene.add.rectangle(
      0,
      0,
      w,
      rule,
      colorToNumber(color),
      1,
    );
    objects.push(line);
    return {
      w,
      h,
      place(x, y) {
        numerator.place(x + (w - numerator.w) / 2, y);
        denominator.place(x + (w - denominator.w) / 2, y + denominatorY);
        line.setPosition(x + w / 2, y + ruleY + rule / 2);
      },
    };
  };

  const superscript = (base: Box, exp: Box): Box => {
    const gap = 1;
    // The exponent's baseline sits ~72% of the base font size down from the
    // run's top — under the base's cap height — and the exponent box's
    // bottom is anchored there, so a multi-char exponent ((x-1)) reads as a
    // raised group instead of an inline continuation.
    const expBottom = fontSize * 0.72;
    const w = base.w + gap + exp.w;
    const h = Math.max(base.h, expBottom);
    return {
      w,
      h,
      place(x, y) {
        base.place(x, y);
        exp.place(x + base.w + gap, y + expBottom - exp.h);
      },
    };
  };

  switch (expr.kind) {
    case "num":
      return atom(expr.value);
    case "ident":
      return atom(expr.name);
    case "paren":
      return horizontal([atom("("), layoutExpr(scene, expr.inner, fontSize, color, objects), atom(")")], 0);
    case "apply":
      // `sin(x)` → "sin" + "(" + arg + ")". When the argument is already a
      // parenthesized expression (`d((x^5))`), the outer paren pair comes
      // from the apply itself and the inner group renders unwrapped, so it
      // typesets as `d(x⁵)` rather than `d((x⁵))`.
      if (expr.arg.kind === "paren") {
        return horizontal(
          [
            atom(expr.fn),
            atom("("),
            layoutExpr(scene, expr.arg.inner, fontSize, color, objects),
            atom(")"),
          ],
          0,
        );
      }
      return horizontal(
        [
          atom(expr.fn),
          atom("("),
          layoutExpr(scene, expr.arg, fontSize, color, objects),
          atom(")"),
        ],
        0,
      );
    case "unary":
      return expr.op === "-"
        ? horizontal([atom("\u2212"), layoutExpr(scene, expr.expr, fontSize, color, objects)], 1)
        : layoutExpr(scene, expr.expr, fontSize, color, objects);
    case "binary":
      if (expr.op === "/") {
        return fraction(
          layoutExpr(scene, expr.left, fontSize, color, objects),
          layoutExpr(scene, expr.right, fontSize, color, objects),
        );
      }
      if (expr.op === "*") {
        // Explicit `*` typesets as a middle dot ("x · e^(x-1)"); implicit
        // multiplication goes through `seq`, which renders as juxtaposition.
        return horizontal(
          [
            layoutExpr(scene, expr.left, fontSize, color, objects),
            atom("\u00b7"),
            layoutExpr(scene, expr.right, fontSize, color, objects),
          ],
          3,
        );
      }
      return horizontal(
        [
          layoutExpr(scene, expr.left, fontSize, color, objects),
          atom(expr.op === "-" ? "\u2212" : "+"),
          layoutExpr(scene, expr.right, fontSize, color, objects),
        ],
        4,
      );
    case "sup":
      return superscript(
        layoutExpr(scene, expr.base, fontSize, color, objects),
        layoutExpr(scene, expr.exp, Math.max(8, Math.round(fontSize * 0.62)), color, objects),
      );
    case "seq":
      // Juxtaposition: `5x^4` renders as `5x⁴` with no operator glyph.
      return horizontal(
        expr.terms.map((term) =>
          layoutExpr(scene, term, fontSize, color, objects),
        ),
        0,
      );
  }
}

/** A plain (unparsed) run of text laid out as a single atom. */
function layoutText(
  scene: Phaser.Scene,
  text: string,
  fontSize: number,
  color: string,
  objects: Phaser.GameObjects.GameObject[],
): Box {
  const label = scene.add.text(0, 0, text, {
    fontFamily: "sans-serif",
    fontSize,
    color,
  });
  objects.push(label);
  return {
    w: label.width,
    h: label.height,
    place(x, y) {
      label.setPosition(x, y);
    },
  };
}

/**
 * Typesets a raw ASCII math string: parse it into the shared AST and lay it
 * out with the box model above. Malformed strings (which would otherwise
 * crash the layout walk) fall back to rendering the raw text as one line.
 */
export function renderMathString(
  scene: Phaser.Scene,
  text: string,
  style: MathRenderStyle,
): RenderedMath {
  const color = style.color ?? DEFAULT_COLOR;
  const objects: Phaser.GameObjects.GameObject[] = [];
  const expr = parseMathExpression(text);
  const box =
    expr === null
      ? layoutText(scene, text, style.fontSize, color, objects)
      : layoutExpr(scene, expr, style.fontSize, color, objects);
  return {
    width: box.w,
    height: box.h,
    objects,
    place(x, y) {
      box.place(x, y);
    },
    destroy() {
      for (const object of objects) object.destroy();
    },
  };
}