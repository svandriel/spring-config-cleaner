import { describe, expect, it } from "vitest";
import { lineIndex } from "./position.ts";

describe("lineIndex", () => {
  it("maps offsets to 1-based line/column spans", () => {
    const index = lineIndex("ab\ncd\n");
    expect(index.position(0, 1)).toEqual({ line: 1, column: 1, endLine: 1, endColumn: 2 });
    expect(index.position(1, 4)).toEqual({ line: 1, column: 2, endLine: 2, endColumn: 2 });
  });
  it("keeps the real end of a span that crosses lines, ignoring CR", () => {
    expect(lineIndex("a\r\nb\r\n").position(0, 5)).toEqual({
      line: 1,
      column: 1,
      endLine: 2,
      endColumn: 3,
    });
  });
  it("treats an out-of-range end offset as end of the start line", () => {
    expect(lineIndex("abc").position(1, 99)).toEqual({
      line: 1,
      column: 2,
      endLine: 1,
      endColumn: 4,
    });
  });
});
