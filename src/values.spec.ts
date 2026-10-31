import { describe, expect, it } from "vitest";
import { valuesEqual } from "./values.ts";

describe("valuesEqual", () => {
  it("unifies booleans case-insensitively", () => {
    expect(valuesEqual(true, "True")).toBe(true);
    expect(valuesEqual(false, "FALSE")).toBe(true);
  });
  it("keeps non-boolean strings distinct", () => {
    expect(valuesEqual(true, "true ")).toBe(false);
    expect(valuesEqual(true, "on")).toBe(false);
  });
  it("compares numbers numerically across quoting", () => {
    expect(valuesEqual(8080, "8080")).toBe(true);
    expect(valuesEqual(1, 1.0)).toBe(true);
    expect(valuesEqual(1, "1.0")).toBe(true);
  });
  it("does not coerce null-ish strings", () => {
    expect(valuesEqual(null, null)).toBe(true);
    expect(valuesEqual(null, "null")).toBe(false);
  });
  it("compares placeholders as raw text", () => {
    expect(valuesEqual("${db.url}", "${db.url}")).toBe(true);
    expect(valuesEqual("${db.url}", "${db.host}")).toBe(false);
  });
  it("compares lists in order, element-wise", () => {
    expect(valuesEqual([1, "a"], [1, "a"])).toBe(true);
    expect(valuesEqual([1, "a"], ["a", 1])).toBe(false);
    expect(valuesEqual([1], [1, 1])).toBe(false);
  });
  it("compares maps unordered and recursively", () => {
    expect(valuesEqual({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true);
    expect(valuesEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
  it("keeps raw strings strict", () => {
    expect(valuesEqual("x", "x")).toBe(true);
    expect(valuesEqual("x", " x")).toBe(false);
  });
});
