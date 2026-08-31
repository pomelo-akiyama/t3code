/**
 * Scanner behind ChatMarkdown's math rendering. It finds TeX math delimiters
 * outside markdown code constructs, rewrites closed `\(...\)` / `\[...\]`
 * pairs into the `$$` form `remark-math` parses (both delimiter pairs are two
 * characters wide, so every offset in the text is preserved exactly), and
 * reports whether the message needs the math-enabled remark chain at all.
 *
 * Escaping follows backslash-run parity; escaped, unclosed, or mis-nested
 * delimiters are left exactly as written. Only closed expressions convert, so
 * an expression still streaming in stays raw text with zero flicker.
 *
 * Known limit: indented (4-space) code blocks are not recognized. Agents emit
 * fences; a delimiter inside indented code is a pathological input we accept
 * rendering wrong rather than reimplementing the block parser.
 */

import { LRUCache } from "./lib/lruCache";

export interface OpenMathFenceTail {
  /** Fence body streamed so far, blockquote markers stripped. */
  readonly body: string;
  /**
   * Offset of the fence's opening line in the text. Delimiter rewrites are
   * width-preserving, so this offset is valid in `normalizedText` too and can
   * be compared against remark node positions.
   */
  readonly start: number;
}

export interface MathMarkdownAnalysis {
  /** Whether a closed `\(...\)`, `\[...\]`, or `$$...$$` exists outside code. */
  readonly hasDelimiterMath: boolean;
  /** The text with closed `\(...\)` / `\[...\]` rewritten to `$$...$$` form. */
  readonly normalizedText: string;
  /**
   * A trailing unterminated ```math fence or `$$` block, or null. While
   * streaming, the math block at this source position renders as a plain
   * code block so a half-streamed formula never typesets.
   */
  readonly openMathFenceTail: OpenMathFenceTail | null;
}

/**
 * Anything that could possibly need the full scan: a `$$` pair, a backslash
 * delimiter, or a `math` fence opening. Most messages fail this test and skip
 * the scan entirely.
 */
const FAST_PATH_PATTERN = /\$\$|\\\(|\\\[|(?:`{3,}|~{3,})[^\S\n]*math/;

const MAX_ANALYSIS_CACHE_ENTRIES = 200;
const MAX_ANALYSIS_CACHE_MEMORY_BYTES = 8 * 1024 * 1024;

/** Streaming repaints re-analyze the same text; cache by full message text. */
const analysisCache = new LRUCache<MathMarkdownAnalysis>(
  MAX_ANALYSIS_CACHE_ENTRIES,
  MAX_ANALYSIS_CACHE_MEMORY_BYTES,
);

export function analyzeMathMarkdown(text: string): MathMarkdownAnalysis {
  if (!FAST_PATH_PATTERN.test(text)) {
    return { hasDelimiterMath: false, normalizedText: text, openMathFenceTail: null };
  }
  const cached = analysisCache.get(text);
  if (cached) return cached;
  const analysis = analyze(text);
  analysisCache.set(text, analysis, text.length * 3 + 64);
  return analysis;
}

/** A half-open [start, end) slice of the text where math delimiters are inert. */
interface Region {
  readonly start: number;
  readonly end: number;
  /**
   * Block regions (fences, `$$` flow blocks) interrupt inline constructs, so
   * a delimiter search aborts at one. Inline code spans are merely skipped.
   */
  readonly block: boolean;
}

function analyze(text: string): MathMarkdownAnalysis {
  const blocks = scanBlocks(text);
  const regions = withInlineCodeSpanRegions(text, blocks.regions);
  const inline = scanInlineDelimiters(text, regions);

  let normalizedText = text;
  if (inline.conversions.length > 0) {
    const characters = text.split("");
    for (const position of inline.conversions) {
      characters[position] = "$";
      characters[position + 1] = "$";
    }
    normalizedText = characters.join("");
  }

  return {
    hasDelimiterMath:
      inline.conversions.length > 0 || inline.hasInlineDollarMath || blocks.closedFlowMath,
    normalizedText,
    openMathFenceTail: blocks.openMathFenceTail,
  };
}

interface BlockScan {
  readonly regions: Region[];
  /** A complete `$$` ... `$$` flow block exists — native display math. */
  readonly closedFlowMath: boolean;
  readonly openMathFenceTail: OpenMathFenceTail | null;
}

interface OpenBlock {
  readonly kind: "fence" | "flow";
  readonly marker: "`" | "~" | "$";
  readonly size: number;
  readonly indent: number;
  readonly quoteDepth: number;
  readonly isMath: boolean;
  readonly start: number;
  readonly body: string[];
}

/** Line pass: fenced code blocks and `$$` flow math blocks, blockquotes included. */
function scanBlocks(text: string): BlockScan {
  const regions: Region[] = [];
  let open: OpenBlock | null = null;
  let closedFlowMath = false;
  let openMathFenceTail: OpenMathFenceTail | null = null;

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
          // The enclosing blockquote ended, which closes the block before
          // this line; the line itself gets a fresh look.
          regions.push({ start: open.start, end: lineStart, block: true });
          open = null;
          continue;
        }
        if (closesBlock(stripped, open)) {
          if (open.kind === "flow") closedFlowMath = true;
          regions.push({
            start: open.start,
            end: newlineIndex === -1 ? text.length : lineEnd + 1,
            block: true,
          });
          open = null;
        } else if (open.isMath) {
          open.body.push(stripBodyIndent(stripped, open.indent));
        }
        break;
      }
      const opened = openBlockFromLine(stripped, quoteDepth, lineStart);
      if (opened) open = opened;
      break;
    }

    if (newlineIndex === -1) break;
    lineStart = newlineIndex + 1;
  }

  if (open) {
    regions.push({ start: open.start, end: text.length, block: true });
    if (open.isMath) {
      openMathFenceTail = { body: open.body.join("\n"), start: open.start };
    }
  }

  return { regions, closedFlowMath, openMathFenceTail };
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
  if (runEnd - indent < open.size) return false;
  return /^[ \t]*$/.test(stripped.slice(runEnd));
}

function openBlockFromLine(
  stripped: string,
  quoteDepth: number,
  lineStart: number,
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
    const language = info.trim().split(/[ \t]/, 1)[0] ?? "";
    return {
      kind: "fence",
      marker: first,
      size,
      indent,
      quoteDepth,
      isMath: language === "math",
      start: lineStart,
      body: [],
    };
  }

  if (first === "$") {
    const runEnd = runEndFrom(stripped, indent, "$");
    const size = runEnd - indent;
    // micromark's math-flow: at least two dollars and a meta without `$`
    // (which is what lets a single-line `$$x$$` stay inline math).
    if (size < 2 || stripped.slice(runEnd).includes("$")) return null;
    return {
      kind: "flow",
      marker: "$",
      size,
      indent,
      quoteDepth,
      isMath: true,
      start: lineStart,
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

/** Whether the `\n` at newlinePos ends a line followed by a blank line. */
function isBlankLineAfter(text: string, newlinePos: number): boolean {
  let index = newlinePos + 1;
  while (index < text.length && (text[index] === " " || text[index] === "\t")) index += 1;
  return index >= text.length || text[index] === "\n";
}

/**
 * Finds the next run of exactly `size` `character`s, skipping inline-code
 * regions and aborting at block regions or blank lines — the CommonMark
 * closing rule shared by code spans and math-text sequences.
 */
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

/** Second pass: pair backtick code spans so delimiters inside them stay inert. */
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

interface DelimiterCloser {
  readonly position: number;
  readonly sawBlankLine: boolean;
  readonly multiline: boolean;
}

/**
 * Finds the closing `\)` / `\]` for an opener, honoring backslash parity,
 * skipping inline code spans, and aborting at block regions.
 *
 * Any *other* backslash delimiter before the closer aborts the search: the
 * pair is mis-nested (`\(a \[b\) c\]`) or improperly nested, and both stay as
 * written. Besides being the correct behavior, this bounds every search at
 * the next delimiter token, so a scan over n openers stays linear instead of
 * rescanning the tail of the text once per opener.
 */
function findDelimiterCloser(
  text: string,
  regions: readonly Region[],
  startRegionIndex: number,
  from: number,
  closeChar: string,
  stopAtNewline: boolean,
): DelimiterCloser | null {
  let index = from;
  let regionIndex = startRegionIndex;
  let backslashes = 0;
  let sawBlankLine = false;
  let multiline = false;

  while (index < text.length) {
    let region = regions[regionIndex];
    while (region && index >= region.end) {
      regionIndex += 1;
      region = regions[regionIndex];
    }
    if (region && index >= region.start) {
      if (region.block) return null;
      if (text.lastIndexOf("\n", region.end - 1) >= region.start) {
        if (stopAtNewline) return null;
        multiline = true;
      }
      index = region.end;
      backslashes = 0;
      continue;
    }
    const current = text[index];
    if (current === "\n") {
      if (stopAtNewline) return null;
      multiline = true;
      if (isBlankLineAfter(text, index)) sawBlankLine = true;
      backslashes = 0;
      index += 1;
      continue;
    }
    if (current === "\\") {
      if (backslashes % 2 === 0) {
        const next = text[index + 1];
        if (next === closeChar) {
          return { position: index, sawBlankLine, multiline };
        }
        if (next === "(" || next === "[" || next === ")" || next === "]") {
          return null;
        }
      }
      backslashes += 1;
      index += 1;
      continue;
    }
    backslashes = 0;
    index += 1;
  }
  return null;
}

/** Whether only whitespace and blockquote markers precede `position` on its line. */
function onlyQuotePrefixBefore(text: string, position: number): boolean {
  let index = position - 1;
  while (index >= 0 && text[index] !== "\n") {
    const current = text[index];
    if (current !== " " && current !== "\t" && current !== ">") return false;
    index -= 1;
  }
  return true;
}

/** Whether only whitespace follows `from` on its line. */
function restOfLineIsBlank(text: string, from: number): boolean {
  let index = from;
  while (index < text.length && text[index] !== "\n") {
    if (text[index] !== " " && text[index] !== "\t") return false;
    index += 1;
  }
  return true;
}

/**
 * Validates a `\(...\)` / `\[...\]` pair for conversion. The `\[` rules exist
 * because the converted `$$` opener at a line start reads as a *flow* fence to
 * micromark, which swallows everything until a `$$`-only line: a multi-line
 * pair whose opener sits at a line start converts only when the rewritten
 * text forms that exact flow shape (`$$` alone on both lines).
 */
function findConvertibleCloser(
  text: string,
  regions: readonly Region[],
  startRegionIndex: number,
  openPos: number,
  delimiter: "(" | "[",
): number {
  const closeChar = delimiter === "(" ? ")" : "]";
  const found = findDelimiterCloser(
    text,
    regions,
    startRegionIndex,
    openPos + 2,
    closeChar,
    delimiter === "(",
  );
  if (!found) return -1;
  // Empty math converts to a bare `$$$$` run, which micromark reads as one
  // four-dollar sequence, not a pair.
  if (found.position === openPos + 2) return -1;
  if (delimiter === "(") return found.position;
  if (!found.multiline) return found.position;

  if (onlyQuotePrefixBefore(text, openPos)) {
    const flowShaped =
      restOfLineIsBlank(text, openPos + 2) &&
      onlyQuotePrefixBefore(text, found.position) &&
      restOfLineIsBlank(text, found.position + 2);
    return flowShaped ? found.position : -1;
  }
  // Mid-paragraph multi-line math parses as math-text, which cannot cross a
  // blank line.
  return found.sawBlankLine ? -1 : found.position;
}

interface InlineScan {
  /** Positions of two-character delimiters to overwrite with `$$`. */
  readonly conversions: number[];
  /** A closed native `$$...$$` with content hugging both delimiters. */
  readonly hasInlineDollarMath: boolean;
}

function scanInlineDelimiters(text: string, regions: readonly Region[]): InlineScan {
  const conversions: number[] = [];
  let hasInlineDollarMath = false;
  let index = 0;
  let regionIndex = 0;
  let backslashes = 0;
  let lastConversionEnd = -1;

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
        const closer = findConvertibleCloser(text, regions, regionIndex, index, delimiter);
        // A `$` hugging either rewritten delimiter would merge into one long
        // dollar run and change how micromark pairs sequences — including a
        // directly preceding converted pair — so those stay as written.
        if (
          closer !== -1 &&
          text[index - 1] !== "$" &&
          text[closer + 2] !== "$" &&
          index !== lastConversionEnd
        ) {
          conversions.push(index, closer);
          lastConversionEnd = closer + 2;
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
      if (size >= 2) {
        const closer = findClosingRun(text, regions, regionIndex, runEnd, "$", size);
        if (closer !== -1) {
          // Trigger only when content hugs both delimiters: `$$E=mc^2$$` is
          // math, `costs $$ and more $$` is prose and must never flip a
          // message onto the math chain.
          const first = text.charAt(runEnd);
          const last = text.charAt(closer - 1);
          if (closer > runEnd && !/\s/.test(first) && !/\s/.test(last)) {
            hasInlineDollarMath = true;
          }
          index = closer + size;
          backslashes = 0;
          continue;
        }
      }
      index = runEnd;
      backslashes = 0;
      continue;
    }

    if (current === "`") {
      // Closed spans are regions already; a leftover run is literal text.
      index = runEndFrom(text, index, "`");
      backslashes = 0;
      continue;
    }

    backslashes = 0;
    index += 1;
  }

  return { conversions, hasInlineDollarMath };
}
