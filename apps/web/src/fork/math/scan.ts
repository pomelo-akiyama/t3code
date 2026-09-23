/** 在 CommonMark 处理转义前识别三种受支持的公式分隔符。 */
import { LRUCache } from "../../lib/lruCache";

export interface MathFormula {
  readonly start: number;
  readonly end: number;
  readonly source: string;
  readonly tex: string;
  readonly display: boolean;
}

export interface MathMarkdownAnalysis {
  readonly markdown: string;
  readonly formulas: readonly MathFormula[];
}

const FAST_PATH_PATTERN = /\$\$|\\\(|\\\[/;
const MATH_MARKER = "\ue000";
const MATH_FILLER = "\ue001";
const MATH_INDEX_BASE = 0xe100;
const MAX_FORMULAS = 0xf8ff - MATH_INDEX_BASE + 1;

const MAX_ANALYSIS_CACHE_ENTRIES = 200;
const MAX_ANALYSIS_CACHE_MEMORY_BYTES = 8 * 1024 * 1024;

/** 流式重绘可能重复分析同一段消息，因此按完整原文缓存结果。 */
const analysisCache = new LRUCache<MathMarkdownAnalysis>(
  MAX_ANALYSIS_CACHE_ENTRIES,
  MAX_ANALYSIS_CACHE_MEMORY_BYTES,
);

export function analyzeMathMarkdown(text: string): MathMarkdownAnalysis {
  if (!FAST_PATH_PATTERN.test(text)) {
    return { markdown: text, formulas: [] };
  }
  const cached = analysisCache.get(text);
  if (cached) return cached;
  const analysis = analyze(text);
  analysisCache.set(text, analysis, text.length * 3 + 64);
  return analysis;
}

/** 公式分隔符在这段半开区间内不生效。 */
interface Region {
  readonly start: number;
  readonly end: number;
  /** 块区域会中断分隔符配对，行内代码区域只需跳过。 */
  readonly block: boolean;
}

function analyze(text: string): MathMarkdownAnalysis {
  const blocks = scanBlocks(text);
  const regions = withInlineCodeSpanRegions(text, blocks.regions);
  const formulas = [...blocks.formulas, ...scanInlineDelimiters(text, regions)]
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_FORMULAS);
  if (formulas.length === 0) return { markdown: text, formulas };

  // 替换前后的 UTF-16 长度相同，Markdown 节点仍能使用原文偏移量。
  const characters = text.split("");
  for (const [index, formula] of formulas.entries()) {
    let linePrefix = false;
    for (let offset = formula.start; offset < formula.end; offset += 1) {
      const char = text[offset];
      if (char === "\n" || char === "\r") {
        linePrefix = true;
        continue;
      }
      if (linePrefix && (char === " " || char === "\t" || char === ">")) continue;
      linePrefix = false;
      characters[offset] = MATH_FILLER;
    }
    characters[formula.start] = MATH_MARKER;
    characters[formula.start + 1] = String.fromCharCode(MATH_INDEX_BASE + index);
  }
  return { markdown: characters.join(""), formulas };
}

export { MATH_FILLER, MATH_INDEX_BASE, MATH_MARKER };

interface BlockScan {
  readonly regions: Region[];
  readonly formulas: MathFormula[];
}

interface OpenBlock {
  readonly kind: "fence" | "flow";
  readonly marker: "`" | "~" | "$";
  readonly size: number;
  readonly indent: number;
  readonly quoteDepth: number;
  readonly start: number;
  readonly markerStart: number;
  readonly body: string[];
}

/** 按行识别代码围栏和多行双美元公式，也处理引用块。 */
function scanBlocks(text: string): BlockScan {
  const regions: Region[] = [];
  const formulas: MathFormula[] = [];
  let open: OpenBlock | null = null;

  let lineStart = 0;
  for (;;) {
    const newlineIndex = text.indexOf("\n", lineStart);
    const lineEnd = newlineIndex === -1 ? text.length : newlineIndex;
    const line = text.slice(lineStart, lineEnd);

    let stripped = line;
    let quoteDepth = 0;
    for (;;) {
      const match = /^ {0,3}> ?/.exec(stripped);
      if (!match) break;
      stripped = stripped.slice(match[0].length);
      quoteDepth += 1;
    }

    for (;;) {
      if (open) {
        if (quoteDepth < open.quoteDepth) {
          // 引用块已经结束，当前行需要重新判断。
          regions.push({ start: open.start, end: lineStart, block: true });
          open = null;
          continue;
        }
        if (closesBlock(stripped, open)) {
          if (open.kind === "flow") {
            const tex = open.body.join("\n");
            if (tex.trim()) {
              formulas.push({
                start: open.markerStart,
                end: lineEnd,
                source: text.slice(open.markerStart, lineEnd),
                tex,
                display: true,
              });
            }
          }
          regions.push({
            start: open.start,
            end: newlineIndex === -1 ? text.length : lineEnd + 1,
            block: true,
          });
          open = null;
        } else if (open.kind === "flow") {
          open.body.push(stripBodyIndent(stripped, open.indent));
        }
        break;
      }
      if (leadingSpaceCount(stripped) >= 4) {
        regions.push({
          start: lineStart,
          end: newlineIndex === -1 ? text.length : lineEnd + 1,
          block: true,
        });
        break;
      }
      const opened = openBlockFromLine(
        stripped,
        quoteDepth,
        lineStart,
        line.length - stripped.length,
      );
      if (opened) open = opened;
      break;
    }

    if (newlineIndex === -1) break;
    lineStart = newlineIndex + 1;
  }

  if (open) {
    regions.push({ start: open.start, end: text.length, block: true });
  }

  return { regions, formulas };
}

function leadingSpaceCount(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === " ") count += 1;
  return count;
}

function runEndFrom(text: string, from: number, character: string): number {
  let index = from;
  while (index < text.length && text[index] === character) index += 1;
  return index;
}

function closesBlock(stripped: string, open: OpenBlock): boolean {
  const indent = leadingSpaceCount(stripped);
  if (indent > 3) return false;
  const runEnd = runEndFrom(stripped, indent, open.marker);
  const size = runEnd - indent;
  if (open.kind === "flow" ? size !== 2 : size < open.size) return false;
  return /^[ \t]*$/.test(stripped.slice(runEnd));
}

function openBlockFromLine(
  stripped: string,
  quoteDepth: number,
  lineStart: number,
  quotePrefixLength: number,
): OpenBlock | null {
  const indent = leadingSpaceCount(stripped);
  if (indent > 3) return null;
  const first = stripped[indent];

  if (first === "`" || first === "~") {
    const runEnd = runEndFrom(stripped, indent, first);
    const size = runEnd - indent;
    if (size < 3) return null;
    const info = stripped.slice(runEnd);
    if (first === "`" && info.includes("`")) return null;
    return {
      kind: "fence",
      marker: first,
      size,
      indent,
      quoteDepth,
      start: lineStart,
      markerStart: lineStart + quotePrefixLength + indent,
      body: [],
    };
  }

  if (first === "$") {
    const runEnd = runEndFrom(stripped, indent, "$");
    const size = runEnd - indent;
    if (size !== 2 || stripped.slice(runEnd).trim()) return null;
    return {
      kind: "flow",
      marker: "$",
      size,
      indent,
      quoteDepth,
      start: lineStart,
      markerStart: lineStart + quotePrefixLength + indent,
      body: [],
    };
  }

  return null;
}

function stripBodyIndent(stripped: string, indent: number): string {
  let removed = 0;
  while (removed < indent && stripped[removed] === " ") removed += 1;
  return stripped.slice(removed);
}

/** 判断指定换行符后是否紧接空行。 */
function isBlankLineAfter(text: string, newlinePos: number): boolean {
  let index = newlinePos + 1;
  while (index < text.length && (text[index] === " " || text[index] === "\t")) index += 1;
  return index >= text.length || text[index] === "\n";
}

/** 查找长度恰好匹配的结束符，跳过行内代码，遇到块区域或空行即停止。 */
function findClosingRun(
  text: string,
  regions: readonly Region[],
  startRegionIndex: number,
  from: number,
  character: string,
  size: number,
): number {
  let index = from;
  let regionIndex = startRegionIndex;
  while (index < text.length) {
    let region = regions[regionIndex];
    while (region && index >= region.end) {
      regionIndex += 1;
      region = regions[regionIndex];
    }
    if (region && index >= region.start) {
      if (region.block) return -1;
      index = region.end;
      continue;
    }
    const current = text[index];
    if (current === character) {
      const runEnd = runEndFrom(text, index, character);
      if (runEnd - index === size) return index;
      index = runEnd;
      continue;
    }
    if (current === "\n" && isBlankLineAfter(text, index)) return -1;
    index += 1;
  }
  return -1;
}

/** 配对行内代码标记，避免识别代码中的公式分隔符。 */
function withInlineCodeSpanRegions(text: string, blockRegions: readonly Region[]): Region[] {
  const merged: Region[] = [];
  let blockIndex = 0;
  let index = 0;
  let backslashes = 0;

  while (index < text.length) {
    const block = blockRegions[blockIndex];
    if (block && index >= block.start) {
      merged.push(block);
      index = block.end;
      blockIndex += 1;
      backslashes = 0;
      continue;
    }
    const current = text[index];
    if (current === "\\") {
      backslashes += 1;
      index += 1;
      continue;
    }
    if (current === "`" && backslashes % 2 === 0) {
      const runEnd = runEndFrom(text, index, "`");
      const size = runEnd - index;
      const close = findClosingRun(text, blockRegions, blockIndex, runEnd, "`", size);
      if (close !== -1) {
        merged.push({ start: index, end: close + size, block: false });
        index = close + size;
        backslashes = 0;
        continue;
      }
      index = runEnd;
      backslashes = 0;
      continue;
    }
    backslashes = 0;
    index += 1;
  }

  while (blockIndex < blockRegions.length) {
    const block = blockRegions[blockIndex];
    if (block) merged.push(block);
    blockIndex += 1;
  }
  return merged;
}

/** 按反斜杠奇偶性查找结束符，跳过行内代码，遇到混用的分隔符就停止。 */
function findDelimiterCloser(
  text: string,
  regions: readonly Region[],
  startRegionIndex: number,
  from: number,
  closeChar: string,
  stopAtNewline: boolean,
): number {
  let index = from;
  let regionIndex = startRegionIndex;
  let backslashes = 0;

  while (index < text.length) {
    let region = regions[regionIndex];
    while (region && index >= region.end) {
      regionIndex += 1;
      region = regions[regionIndex];
    }
    if (region && index >= region.start) {
      if (region.block || (stopAtNewline && text.slice(region.start, region.end).includes("\n")))
        return -1;
      index = region.end;
      backslashes = 0;
      continue;
    }
    const current = text[index];
    if (current === "\n") {
      if (stopAtNewline) return -1;
      backslashes = 0;
      index += 1;
      continue;
    }
    if (current === "\\") {
      if (backslashes % 2 === 0) {
        const next = text[index + 1];
        if (next === closeChar) return index;
        if (next === "(" || next === "[" || next === ")" || next === "]") {
          return -1;
        }
      }
      backslashes += 1;
      index += 1;
      continue;
    }
    backslashes = 0;
    index += 1;
  }
  return -1;
}

function quotedTex(text: string, opener: number, tex: string): string {
  const lineStart = text.lastIndexOf("\n", opener - 1) + 1;
  const quoteDepth = (text.slice(lineStart, opener).match(/>/g) ?? []).length;
  if (quoteDepth === 0 || !tex.includes("\n")) return tex;
  return tex
    .split("\n")
    .map((line, index) => {
      if (index === 0) return line;
      let result = line;
      for (let depth = 0; depth < quoteDepth; depth += 1) {
        const match = /^ {0,3}> ?/.exec(result);
        if (!match) break;
        result = result.slice(match[0].length);
      }
      return result;
    })
    .join("\n");
}

function scanInlineDelimiters(text: string, regions: readonly Region[]): MathFormula[] {
  const formulas: MathFormula[] = [];
  let index = 0;
  let regionIndex = 0;
  let backslashes = 0;

  while (index < text.length) {
    let region = regions[regionIndex];
    while (region && index >= region.end) {
      regionIndex += 1;
      region = regions[regionIndex];
    }
    if (region && index >= region.start) {
      index = region.end;
      backslashes = 0;
      continue;
    }
    const current = text[index];

    if (current === "\\") {
      const delimiter = text[index + 1];
      if (backslashes % 2 === 0 && (delimiter === "(" || delimiter === "[")) {
        const closer = findDelimiterCloser(
          text,
          regions,
          regionIndex,
          index + 2,
          delimiter === "(" ? ")" : "]",
          delimiter === "(",
        );
        if (closer > index + 2 && text.slice(index + 2, closer).trim()) {
          formulas.push({
            start: index,
            end: closer + 2,
            source: text.slice(index, closer + 2),
            tex: quotedTex(text, index, text.slice(index + 2, closer)),
            display: delimiter === "[",
          });
          index = closer + 2;
          backslashes = 0;
          continue;
        }
      }
      backslashes += 1;
      index += 1;
      continue;
    }

    if (current === "$" && backslashes % 2 === 0) {
      const runEnd = runEndFrom(text, index, "$");
      const size = runEnd - index;
      if (size === 2) {
        const closer = findClosingRun(text, regions, regionIndex, runEnd, "$", 2);
        if (closer !== -1 && text.slice(runEnd, closer).trim()) {
          formulas.push({
            start: index,
            end: closer + 2,
            source: text.slice(index, closer + 2),
            tex: quotedTex(text, index, text.slice(runEnd, closer)),
            display: true,
          });
          index = closer + 2;
          backslashes = 0;
          continue;
        }
      }
      index = runEnd;
      backslashes = 0;
      continue;
    }

    if (current === "`") {
      // 已闭合的代码区域已经跳过，这里只会遇到普通反引号。
      index = runEndFrom(text, index, "`");
      backslashes = 0;
      continue;
    }

    backslashes = 0;
    index += 1;
  }

  return formulas;
}
