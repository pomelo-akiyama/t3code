import { describe, expect, it } from "vite-plus/test";
import { analyzeMathMarkdown } from "./scan";

describe("浏览器聊天公式扫描", () => {
  it.each([
    { text: String.raw`Euler \(e^{i\pi}=-1\)`, tex: String.raw`e^{i\pi}=-1`, display: false },
    { text: String.raw`\[x^2\]`, tex: "x^2", display: true },
    { text: "$$x^2$$", tex: "x^2", display: true },
    { text: "$$\nx^2\n$$", tex: "x^2", display: true },
    { text: "\\[\nx^2\n\\]", tex: "\nx^2\n", display: true },
  ])("只识别已闭合的公式 $text", ({ text, tex, display }) => {
    const analysis = analyzeMathMarkdown(text);
    expect(analysis.formulas).toHaveLength(1);
    expect(analysis.formulas[0]).toMatchObject({ tex, display });
    expect(analysis.markdown.length).toBe(text.length);
  });

  it.each([
    String.raw`$x$`,
    String.raw`\(x`,
    String.raw`\[x`,
    "$$\nx",
    String.raw`\\(x\\)`,
    String.raw`\(x \[y\)`,
    "`\\(x\\)`",
    "```math\nx^2\n```",
    "~~~\n$$x$$\n~~~",
    "    \\(x\\)",
  ])("保留不支持或受代码保护的内容：%s", (text) => {
    const analysis = analyzeMathMarkdown(text);
    expect(analysis.formulas).toEqual([]);
    expect(analysis.markdown).toBe(text);
  });

  it("保留行间公式后续内容的原文偏移量", () => {
    const text = '$$\nx^2\n$$\n\n::artifact-template{skill_name="sample"}';
    const analysis = analyzeMathMarkdown(text);
    expect(analysis.formulas).toHaveLength(1);
    expect(analysis.formulas[0]?.end).toBe(text.indexOf("\n\n::artifact"));
    expect(analysis.markdown.slice(text.indexOf("::artifact"))).toBe(
      text.slice(text.indexOf("::artifact")),
    );
  });

  it("分别识别相邻公式", () => {
    const analysis = analyzeMathMarkdown(String.raw`\(x\)\(y\)`);
    expect(analysis.formulas.map((formula) => formula.tex)).toEqual(["x", "y"]);
  });

  it("识别引用块中的公式并保留后续内容偏移量", () => {
    const text = "> \\[\n> x^2\n> \\]\n\n- [ ] next";
    const analysis = analyzeMathMarkdown(text);
    expect(analysis.formulas).toHaveLength(1);
    expect(analysis.formulas[0]?.tex).toBe("\nx^2\n");
    expect(analysis.markdown.indexOf("- [ ] next")).toBe(text.indexOf("- [ ] next"));
  });
});
