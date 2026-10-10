import { useMemo } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";

import { remarkForkMath } from "./plugin";
import { MathCode } from "./render";

type CodeComponent = Extract<NonNullable<Components["code"]>, (...args: never[]) => unknown>;

const DefaultCode: CodeComponent = ({ node: _node, ...props }) => <code {...props} />;
const NO_COMPONENTS: Components = {};
const mathComponentsCache = new WeakMap<Components, Components>();

/** 包装结果按组件表缓存，组件类型保持稳定，React 不会因此重新挂载节点。 */
function withMathCode(components: Components): Components {
  const cached = mathComponentsCache.get(components);
  if (cached) return cached;
  // 标签名形式的 `code` 组件按普通 `<code>` 处理。
  const Code = typeof components.code === "function" ? components.code : DefaultCode;
  const result: Components = {
    ...components,
    code: function ForkMathCode(props) {
      const classes = props.className?.split(/\s+/) ?? [];
      const display = classes.includes("language-fork-math-display");
      if (!display && !classes.includes("language-fork-math-inline")) return <Code {...props} />;
      return <MathCode tex={String(props.children ?? "")} display={display} />;
    },
  };
  mathComponentsCache.set(components, result);
  return result;
}

/** 与 react-markdown 用法相同，额外渲染 `\(...\)`、`\[...\]` 和 `$$...$$` 公式。 */
export default function MathReactMarkdown({ remarkPlugins, components, ...options }: Options) {
  const plugins = useMemo(() => [...(remarkPlugins ?? []), remarkForkMath], [remarkPlugins]);
  return (
    <ReactMarkdown
      {...options}
      remarkPlugins={plugins}
      components={withMathCode(components ?? NO_COMPONENTS)}
    />
  );
}
