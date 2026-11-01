import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { flattenDocument } from "./paths.ts";

describe("flattenDocument", () => {
  it("flattens nested maps to dotted paths with words and positions", () => {
    const source = "server:\n  tomcat:\n    max-Threads: 42\n";
    const doc = parseDocument(source);
    expect(flattenDocument(doc, 3, source)).toEqual([
      {
        path: "server.tomcat.max-Threads",
        words: [["server"], ["tomcat"], ["max", "Threads"]],
        value: 42,
        documentIndex: 3,
        position: { line: 3, column: 5, endLine: 3, endColumn: 20 },
      },
    ]);
  });
  it("treats dotted keys and mixed nesting as the same property", () => {
    const source = "spring.application.name: app\nother: { key.sub: true }\n";
    const entries = flattenDocument(parseDocument(source), 0, source);
    expect(entries.map((e) => e.path)).toEqual(["spring.application.name", "other.key.sub"]);
    expect(entries.map((e) => e.value)).toEqual(["app", true]);
    const firstEntry = entries[0];
    if (!firstEntry) {
      expect.unreachable("first entry should exist");
    }
    expect(firstEntry.words).toEqual([["spring"], ["application"], ["name"]]);
  });
  it("spans the whole explicit dotted key through its value", () => {
    const source = "spring.application.name: app\n";
    const entries = flattenDocument(parseDocument(source), 0, source);
    expect(entries).toHaveLength(1);
    const first = entries[0];
    if (!first) {
      expect.unreachable("first entry should exist");
    }
    expect(first.position).toEqual({
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 29,
    });
  });
  it("resolves aliases and skips empty mappings; sequences are leaf values", () => {
    const source = "a: &x 5\nb: *x\nskip: {}\nband: [one, two]\n";
    const entries = flattenDocument(parseDocument(source), 0, source);
    expect(entries.map((e) => [e.path, e.value])).toEqual([
      ["a", 5],
      ["b", 5],
      ["band", ["one", "two"]],
    ]);
  });
});
