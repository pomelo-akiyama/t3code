import { describe, expect, it } from "vite-plus/test";

import { analyzeMathMarkdown } from "./markdown-math";

describe("analyzeMathMarkdown", () => {
  describe("delimiter conversion", () => {
    it.each([
      {
        name: "inline parentheses",
        input: String.raw`Euler: \(e^{i\pi} = -1\).`,
        normalized: String.raw`Euler: $$e^{i\pi} = -1$$.`,
      },
      {
        name: "single-line brackets",
        input: String.raw`Result: \[x^2\] holds.`,
        normalized: String.raw`Result: $$x^2$$ holds.`,
      },
      {
        name: "display brackets on their own lines",
        input: "Before\n\n\\[\n\\frac{1}{2}\n\\]\n\nAfter",
        normalized: "Before\n\n$$\n\\frac{1}{2}\n$$\n\nAfter",
      },
      {
        name: "display brackets spanning lines with a blank line",
        input: "\\[\nx = 1\n\ny = 2\n\\]",
        normalized: "$$\nx = 1\n\ny = 2\n$$",
      },
      {
        name: "brackets inside a blockquote",
        input: "> \\[\n> x^2\n> \\]",
        normalized: "> $$\n> x^2\n> $$",
      },
      {
        name: "multiple inline expressions",
        input: String.raw`\(a\) and \(b\)`,
        normalized: String.raw`$$a$$ and $$b$$`,
      },
    ])("converts $name", ({ input, normalized }) => {
      const analysis = analyzeMathMarkdown(input);
      expect(analysis.normalizedText).toBe(normalized);
      expect(analysis.hasDelimiterMath).toBe(true);
    });

    it("preserves every offset — delimiters are rewritten in place", () => {
      const input = "before \\(x\\) middle \\[y\\] after";
      const analysis = analyzeMathMarkdown(input);
      expect(analysis.normalizedText).toHaveLength(input.length);
      expect(analysis.normalizedText.indexOf("middle")).toBe(input.indexOf("middle"));
      expect(analysis.normalizedText.indexOf("after")).toBe(input.indexOf("after"));
    });
  });

  describe("single-dollar text stays plain", () => {
    it.each(["$x$", "$HOME and $PATH", "$20 or $30", "kill -9 $$", "costs $$ and more $$"])(
      "%s",
      (input) => {
        const analysis = analyzeMathMarkdown(input);
        expect(analysis.hasDelimiterMath).toBe(false);
        expect(analysis.normalizedText).toBe(input);
      },
    );
  });

  describe("native dollar math", () => {
    it("detects closed inline $$ math", () => {
      const analysis = analyzeMathMarkdown("so $$E=mc^2$$ holds");
      expect(analysis.hasDelimiterMath).toBe(true);
      expect(analysis.normalizedText).toBe("so $$E=mc^2$$ holds");
    });

    it("detects a closed $$ flow block", () => {
      const analysis = analyzeMathMarkdown("$$\nE=mc^2\n$$");
      expect(analysis.hasDelimiterMath).toBe(true);
    });

    it("does not trigger on an unterminated $$ flow block", () => {
      const analysis = analyzeMathMarkdown("$$\nE=mc");
      expect(analysis.hasDelimiterMath).toBe(false);
      expect(analysis.openMathFenceTail).toEqual({ body: "E=mc", start: 0 });
    });

    it("leaves delimiters inside a $$ flow block unconverted", () => {
      const input = "$$\n\\(x\\)\n$$";
      const analysis = analyzeMathMarkdown(input);
      expect(analysis.normalizedText).toBe(input);
      expect(analysis.hasDelimiterMath).toBe(true);
    });
  });

  describe("immunity inside code", () => {
    it.each([
      { name: "single-backtick span", input: "run `\\(x\\)` now" },
      { name: "double-backtick span", input: "run ``\\(x\\)`` now" },
      { name: "span containing a backtick", input: "run `` `\\(x\\)` `` now" },
      { name: "backtick fence", input: "```\n\\(x\\)\n$$y$$\n```" },
      { name: "tilde fence", input: "~~~\n\\[x\\]\n~~~" },
      { name: "fence in a blockquote", input: "> ```\n> \\(x\\)\n> ```" },
      { name: "unterminated fence", input: "```js\n\\(x\\)" },
      { name: "dollar pair split by a fence", input: "$$a\n```\nb$$\n```" },
    ])("$name", ({ input }) => {
      const analysis = analyzeMathMarkdown(input);
      expect(analysis.normalizedText).toBe(input);
      expect(analysis.hasDelimiterMath).toBe(false);
    });

    it("still converts math outside the code construct", () => {
      const analysis = analyzeMathMarkdown("`\\(a\\)` but \\(b\\)");
      expect(analysis.normalizedText).toBe("`\\(a\\)` but $$b$$");
    });
  });

  describe("escaping by backslash-run parity", () => {
    it("does not treat an escaped backslash as a delimiter", () => {
      const input = String.raw`\\(not math\\)`;
      expect(analyzeMathMarkdown(input).normalizedText).toBe(input);
    });

    it("treats a delimiter after an escaped backslash as active", () => {
      const analysis = analyzeMathMarkdown(String.raw`\\\(x\\\)`);
      expect(analysis.normalizedText).toBe(String.raw`\\$$x\\$$`);
    });

    it("does not close on an escaped closer", () => {
      // The closer candidate `\\)` is an escaped backslash and a paren; the
      // real closer comes later.
      const analysis = analyzeMathMarkdown(String.raw`\(a \\) b\)`);
      expect(analysis.normalizedText).toBe(String.raw`$$a \\) b$$`);
    });
  });

  describe("unclosed and mis-shaped delimiters stay as written", () => {
    it.each([
      { name: "unclosed inline", input: "start \\(x" },
      { name: "stray closer", input: "x\\) end" },
      { name: "inline pair split across lines", input: "\\(x\ny\\)" },
      { name: "empty pair", input: "\\(\\)" },
      { name: "bracket pair across a blank line mid-paragraph", input: "a \\[x\n\nc\\] d" },
      { name: "dollar hugging the opener", input: "$\\(x\\)" },
      { name: "dollar hugging the closer", input: "\\(x\\)$" },
      {
        name: "line-start bracket with trailing text after a multi-line closer",
        input: "\\[\nx\n\\] tail",
      },
      {
        name: "line-start bracket with content after the opener across lines",
        input: "\\[ x\ny \\]",
      },
      {
        name: "interleaved delimiters",
        input: String.raw`\(a \[b\) c\]`,
      },
      {
        name: "wrong-type closer inside a pair",
        input: String.raw`\(a \] b\)`,
      },
    ])("$name", ({ input }) => {
      const analysis = analyzeMathMarkdown(input);
      expect(analysis.normalizedText).toBe(input);
      expect(analysis.hasDelimiterMath).toBe(false);
    });

    it("keeps a nested outer pair raw and converts the well-formed inner pair", () => {
      // Nested math delimiters are invalid TeX, so the outer pair cannot
      // convert; the inner pair is closed and well-formed on its own.
      expect(analyzeMathMarkdown(String.raw`\(a \(b\) c\)`).normalizedText).toBe(
        String.raw`\(a $$b$$ c\)`,
      );
      expect(analyzeMathMarkdown(String.raw`\[a \(b\) c\]`).normalizedText).toBe(
        String.raw`\[a $$b$$ c\]`,
      );
    });

    it("converts only the first of two directly adjacent pairs", () => {
      const analysis = analyzeMathMarkdown(String.raw`\(x\)\(y\)`);
      expect(analysis.normalizedText).toBe(String.raw`$$x$$\(y\)`);
    });

    it("converts once the closing delimiter streams in", () => {
      expect(analyzeMathMarkdown("so \\(x^2").hasDelimiterMath).toBe(false);
      const closed = analyzeMathMarkdown("so \\(x^2\\)");
      expect(closed.hasDelimiterMath).toBe(true);
      expect(closed.normalizedText).toBe("so $$x^2$$");
    });
  });

  describe("openMathFenceTail", () => {
    it("reports the body and start offset of a trailing unterminated math fence", () => {
      const analysis = analyzeMathMarkdown("text\n```math\n\\frac{1}{2}");
      expect(analysis.openMathFenceTail).toEqual({
        body: "\\frac{1}{2}",
        start: "text\n".length,
      });
      expect(analysis.hasDelimiterMath).toBe(false);
    });

    it("reports an empty body right after the opening fence", () => {
      expect(analyzeMathMarkdown("```math").openMathFenceTail).toEqual({ body: "", start: 0 });
    });

    it("points at the trailing fence even when an identical closed fence precedes it", () => {
      const closed = "```math\nx^2\n```";
      const input = `${closed}\n\n${closed.slice(0, closed.length - 4)}`;
      const analysis = analyzeMathMarkdown(input);
      expect(analysis.openMathFenceTail).toEqual({ body: "x^2", start: closed.length + 2 });
    });

    it("is null once the fence closes", () => {
      const analysis = analyzeMathMarkdown("```math\nx^2\n```");
      expect(analysis.openMathFenceTail).toBeNull();
      // Fences alone never need the extended remark chain.
      expect(analysis.hasDelimiterMath).toBe(false);
    });

    it("is null for unterminated fences of other languages", () => {
      expect(analyzeMathMarkdown("```mathematica\nx").openMathFenceTail).toBeNull();
      expect(analyzeMathMarkdown("```js\nlet x = 1;").openMathFenceTail).toBeNull();
    });

    it("strips blockquote markers from a quoted fence body", () => {
      const analysis = analyzeMathMarkdown("> ```math\n> x^2");
      expect(analysis.openMathFenceTail).toEqual({ body: "x^2", start: 0 });
    });
  });
});
