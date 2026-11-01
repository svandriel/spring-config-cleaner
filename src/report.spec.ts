import { describe, expect, it } from "vitest";
import type { RedundantEntry } from "./compare.ts";
import type { ConfigError } from "./configfile.ts";
import type { FileResult } from "./report.ts";
import { NO_DUPLICATES_LINE, renderReport } from "./report.ts";

// Local helper: `words` is never rendered, so tests leave it empty. Without a
// `source` the renderer must degrade to position-only rows.
const entry = (path: string, value: unknown): RedundantEntry => ({
  path,
  words: [],
  value,
  documentIndex: 0,
  position: { line: 1, column: 1, endLine: 1, endColumn: 2 },
  base: {
    file: "application.yml",
    position: { line: 1, column: 1, endLine: 1, endColumn: 2 },
  },
});

/** Structurally ConfigError-shaped failure so block messages stay exact. */
const errorFor = (message: string): ConfigError => ({
  name: "ConfigError",
  message,
  path: "application-broken.yml",
  kind: "syntax",
});

describe("renderReport", () => {
  it("reports exactly this line for an empty result list", () => {
    expect(renderReport([], false)).toBe(NO_DUPLICATES_LINE);
    expect(NO_DUPLICATES_LINE).toBe("✓ No duplicates found.\n");
  });

  it("reports exactly this line when every block is clean (no entries, no errors)", () => {
    const results: FileResult[] = [
      { file: "a.yml", redundant: [] },
      { file: "b.yml", redundant: [] },
    ];
    expect(renderReport(results, false)).toBe(NO_DUPLICATES_LINE);
  });

  it("renders one entry with the singular summary", () => {
    const results: FileResult[] = [
      {
        file: "application-prod.yml",
        redundant: [entry("server.tomcat.max-threads", 42)],
      },
    ];
    expect(renderReport(results, false)).toBe(
      "application-prod.yml\n" +
        "  1:1  duplicate  server.tomcat.max-threads = 42\n" +
        "\n" +
        "✖ 1 duplicate in 1 of 1 profile file\n",
    );
  });

  it("renders multiple entries in input order with the plural summary", () => {
    const results: FileResult[] = [
      {
        file: "application-prod.yml",
        redundant: [entry("server.port", 8080), entry("logging.level", "info")],
      },
    ];
    expect(renderReport(results, false)).toBe(
      "application-prod.yml\n" +
        "  1:1  duplicate  server.port = 8080\n" +
        "  1:1  duplicate  logging.level = info\n" +
        "\n" +
        "✖ 2 duplicates in 1 of 1 profile file\n",
    );
  });

  it("suffixes every entry line with (would remove) in dry-run mode", () => {
    const results: FileResult[] = [
      {
        file: "application-prod.yml",
        redundant: [entry("server.port", 8080), entry("logging.level", "info")],
      },
    ];
    expect(renderReport(results, true)).toBe(
      "application-prod.yml\n" +
        "  1:1  duplicate  server.port = 8080 (would remove)\n" +
        "  1:1  duplicate  logging.level = info (would remove)\n" +
        "\n" +
        "✖ 2 duplicates in 1 of 1 profile file (dry run — nothing written)\n",
    );
  });

  it("omits the suffix in check (non-dry-run) mode", () => {
    const results: FileResult[] = [
      { file: "application-prod.yml", redundant: [entry("server.port", 8080)] },
    ];
    expect(renderReport(results, false)).toBe(
      "application-prod.yml\n" +
        "  1:1  duplicate  server.port = 8080\n" +
        "\n" +
        "✖ 1 duplicate in 1 of 1 profile file\n",
    );
  });

  it("renders scalar values via String: number, boolean, string", () => {
    const results: FileResult[] = [
      {
        file: "a.yml",
        redundant: [entry("n", 42), entry("b", true), entry("s", "hello"), entry("f", 1.5)],
      },
    ];
    expect(renderReport(results, false)).toBe(
      "a.yml\n" +
        "  1:1  duplicate  n = 42\n" +
        "  1:1  duplicate  b = true\n" +
        "  1:1  duplicate  s = hello\n" +
        "  1:1  duplicate  f = 1.5\n" +
        "\n" +
        "✖ 4 duplicates in 1 of 1 profile file\n",
    );
  });

  it("renders arrays and objects via JSON.stringify", () => {
    const results: FileResult[] = [
      {
        file: "a.yml",
        redundant: [entry("list", [1, 2, 3]), entry("map", { key: "value" })],
      },
    ];
    expect(renderReport(results, false)).toBe(
      "a.yml\n" +
        "  1:1  duplicate  list = [1,2,3]\n" +
        '  1:1  duplicate  map = {"key":"value"}\n' +
        "\n" +
        "✖ 2 duplicates in 1 of 1 profile file\n",
    );
  });

  it("renders undefined and null scalars via String", () => {
    const results: FileResult[] = [
      { file: "a.yml", redundant: [entry("u", undefined), entry("n", null)] },
    ];
    expect(renderReport(results, false)).toBe(
      "a.yml\n" +
        "  1:1  duplicate  u = undefined\n" +
        "  1:1  duplicate  n = null\n" +
        "\n" +
        "✖ 2 duplicates in 1 of 1 profile file\n",
    );
  });

  it("renders an error block with a fix hint and no summary", () => {
    const results: FileResult[] = [
      {
        file: "application-broken.yml",
        redundant: [],
        error: errorFor("bad yaml"),
      },
    ];
    expect(renderReport(results, false)).toBe(
      "✖ application-broken.yml\n" +
        "  bad yaml\n" +
        "\n" +
        "  Fix the YAML in application-broken.yml.\n",
    );
  });

  it("renders an error block identically in dry-run mode (no would-remove line)", () => {
    const results: FileResult[] = [
      {
        file: "application-broken.yml",
        redundant: [],
        error: errorFor("bad yaml"),
      },
    ];
    expect(renderReport(results, true)).toBe(renderReport(results, false));
  });

  it("omits clean files and counts them in the profile-file total", () => {
    const results: FileResult[] = [
      { file: "application-prod.yml", redundant: [entry("server.port", 8080)] },
      { file: "application-dev.yml", redundant: [] },
    ];
    expect(renderReport(results, false)).toBe(
      "application-prod.yml\n" +
        "  1:1  duplicate  server.port = 8080\n" +
        "\n" +
        "✖ 1 duplicate in 1 of 2 profile files\n",
    );
  });

  it("continues rendering past an error block (errors never abort rendering)", () => {
    const results: FileResult[] = [
      {
        file: "application-broken.yml",
        redundant: [],
        error: errorFor("bad yaml"),
      },
      { file: "application-prod.yml", redundant: [entry("server.port", 8080)] },
    ];
    expect(renderReport(results, true)).toBe(
      "✖ application-broken.yml\n" +
        "  bad yaml\n" +
        "\n" +
        "application-prod.yml\n" +
        "  1:1  duplicate  server.port = 8080 (would remove)\n" +
        "\n" +
        "✖ 1 duplicate in 1 of 2 profile files (dry run — nothing written), 1 error\n" +
        "\n" +
        "  Fix the YAML in application-broken.yml.\n",
    );
  });

  it("preserves the input order of blocks and summarises once", () => {
    const results: FileResult[] = [
      { file: "c.yml", redundant: [entry("x", 1)] },
      { file: "a.yml", redundant: [entry("y", 2)] },
      { file: "b.yml", redundant: [entry("z", 3)] },
    ];
    expect(renderReport(results, false)).toBe(
      "c.yml\n  1:1  duplicate  x = 1\n\n" +
        "a.yml\n  1:1  duplicate  y = 2\n\n" +
        "b.yml\n  1:1  duplicate  z = 3\n\n" +
        "✖ 3 duplicates in 3 of 3 profile files\n",
    );
  });

  it("mixes a multi-entry block, a clean block and an error block", () => {
    const results: FileResult[] = [
      {
        file: "a-prod.yml",
        redundant: [entry("p", 1), entry("q", "two"), entry("r", [3])],
      },
      { file: "clean.yml", redundant: [] },
      { file: "z-broken.yml", redundant: [], error: errorFor("nope") },
    ];
    expect(renderReport(results, false)).toBe(
      "a-prod.yml\n" +
        "  1:1  duplicate  p = 1\n" +
        "  1:1  duplicate  q = two\n" +
        "  1:1  duplicate  r = [3]\n" +
        "\n" +
        "✖ z-broken.yml\n" +
        "  nope\n" +
        "\n" +
        "✖ 3 duplicates in 1 of 3 profile files, 1 error\n" +
        "\n" +
        "  Fix the YAML in z-broken.yml.\n",
    );
  });
});
