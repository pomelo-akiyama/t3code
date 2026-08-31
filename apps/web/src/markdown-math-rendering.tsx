import React, { Suspense, use, useMemo, type ReactNode } from "react";
import type { Components, Options as ReactMarkdownOptions } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { RenderErrorBoundary } from "./components/RenderErrorBoundary";
import { getMathRuntimePromise, type MathRuntime } from "./lib/mathRendering";
import type { MathMarkdownAnalysis, OpenMathFenceTail } from "./markdown-math";

type RemarkPlugins = NonNullable<ReactMarkdownOptions["remarkPlugins"]>;

export interface MathRemarkPluginSegments {
  /** Plugins that must run before remark-math parses delimiter nodes. */
  readonly beforeMath: RemarkPlugins;
  /** Plugins that consume or normalize the parsed markdown tree. */
  readonly afterMath: RemarkPlugins;
}

const MATH_REMARK_PLUGIN_OPTIONS = { singleDollarTextMath: false };
const mathRemarkPluginCache = new WeakMap<MathRemarkPluginSegments, RemarkPlugins>();

function mathRemarkPluginsFor(
  runtime: MathRuntime,
  segments: MathRemarkPluginSegments,
): RemarkPlugins {
  const cached = mathRemarkPluginCache.get(segments);
  if (cached) return cached;
  const plugins: RemarkPlugins = [
    ...segments.beforeMath,
    [runtime.remarkMath, MATH_REMARK_PLUGIN_OPTIONS],
    ...segments.afterMath,
  ];
  mathRemarkPluginCache.set(segments, plugins);
  return plugins;
}

/**
 * KaTeX output shares Shiki's trust model: generated client-side from a text
 * node that already went through sanitization, with KaTeX escaping its input.
 * `data-markdown-copy` makes highlight-and-copy round-trip to `$$` markdown;
 * the HTML clipboard flavor already strips KaTeX's `aria-hidden` visual layer,
 * leaving the MathML for rich-paste targets.
 */
function MathBlock({ tex }: { tex: string }) {
  const { katex } = use(getMathRuntimePromise());
  const html = useMemo(
    () => katex.renderToString(tex, { displayMode: true, throwOnError: false }),
    [katex, tex],
  );
  return (
    <div
      className="chat-markdown-math-block my-[0.65rem] overflow-x-auto overflow-y-hidden [&_.katex-display]:my-0"
      data-markdown-copy={`$$\n${tex}\n$$\n\n`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function MathInline({ tex }: { tex: string }) {
  const { katex } = use(getMathRuntimePromise());
  const html = useMemo(
    () => katex.renderToString(tex, { displayMode: false, throwOnError: false }),
    [katex, tex],
  );
  return (
    <span
      className="chat-markdown-math-inline"
      data-markdown-copy={`$$${tex}$$`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

interface MathRuntimeMarkdownProps {
  readonly text: string;
  readonly remarkPluginSegments: MathRemarkPluginSegments;
  readonly rehypePlugins: ReactMarkdownOptions["rehypePlugins"];
  readonly components: Components;
  readonly urlTransform: NonNullable<ReactMarkdownOptions["urlTransform"]>;
}

/** The base renderer with remark-math spliced in after the runtime loads. */
function MathRuntimeMarkdown({
  text,
  remarkPluginSegments,
  rehypePlugins,
  components,
  urlTransform,
}: MathRuntimeMarkdownProps) {
  const runtime = use(getMathRuntimePromise());
  return (
    <ReactMarkdown
      remarkPlugins={mathRemarkPluginsFor(runtime, remarkPluginSegments)}
      rehypePlugins={rehypePlugins}
      skipHtml={false}
      components={components}
      urlTransform={urlTransform}
    >
      {text}
    </ReactMarkdown>
  );
}

interface MathMarkdownProps extends Omit<MathRuntimeMarkdownProps, "text"> {
  readonly analysis: MathMarkdownAnalysis;
  readonly fallback: ReactNode;
}

/** Keeps ordinary messages on the base renderer and lazily enables delimiter math. */
export function MathMarkdown({ analysis, fallback, ...props }: MathMarkdownProps) {
  if (!analysis.hasDelimiterMath) return fallback;
  return (
    <RenderErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <MathRuntimeMarkdown text={analysis.normalizedText} {...props} />
      </Suspense>
    </RenderErrorBoundary>
  );
}

interface RenderInlineMathOptions {
  readonly className: string | undefined;
  readonly readTex: () => string;
  readonly fallback: ReactNode;
}

/** Returns null when a react-markdown code node is ordinary inline code. */
export function renderInlineMath({ className, readTex, fallback }: RenderInlineMathOptions) {
  if (!className?.split(/\s+/).includes("language-math")) return null;
  return (
    <RenderErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <MathInline tex={readTex()} />
      </Suspense>
    </RenderErrorBoundary>
  );
}

interface RenderDisplayMathOptions {
  readonly language: string;
  readonly code: string;
  readonly fallback: ReactNode;
  readonly isStreaming: boolean;
  readonly openMathFenceTail: OpenMathFenceTail | null;
  readonly nodeStartOffset: number | undefined;
}

/**
 * Returns null for ordinary code and for the trailing unterminated math fence
 * of a streaming message. The caller renders both cases as a code block.
 */
export function renderDisplayMath({
  language,
  code,
  fallback,
  isStreaming,
  openMathFenceTail,
  nodeStartOffset,
}: RenderDisplayMathOptions) {
  if (language !== "math") return null;
  const tex = code.replace(/\n$/, "");
  const isStreamingTail =
    isStreaming &&
    openMathFenceTail != null &&
    (nodeStartOffset != null
      ? nodeStartOffset >= openMathFenceTail.start
      : tex.trimEnd() === openMathFenceTail.body.trimEnd());
  if (isStreamingTail) return null;
  return (
    <RenderErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <MathBlock tex={tex} />
      </Suspense>
    </RenderErrorBoundary>
  );
}
