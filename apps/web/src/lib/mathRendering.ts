/**
 * Lazily loaded math runtime, mirroring `syntaxHighlighting.ts`: one
 * module-level cached promise shared by every ChatMarkdown instance.
 *
 * Nothing math-related may be statically imported anywhere in the app.
 * `micromark-extension-math` re-exports `mathHtml`, which imports katex, and
 * katex does not declare `sideEffects: false` — keeping the entire family
 * behind this one dynamic import makes the "no katex in the entry chunk"
 * guarantee structural instead of hoping for tree-shaking.
 */

export interface MathRuntime {
  readonly remarkMath: typeof import("remark-math").default;
  readonly katex: typeof import("katex").default;
}

/**
 * React's `use()` reads `status`/`value` off a thenable synchronously once
 * they are set, so an already-loaded runtime renders math in the same pass
 * instead of re-suspending.
 */
type InstrumentedPromise<T> = Promise<T> & {
  status?: "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
};

let mathRuntimePromise: InstrumentedPromise<MathRuntime> | null = null;

export function getMathRuntimePromise(): Promise<MathRuntime> {
  if (mathRuntimePromise) return mathRuntimePromise;
  const promise: InstrumentedPromise<MathRuntime> = Promise.all([
    import("remark-math"),
    import("katex"),
    // Vite emits the stylesheet as an async chunk; fonts load on demand from CSS.
    import("katex/dist/katex.min.css"),
  ]).then(([remarkMathModule, katexModule]) => ({
    remarkMath: remarkMathModule.default,
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
      // Drop the failed load so a later message retries instead of falling
      // back to raw text forever.
      if (mathRuntimePromise === promise) mathRuntimePromise = null;
    },
  );
  mathRuntimePromise = promise;
  return promise;
}
