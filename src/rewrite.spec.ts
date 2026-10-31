import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import type { RedundantEntry } from "./compare.ts";
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
