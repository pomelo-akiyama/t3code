import { renderToStaticMarkup } from "react-dom/server";
import type { Root } from "mdast";
import type { Components, Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Plugin } from "unified";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createIncrementalMarkdownPlugin } from "../../markdown-incremental";
import MathReactMarkdown from "./ReactMarkdown";
import { getMathRuntimePromise } from "./render";

// 上游的插件组合会随版本移动，这里只依赖 react-markdown、remark-gfm 和 ChatMarkdown
// 直接使用的流式增量解析。经由本组件的完整聊天渲染由上游 ChatMarkdown.test.tsx 覆盖。
const REMARK_PLUGINS = [remarkGfm];

/** 模拟用同一处理器重新解析文档片段的上游转换插件。 */
const remarkReparseParagraphs: Plugin<[], Root> = function () {
  return (tree) => {
    tree.children = tree.children.flatMap((node) => {
      if (node.type !== "paragraph" || node.children[0]?.type !== "text") return [node];
      return (this.parse(node.children[0].value) as Root).children;
    });
  };
};
const COMPONENTS: Components = {
  li: ({ node, ...props }) => <li {...props} data-offset={node?.position?.start.offset} />,
  code: ({ node: _node, ...props }) => <code data-upstream-code="" {...props} />,
};

function render(text: string, options: Partial<Options> = {}) {
  return renderToStaticMarkup(
    <MathReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS} {...options}>
      {text}
    </MathReactMarkdown>,
  );
}

function count(html: string, pattern: RegExp) {
  return html.match(pattern)?.length ?? 0;
}

describe("浏览器聊天公式渲染", () => {
  it("KaTeX 加载期间显示公式原文", () => {
    const html = render(String.raw`Euler: \(e^{i\pi}=-1\)`);
    expect(html).not.toContain('class="katex"');
    expect(html).toContain("e^{i\\pi}=-1");
  });

  describe("KaTeX 已加载", () => {
    beforeAll(() => getMathRuntimePromise());

    it("只按指定行内和行间模式渲染三种分隔符", () => {
      const html = render(String.raw`Inline \(a_b\), displays $$x^2$$ and \[\frac{1}{2}\].`);
      expect(count(html, /data-markdown-math="inline"/g)).toBe(1);
      expect(count(html, /data-markdown-math="block"/g)).toBe(2);
      expect(count(html, /class="katex-display"/g)).toBe(2);
      expect(html).toContain('data-markdown-copy="\\(a_b\\)"');
    });

    it("渲染多行和引用块中的公式，保留未闭合公式原文", () => {
      expect(render("Before\n\n\\[\n\\frac{1}{2}\n\\]\n\nAfter")).toMatch(
        /data-markdown-math="block"[\s\S]*After/,
      );
      const quoted = render("> \\[\n> a*b_c\n> \\]");
      expect(quoted).toContain("<blockquote>");
      expect(quoted).toContain("a*b_c");
      expect(render("Before \\[\\frac{1}{2}")).not.toContain('class="katex"');
      const streaming = render("$$\nx^2\n$$\n\n$$\ny");
      expect(count(streaming, /class="katex-display"/g)).toBe(1);
      expect(streaming).toContain("$$");
    });

    it("单美元、行内代码和 math 代码块交回原代码渲染器", () => {
      const html = render("$x$ and `\\(y\\)`\n\n```math\nz^2\n```");
      expect(html).not.toContain('class="katex"');
      expect(count(html, /data-upstream-code/g)).toBe(2);
    });

    it("原始 HTML 和链接地址不泄漏内部占位符", () => {
      // 同一行的原始 HTML 会让整行成为 HTML 块，公式保留原文。
      const html = render("<script>alert(1)</script> \\(x\\)");
      expect(html).toContain("\\(x\\)");
      expect(html).not.toMatch(/[\ue000\ue001]/);
      const link = render(String.raw`[link](https://example.com/\(x\)) \(y\)`);
      expect(link).toContain('data-markdown-math="inline"');
      expect(link).not.toMatch(/[\ue000\ue001]/);
    });

    it("其他插件重新解析的文档片段仍渲染公式", () => {
      const html = render(String.raw`Euler \(e^{i\pi}=-1\)`, {
        remarkPlugins: [...REMARK_PLUGINS, remarkReparseParagraphs],
      });
      expect(html).toContain('data-markdown-math="inline"');
      expect(html).not.toMatch(/[\ue000\ue001]/);
    });

    it("公式后的列表仍对应原文偏移量", () => {
      const text = "$$\nx^2\n$$\n\n\\(x\\)\n\n- [ ] Next";
      expect(render(text)).toContain(`data-offset="${text.indexOf("- [ ]")}"`);
    });

    it("与上游流式增量解析组合时，追加、闭合和修改都保持正确", () => {
      const incremental = createIncrementalMarkdownPlugin();
      const options = { remarkPlugins: [...REMARK_PLUGINS, incremental] };
      const prefix = "\\(x\\)\n\n```text\ncode stays code\n```\n\n";
      const formulas = (html: string) =>
        [...html.matchAll(/<annotation encoding="application\/x-tex">([^<]*)</g)].map(
          (match) => match[1],
        );
      expect(formulas(render(`${prefix}\\[y`, options))).toEqual(["x"]);
      expect(formulas(render(`${prefix}\\[y^2\\]`, options))).toEqual(["x", "y^2"]);
      expect(formulas(render(`${prefix.replace("x", "z")}\\[y^3\\]`, options))).toEqual([
        "z",
        "y^3",
      ]);
    });
  });
});
