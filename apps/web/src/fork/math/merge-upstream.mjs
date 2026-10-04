import * as NodeUtil from "node:util";

const markdownImports = `import { renderMathCode } from "../fork/math/render";
import { useMathMarkdown } from "../fork/math/useMathMarkdown";
`;
const mathRenderer = `    if (className?.includes("language-fork-math-")) {
      const math = renderMathCode({
        className,
        readTex: () => nodeToPlainText(children),
        fallback: <code {...props}>{children}</code>,
      });
      if (math) return math;
    }
`;
const mathHook = "  const math = useMathMarkdown(text, remarkPlugins);\n\n";

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) {
    throw new Error(`公式接入位置已改变，需要人工检查：${before.trim()}`);
  }
  return source.replace(before, after);
}

/** 只移除已知的公式接入，其他本地修改仍参加 Git 三方合并。 */
export function stripMathIntegration(source) {
  if (!source.includes('from "../fork/math/')) return source;
  source = replaceOnce(source, markdownImports, "");
  source = replaceOnce(source, mathRenderer, "");
  source = replaceOnce(source, mathHook, "");
  source = replaceOnce(
    source,
    "remarkPlugins={math.remarkPlugins}",
    "remarkPlugins={remarkPlugins}",
  );
  return replaceOnce(source, "{math.markdown}", "{text}");
}

/** 接入点必须唯一匹配，上游重构时停止，避免静默丢失渲染行为。 */
export function addMathIntegration(source) {
  if (source.includes('from "../fork/math/')) throw new Error("公式接入尚未移除");
  source = replaceOnce(
    source,
    'import { GitHubIcon } from "./Icons";',
    `${markdownImports}import { GitHubIcon } from "./Icons";`,
  );
  source = replaceOnce(
    source,
    "    if (node?.properties?.dataInlineCode != null) {",
    `${mathRenderer}    if (node?.properties?.dataInlineCode != null) {`,
  );
  source = replaceOnce(
    source,
    "  // react-markdown converts unparsed HTML nodes",
    `${mathHook}  // react-markdown converts unparsed HTML nodes`,
  );
  source = replaceOnce(
    source,
    "remarkPlugins={remarkPlugins}",
    "remarkPlugins={math.remarkPlugins}",
  );
  return replaceOnce(
    source,
    "          {text}\n        </ReactMarkdown>",
    "          {math.markdown}\n        </ReactMarkdown>",
  );
}

/** 对 JSON 字段做三方合并，双方改动同一值时不猜测优先级。 */
export function mergePackageJson(base, ours, theirs, path = "package.json") {
  if (NodeUtil.isDeepStrictEqual(ours, theirs) || NodeUtil.isDeepStrictEqual(base, theirs))
    return ours;
  if (NodeUtil.isDeepStrictEqual(base, ours)) return theirs;
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (![base, ours, theirs].every(object)) throw new Error(`依赖清单存在语义冲突：${path}`);
  const merged = {};
  for (const key of new Set([...Object.keys(theirs), ...Object.keys(ours), ...Object.keys(base)])) {
    const value = mergePackageJson(base[key], ours[key], theirs[key], `${path}.${key}`);
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

export function selectLatestStableTag(tags) {
  return tags
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .sort((a, b) => {
      const left = a.match(/\d+/g).map(BigInt);
      const right = b.match(/\d+/g).map(BigInt);
      for (let index = 0; index < Math.max(left.length, right.length); index++) {
        const difference = (left[index] ?? 0n) - (right[index] ?? 0n);
        if (difference) return difference > 0n ? 1 : -1;
      }
      return 0;
    })
    .at(-1);
}
