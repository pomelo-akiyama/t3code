import { Suspense, use, useMemo } from "react";
import { RenderErrorBoundary } from "../../components/RenderErrorBoundary";

interface MathRuntime {
  readonly katex: typeof import("katex").default;
}

/** 加载完成后，React 的 `use()` 可直接读取状态，不会再次暂停渲染。 */
type InstrumentedPromise<T> = Promise<T> & {
  status?: "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
};

let mathRuntimePromise: InstrumentedPromise<MathRuntime> | null = null;

/** 所有聊天消息共用一次按需加载的 KaTeX。 */
export function getMathRuntimePromise(): Promise<MathRuntime> {
  if (mathRuntimePromise) return mathRuntimePromise;
  const promise: InstrumentedPromise<MathRuntime> = Promise.all([
    import("katex"),
    import("katex/dist/katex.min.css"),
  ]).then(([katexModule]) => ({ katex: katexModule.default }));
  promise.then(
    (value) => {
      promise.status = "fulfilled";
      promise.value = value;
    },
    (reason: unknown) => {
      promise.status = "rejected";
      promise.reason = reason;
      // 加载失败后允许下一条消息重试。
      if (mathRuntimePromise === promise) mathRuntimePromise = null;
    },
  );
  mathRuntimePromise = promise;
  return promise;
}

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
          ? "my-[0.65rem] block overflow-x-auto overflow-y-hidden [&_.katex-display]:my-0"
          : undefined
      }
      data-markdown-math={display ? "block" : "inline"}
      data-markdown-copy={display ? `$$\n${tex}\n$$\n\n` : `\\(${tex}\\)`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** KaTeX 加载期间或加载失败时显示公式原文。 */
export function MathCode({ tex, display }: { tex: string; display: boolean }) {
  const fallback = <code>{tex}</code>;
  return (
    <RenderErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <MathFormula tex={tex} display={display} />
      </Suspense>
    </RenderErrorBoundary>
  );
}
