import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { flattenDocument } from "./paths.ts";

describe("flattenDocument", () => {
  it("flattens nested maps to dotted paths with words", () => {
    const doc = parseDocument("server:\n  tomcat:\n    max-Threads: 42\n");
    expect(flattenDocument(doc, 3)).toEqual([
      {
        path: "server.tomcat.max-Threads",
        words: [["server"], ["tomcat"], ["max", "Threads"]],
        value: 42,
        documentIndex: 3,
      },
    ]);
  });
  it("treats dotted keys and mixed nesting as the same property", () => {
    const doc = parseDocument("spring.application.name: app\nother: { key.sub: true }\n");
    const entries = flattenDocument(doc, 0);
    expect(entries.map((e) => e.path)).toEqual(["spring.application.name", "other.key.sub"]);
    expect(entries.map((e) => e.value)).toEqual(["app", true]);
    expect(entries[0]!.words).toEqual([["spring"], ["application"], ["name"]]);
  });
  it("resolves aliases and skips empty mappings; sequences are leaf values", () => {
    const doc = parseDocument("a: &x 5\nb: *x\nskip: {}\nband: [one, two]\n");
    const entries = flattenDocument(doc, 0);
    expect(entries.map((e) => [e.path, e.value])).toEqual([
      ["a", 5],
      ["b", 5],
      ["band", ["one", "two"]],
    ]);
  });
});
