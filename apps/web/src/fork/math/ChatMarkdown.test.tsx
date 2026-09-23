import { EnvironmentId } from "@t3tools/contracts";
import { type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("../../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../../hooks/useSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/useSettings")>();
  const settings = actual.getClientSettings();
  return {
    ...actual,
    useClientSettings: (select?: (value: typeof settings) => unknown) =>
      select ? select(settings) : settings,
  };
});
vi.mock("../../components/ui/tooltip", async () => {
  const { cloneElement, isValidElement } = await import("react");
  return {
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipTrigger({
      render,
      children,
    }: ComponentProps<typeof import("../../components/ui/tooltip").TooltipTrigger>) {
      if (!isValidElement(render)) return <>{children}</>;
      return children === undefined ? render : cloneElement(render, undefined, children);
    },
    TooltipPopup: () => null,
  };
});
vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../../state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/session")>()),
  usePreparedConnection: () => ({ _tag: "Loading" }),
}));
vi.mock("../../state/entities", () => ({
  readThreadShell: () => null,
  useProjects: () => [],
}));
vi.mock("../../remoteOpen", () => ({
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }),
}));
vi.mock("../../editorPreferences", () => ({
  useOpenInPreferredEditor: () => vi.fn(),
  usePreferredEditor: () => [null, vi.fn()],
}));
vi.mock("~/lib/openPullRequestLink", () => ({
  findProjectForChangeRequest: () => undefined,
  matchesLinkedPullRequestUrl: () => false,
  parseChangeRequestUrl: () => null,
  useOpenChangeRequestLink: () => vi.fn(),
}));

import ChatMarkdown from "../../components/ChatMarkdown";
import { getMathRuntimePromise } from "./runtime";

describe("浏览器聊天公式", () => {
  it("KaTeX 加载期间仍显示消息内容", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown cwd={undefined} text={String.raw`Euler: \(e^{i\pi}=-1\)`} />,
    );
    expect(html).not.toContain('class="katex"');
    expect(html).toContain("e^{i\\pi}=-1");
  });

  it("只按指定行内和行间模式渲染三种分隔符", async () => {
    await getMathRuntimePromise();
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd={undefined}
        text={String.raw`Inline \(a_b\), displays $$x^2$$ and \[\frac{1}{2}\].`}
      />,
    );
    expect(html.match(/chat-markdown-math-inline/g)).toHaveLength(1);
    expect(html.match(/chat-markdown-math-block/g)).toHaveLength(2);
    expect(html.match(/class="katex-display"/g)).toHaveLength(2);
    expect(html).toContain('data-markdown-copy="\\(a_b\\)"');
  });

  it("渲染多行公式并保留未闭合公式原文", async () => {
    await getMathRuntimePromise();
    const closed = renderToStaticMarkup(
      <ChatMarkdown cwd={undefined} text={"Before\n\n\\[\n\\frac{1}{2}\n\\]\n\nAfter"} />,
    );
    expect(closed).toContain("chat-markdown-math-block");
    expect(closed).toContain("After");
    const open = renderToStaticMarkup(
      <ChatMarkdown cwd={undefined} text={"Before \\[\\frac{1}{2}"} isStreaming />,
    );
    expect(open).not.toContain('class="katex"');
  });

  it("下一段公式流式输出时保留已完成的公式", async () => {
    await getMathRuntimePromise();
    const html = renderToStaticMarkup(
      <ChatMarkdown cwd={undefined} text={"$$\nx^2\n$$\n\n$$\ny"} isStreaming />,
    );
    expect(html.match(/class="katex-display"/g)).toHaveLength(1);
    expect(html).toContain("$$");
    expect(html).toContain("y");
  });

  it("保护 TeX 标点并渲染引用块内的公式", async () => {
    await getMathRuntimePromise();
    const html = renderToStaticMarkup(
      <ChatMarkdown cwd={undefined} text={"> \\[\n> a*b_c\n> \\]"} />,
    );
    expect(html).toContain("<blockquote>");
    expect(html).toContain("chat-markdown-math-block");
    expect(html).toContain("a*b_c");
  });

  it("单美元、行内代码和 math 代码块保持普通 Markdown 行为", async () => {
    await getMathRuntimePromise();
    const html = renderToStaticMarkup(
      <ChatMarkdown cwd={undefined} text={"$x$ and `\\(y\\)`\n\n```math\nz^2\n```"} />,
    );
    expect(html).not.toContain('class="katex"');
    expect(html).toContain('data-language="math"');
  });

  it.each([true, false])("保留 HTML 处理规则，parseRawHtml=%s", async (parseRawHtml) => {
    await getMathRuntimePromise();
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd={undefined}
        text={"<script>alert(1)</script>\n\nand \\(x\\)"}
        parseRawHtml={parseRawHtml}
      />,
    );
    expect(html).not.toContain("<script");
    expect(html).toContain("chat-markdown-math-inline");
  });

  it("原始 HTML 块不泄漏内部占位符", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown cwd={undefined} text={"<script>alert(1)</script> \\(x\\)"} />,
    );
    expect(html).not.toContain("\ue000");
    expect(html).not.toContain("\ue001");
  });

  it("Markdown 链接地址不泄漏内部占位符", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown cwd={undefined} text={String.raw`[link](https://example.com/\(x\))`} />,
    );
    expect(html).not.toContain("\ue000");
    expect(html).not.toContain("\ue001");
  });

  it("公式前后的文件芯片和 Codex 指令仍可渲染", async () => {
    await getMathRuntimePromise();
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="/tmp/project"
        environmentId={EnvironmentId.make("env_1")}
        text={
          '[Source](/tmp/project/src/main.ts)\n\n$$\nx^2\n$$\n\n::artifact-template{skill_name="artifact-template-hello-world" skill_directory="/Users/test/.codex/skills/artifact-template-hello-world" display_name="Hello World" artifact_kind="document"}'
        }
        onUseArtifactTemplate={() => undefined}
      />,
    );
    expect(html).toContain("chat-markdown-file-link");
    expect(html).toContain("chat-markdown-math-block");
    expect(html).toContain("chat-markdown-artifact-template");
  });

  it("公式后的任务列表仍对应原文偏移量", async () => {
    await getMathRuntimePromise();
    const text = "\\(x\\)\n\n- [ ] Next";
    const html = renderToStaticMarkup(
      <ChatMarkdown cwd={undefined} text={text} onTaskListChange={() => undefined} />,
    );
    expect(html).toContain(`data-task-marker-offset="${text.indexOf("[ ]")}"`);
  });
});
