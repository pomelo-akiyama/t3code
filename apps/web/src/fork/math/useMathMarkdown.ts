import { useMemo } from "react";
import type { Options } from "react-markdown";

import { remarkForkMath } from "./plugin";
import { analyzeMathMarkdown } from "./scan";

/** 保留上游插件实例，让流式解析缓存跨消息更新复用。 */
export function useMathMarkdown(
  text: string,
  remarkPlugins: NonNullable<Options["remarkPlugins"]>,
) {
  const math = useMemo(() => analyzeMathMarkdown(text), [text]);
  const plugins = useMemo<NonNullable<Options["remarkPlugins"]>>(
    () =>
      math.formulas.length
        ? [...remarkPlugins, () => remarkForkMath(math.formulas)]
        : remarkPlugins,
    [remarkPlugins, math],
  );
  return { markdown: math.markdown, remarkPlugins: plugins };
}
