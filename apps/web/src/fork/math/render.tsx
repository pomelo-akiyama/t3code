import { Suspense, use, useMemo, type ReactNode } from "react";
import { RenderErrorBoundary } from "../../components/RenderErrorBoundary";
import { getMathRuntimePromise } from "./runtime";

function MathFormula({ tex, display }: { tex: string; display: boolean }) {
  const { katex } = use(getMathRuntimePromise());
  const html = useMemo(
    () => katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false }),
    [display, katex, tex],
  );
  return (
    <span
      className={
        display
          ? "chat-markdown-math-block my-[0.65rem] block overflow-x-auto overflow-y-hidden [&_.katex-display]:my-0"
          : "chat-markdown-math-inline"
      }
      data-markdown-copy={display ? `$$\n${tex}\n$$\n\n` : `\\(${tex}\\)`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function renderMathCode(input: {
  className: string | undefined;
  readTex: () => string;
  fallback: ReactNode;
}): ReactNode | null {
  const classes = input.className?.split(/\s+/) ?? [];
  const display = classes.includes("language-fork-math-display");
  if (!display && !classes.includes("language-fork-math-inline")) return null;
  return (
    <RenderErrorBoundary fallback={input.fallback}>
      <Suspense fallback={input.fallback}>
        <MathFormula tex={input.readTex()} display={display} />
      </Suspense>
    </RenderErrorBoundary>
  );
}
