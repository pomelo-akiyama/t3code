/** 所有聊天消息共用一次按需加载的 KaTeX。 */

export interface MathRuntime {
  readonly katex: typeof import("katex").default;
}

/** 加载完成后，React 的 `use()` 可直接读取状态，不会再次暂停渲染。 */
type InstrumentedPromise<T> = Promise<T> & {
  status?: "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
};

let mathRuntimePromise: InstrumentedPromise<MathRuntime> | null = null;

export function getMathRuntimePromise(): Promise<MathRuntime> {
  if (mathRuntimePromise) return mathRuntimePromise;
  const promise: InstrumentedPromise<MathRuntime> = Promise.all([
    import("katex"),
    import("katex/dist/katex.min.css"),
  ]).then(([katexModule]) => ({
    katex: katexModule.default,
  }));
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
