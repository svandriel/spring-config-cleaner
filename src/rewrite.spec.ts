import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import type { RedundantEntry } from "./compare.ts";
import { canonicalKey } from "./keys.ts";
import { flattenDocument } from "./paths.ts";
import { rewriteConfigFile } from "./rewrite.ts";

const entry = (path: string, words: string[][], value: number): RedundantEntry => ({
  path,
  words,
  value,
  documentIndex: 0,
});

describe("rewriteConfigFile (preserve structure)", () => {
  it("removes redundant leaves, restyles survivors, keeps comments", () => {
    const source = [
      "spring:",
      "  datasource:",
      "    # connection pool",
      "    maxThreads: 8 # inline",
      "    idleTimeout: 3",
    ].join("\n");
    const result = rewriteConfigFile(
      source,
      [entry("spring.datasource.maxThreads", [["spring"], ["datasource"], ["max", "Threads"]], 8)],
      { style: "kebab", structure: "preserve" },
    );
    const paths = flattenDocument(parseDocument(result), 0).map((e) => e.path);
    expect(paths).toContain("spring.datasource.idle-timeout");
    expect(paths).not.toContain("spring.datasource.maxthreads");
    expect(result).toContain("# connection pool");
    expect(result).toContain("# inline");
  });
  it("prunes emptied comment-less parents", () => {
    const result = rewriteConfigFile(
      "outer:\n  inner:\n    kill: 1\n",
      [entry("outer.inner.kill", [["outer"], ["inner"], ["kill"]], 1)],
      { style: "preserve", structure: "preserve" },
    );
    expect(flattenDocument(parseDocument(result), 0)).toEqual([]);
  });
  it("removes the first flatten-order occurrence, keeping a later override", () => {
    const result = rewriteConfigFile(
      "my:\n  app:\n    maxThreads: 8\nmy.app.maxThreads: 9\n",
      [entry("my.app.maxThreads", [["my"], ["app"], ["max", "Threads"]], 8)],
      { style: "preserve", structure: "preserve" },
    );
    expect(flattenDocument(parseDocument(result), 0).map((e) => [e.path, e.value])).toEqual([
      ["my.app.maxThreads", 9],
    ]);
  });
  it("removes a dotted first occurrence, keeping a later nested override", () => {
    const result = rewriteConfigFile(
      "my.app.maxThreads: 8\nmy:\n  app:\n    maxThreads: 9\n",
      [entry("my.app.maxThreads", [["my"], ["app"], ["max", "Threads"]], 8)],
      { style: "preserve", structure: "preserve" },
    );
    expect(flattenDocument(parseDocument(result), 0).map((e) => [e.path, e.value])).toEqual([
      ["my.app.maxThreads", 9],
    ]);
  });
  it("keeps parents that carry comments", () => {
    const result = rewriteConfigFile(
      "outer: # keep me\n  kill: 1\n",
      [entry("outer.kill", [["outer"], ["kill"]], 1)],
      { style: "preserve", structure: "preserve" },
    );
    expect(result).toContain("outer");
    expect(result).toContain("# keep me");
  });
});

describe("rewriteConfigFile (structure conformance)", () => {
  it("conforms nested config to dotted keys, carrying comments", () => {
    const result = rewriteConfigFile("spring: # top\n  application:\n    name: app\n", [], {
      style: "kebab",
      structure: "dotted",
    });
    expect(flattenDocument(parseDocument(result), 0).map((e) => e.path)).toEqual([
      "spring.application.name",
    ]);
    expect(result).toContain("# top");
    // Discriminating: the nested block must be gone (beyond the brief's asserts).
    expect(result).not.toContain("  application");
  });
  it("conforms dotted config to nested maps", () => {
    const result = rewriteConfigFile("spring.application.name: app\n", [], {
      style: "kebab",
      structure: "nested",
    });
    expect(flattenDocument(parseDocument(result), 0).map((e) => e.path)).toEqual([
      "spring.application.name",
    ]);
    // Discriminating: the dotted key must be gone (beyond the brief's asserts).
    expect(result).not.toContain("spring.application.name:");
  });
  it("keeps the deep subtree on a prefix collision, shallow leaf first", () => {
    const result = rewriteConfigFile("a.b: 1 # shallow\na:\n  b:\n    c: 2\n", [], {
      style: "preserve",
      structure: "nested",
    });
    // Documented conflict policy: the deeper subtree wins; the shallow leaf is
    // dropped, though its comments survive (hoisted).
    expect(flattenDocument(parseDocument(result), 0).map((e) => e.path)).toEqual(["a.b.c"]);
    expect(result).toContain("# shallow");
  });
  it("keeps the deep subtree on a prefix collision, deep leaf first", () => {
    const result = rewriteConfigFile("a:\n  b:\n    c: 2\na.b: 1\n", [], {
      style: "preserve",
      structure: "nested",
    });
    expect(flattenDocument(parseDocument(result), 0).map((e) => e.path)).toEqual(["a.b.c"]);
  });
  it("keeps ancestor comments when a subtree empties without survivors", () => {
    const source = [
      "wrapper:",
      "  # my section",
      "  my:",
      "    # app section",
      "    app:",
      "      maxThreads: 8",
      "logging:",
      "  level: info",
    ].join("\n");
    const result = rewriteConfigFile(source, [entry("wrapper.my.app.maxThreads", [], 8)], {
      style: "preserve",
      structure: "nested",
    });
    expect(result).toContain("# my section");
    expect(result).toContain("# app section");
  });
  it("keeps the later spelling of a twice-spelled canonical path", () => {
    const result = rewriteConfigFile("a.b: 1\na:\n  B: 2\n", [], {
      style: "preserve",
      structure: "nested",
    });
    const flattened = flattenDocument(parseDocument(result), 0);
    expect(flattened.map((e) => canonicalKey(e.path))).toEqual(["a.b"]);
    expect(flattened[0]?.value).toBe(2);
  });
});

describe("rewriteConfigFile comment salvage (fix round 1)", () => {
  it("keeps comments of a deleted trailing pair, trailing the surviving sibling", () => {
    const result = rewriteConfigFile(
      "outer:\n  alpha: 1\n  # guard\n  kill: 2\n",
      [entry("outer.kill", [["outer"], ["kill"]], 2)],
      { style: "preserve", structure: "preserve" },
    );
    expect(result).toContain("# guard");
    expect(result).toContain("alpha: 1 # guard");
    expect(flattenDocument(parseDocument(result), 0).map((leaf) => leaf.path)).toEqual([
      "outer.alpha",
    ]);
  });
  it("keeps comments when the deleted pair leaves the parent empty", () => {
    const result = rewriteConfigFile(
      "outer:\n  # only comment\n  kill: 2\n",
      [entry("outer.kill", [["outer"], ["kill"]], 2)],
      { style: "preserve", structure: "preserve" },
    );
    expect(result).toContain("outer");
    expect(result).toContain("# only comment");
  });
  it("keeps inline comments when the deleted pair leaves the parent empty", () => {
    const result = rewriteConfigFile(
      "outer:\n  # only comment\n  kill: 2 # trail\n",
      [entry("outer.kill", [["outer"], ["kill"]], 2)],
      { style: "preserve", structure: "preserve" },
    );
    expect(result).toContain("# only comment");
    expect(result).toContain("# trail");
    expect(result).toContain("outer");
  });
  it("rejects documents containing aliases instead of silently doing nothing", () => {
    const source = "base: &base\n  a: 1\nprod: *base\n";
    expect(() =>
      rewriteConfigFile(source, [entry("prod.a", [["prod"], ["a"]], 1)], {
        style: "preserve",
        structure: "preserve",
      }),
    ).toThrow(/alias/i);
  });
  it("does not prune empty mappings the rewrite did not empty", () => {
    const result = rewriteConfigFile(
      "spring:\n  profiles: {}\n  app:\n    name: x\n",
      [entry("spring.app.name", [["spring"], ["app"], ["name"]], 0)],
      { style: "preserve", structure: "preserve" },
    );
    expect(result).toContain("profiles");
    expect(result).toBe("spring:\n  profiles: {}\n");
    expect(flattenDocument(parseDocument(result), 0)).toEqual([]);
  });
});
