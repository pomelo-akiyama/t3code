import { MATH_FILLER, MATH_INDEX_BASE, MATH_MARKER, type MathFormula } from "./scan";

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  title?: string;
  alt?: string;
  children?: MarkdownNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
    hChildren?: Array<{ type: "text"; value: string }>;
  };
}

function mathNode(formula: MathFormula): MarkdownNode {
  return {
    type: "inlineCode",
    value: formula.tex,
    data: {
      hName: "code",
      hProperties: {
        className: [formula.display ? "language-fork-math-display" : "language-fork-math-inline"],
      },
      hChildren: [{ type: "text", value: formula.tex }],
    },
  };
}

function replaceText(value: string, formulas: readonly MathFormula[]): MarkdownNode[] {
  const result: MarkdownNode[] = [];
  let literal = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === MATH_MARKER) {
      const formulaIndex = (value.charCodeAt(index + 1) || 0) - MATH_INDEX_BASE;
      const formula = formulas[formulaIndex];
      if (formula) {
        if (literal) result.push({ type: "text", value: literal });
        result.push(mathNode(formula));
        literal = "";
        index += 1;
        continue;
      }
    }
    if (character !== MATH_FILLER) literal += character;
  }
  if (literal && (literal.trim() || !value.includes(MATH_FILLER))) {
    result.push({ type: "text", value: literal });
  }
  return result;
}

function restoreUnparsed(value: string, formulas: readonly MathFormula[]): string {
  let restored = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === MATH_MARKER) {
      const formulaIndex = (value.charCodeAt(index + 1) || 0) - MATH_INDEX_BASE;
      const formula = formulas[formulaIndex];
      if (formula) {
        restored += formula.source;
        index += formula.source.length - 1;
        continue;
      }
    }
    if (character !== MATH_FILLER) restored += character;
  }
  return restored;
}

/** Markdown 解析等长占位内容后，将公式还原为带类型的节点。 */
export function remarkForkMath(formulas: readonly MathFormula[]) {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      for (const key of ["url", "title", "alt"] as const) {
        const value = node[key];
        if (typeof value === "string" && value.includes(MATH_MARKER)) {
          node[key] = restoreUnparsed(value, formulas);
        }
      }
      if (
        node.type !== "text" &&
        typeof node.value === "string" &&
        node.value.includes(MATH_MARKER)
      ) {
        node.value = restoreUnparsed(node.value, formulas);
      }
      if (!node.children) return;
      const children: MarkdownNode[] = [];
      for (const child of node.children) {
        if (child.type === "text" && typeof child.value === "string") {
          children.push(...replaceText(child.value, formulas));
          continue;
        }
        visit(child);
        if (child.type === "paragraph" && child.children?.length === 0 && !child.data?.hName)
          continue;
        children.push(child);
      }
      node.children = children;
    };
    visit(tree);
  };
}
