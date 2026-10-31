/**
 * Translation of byte offsets in a YAML source into 1-based line/column spans.
 *
 * The `yaml` package exposes node ranges as offsets; diagnostics need the
 * line/column pair editors and terminals understand. `endColumn` is exclusive,
 * and a span may legitimately cross lines: the renderer clamps the caret run
 * to the start line, while the data keeps the real end.
 */

/** A 1-based source span; `endColumn` is exclusive. */
export interface SourcePosition {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

/** Maps byte offsets in one source string to positions. */
export interface LineIndex {
  /** Position of the `[start, end)` span. */
  position(start: number, end: number): SourcePosition;
}

/** Offsets of every line start, including the first. */
function starts(source: string): number[] {
  const lineStarts = [...source.matchAll(/\n/g)].map((match) => (match.index ?? 0) + 1);
  return [0, ...lineStarts];
}

/** Zero-based line containing `offset`, via binary search. */
function lineOf(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((lineStarts[mid] ?? 0) <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

/** 1-based line/column of `offset` within `lineStarts`. */
function at(lineStarts: number[], offset: number): { line: number; column: number } {
  const line = lineOf(lineStarts, offset);
  return { line: line + 1, column: offset - (lineStarts[line] ?? 0) + 1 };
}

export function lineIndex(source: string): LineIndex {
  const lineStarts = starts(source);
  return {
    position(start, end): SourcePosition {
      if (source.length === 0) {
        return { line: 1, column: 1, endLine: 1, endColumn: 1 };
      }
      const from = at(lineStarts, Math.min(Math.max(start, 0), source.length - 1));
      const to = at(lineStarts, Math.min(Math.max(end, start), source.length));
      return {
        line: from.line,
        column: from.column,
        endLine: to.line,
        endColumn:
          to.line === from.line ? Math.max(to.column, from.column + 1) : Math.max(to.column, 1),
      };
    },
  };
}
