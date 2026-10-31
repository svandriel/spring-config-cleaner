import { describe, expect, it } from "vitest";
import type { RedundantEntry } from "./compare.ts";
import type { ConfigError } from "./configfile.ts";
import type { FileResult } from "./report.ts";
import { renderReport } from "./report.ts";

// Local helper: `words` is never rendered, so tests leave it empty.
const entry = (path: string, value: unknown): RedundantEntry => ({
  path,
  words: [],
  value,
  documentIndex: 0,
});

/** Structurally ConfigError-shaped failure so block messages stay exact. */
const errorFor = (message: string): ConfigError => ({
  name: "ConfigError",
  message,
  path: "application-broken.yml",
});

describe("renderReport", () => {
  it("reports exactly this line for an empty result list", () => {
    const results: FileResult[] = [];
    expect(renderReport(results, false)).toBe("No duplicates found.\n");
  });

  it("reports exactly this line when every block is clean (no entries, no errors)", () => {
    const results: FileResult[] = [
      { file: "a.yml", redundant: [] },
      { file: "b.yml", redundant: [] },
    ];
    expect(renderReport(results, false)).toBe("No duplicates found.\n");
  });

  it("renders one entry with the singular summary", () => {
    const results: FileResult[] = [
      { file: "application-prod.yml", redundant: [entry("server.tomcat.max-threads", 42)] },
    ];
    expect(renderReport(results, false)).toBe(
      "application-prod.yml\n  server.tomcat.max-threads = 42\n1 duplicate in application-prod.yml\n",
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
      "application-prod.yml\n  server.port = 8080\n  logging.level = info\n2 duplicates in application-prod.yml\n",
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
        "  server.port = 8080 (would remove)\n" +
        "  logging.level = info (would remove)\n" +
        "2 duplicates in application-prod.yml\n",
    );
  });

  it("omits the suffix in check (non-dry-run) mode", () => {
    const results: FileResult[] = [
      { file: "application-prod.yml", redundant: [entry("server.port", 8080)] },
    ];
    expect(renderReport(results, false)).toBe(
      "application-prod.yml\n  server.port = 8080\n1 duplicate in application-prod.yml\n",
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
      "a.yml\n  n = 42\n  b = true\n  s = hello\n  f = 1.5\n4 duplicates in a.yml\n",
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
      'a.yml\n  list = [1,2,3]\n  map = {"key":"value"}\n2 duplicates in a.yml\n',
    );
  });

  it("renders undefined and null scalars via String", () => {
    const results: FileResult[] = [
      { file: "a.yml", redundant: [entry("u", undefined), entry("n", null)] },
    ];
    expect(renderReport(results, false)).toBe(
      "a.yml\n  u = undefined\n  n = null\n2 duplicates in a.yml\n",
    );
  });

  it("renders an error block with the file line and no summary", () => {
    const results: FileResult[] = [
      { file: "application-broken.yml", redundant: [], error: errorFor("bad yaml") },
    ];
    expect(renderReport(results, false)).toBe("application-broken.yml\n  [error] bad yaml\n");
  });

  it("renders an error block identically in dry-run mode (no would-remove line)", () => {
    const results: FileResult[] = [
      { file: "application-broken.yml", redundant: [], error: errorFor("bad yaml") },
    ];
    expect(renderReport(results, true)).toBe("application-broken.yml\n  [error] bad yaml\n");
  });

  it("renders a clean block as just the file line, without a summary", () => {
    const results: FileResult[] = [
      { file: "application-prod.yml", redundant: [entry("server.port", 8080)] },
      { file: "application-dev.yml", redundant: [] },
    ];
    expect(renderReport(results, false)).toBe(
      "application-prod.yml\n  server.port = 8080\n1 duplicate in application-prod.yml\napplication-dev.yml\n",
    );
  });

  it("continues rendering past an error block (errors never abort rendering)", () => {
    const results: FileResult[] = [
      { file: "application-broken.yml", redundant: [], error: errorFor("bad yaml") },
      { file: "application-prod.yml", redundant: [entry("server.port", 8080)] },
    ];
    expect(renderReport(results, true)).toBe(
      "application-broken.yml\n" +
        "  [error] bad yaml\n" +
        "application-prod.yml\n" +
        "  server.port = 8080 (would remove)\n" +
        "1 duplicate in application-prod.yml\n",
    );
  });

  it("preserves the input order of blocks", () => {
    const results: FileResult[] = [
      { file: "c.yml", redundant: [entry("x", 1)] },
      { file: "a.yml", redundant: [entry("y", 2)] },
      { file: "b.yml", redundant: [entry("z", 3)] },
    ];
    expect(renderReport(results, false)).toBe(
      "c.yml\n  x = 1\n1 duplicate in c.yml\n" +
        "a.yml\n  y = 2\n1 duplicate in a.yml\n" +
        "b.yml\n  z = 3\n1 duplicate in b.yml\n",
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
      "a-prod.yml\n  p = 1\n  q = two\n  r = [3]\n3 duplicates in a-prod.yml\n" +
        "clean.yml\n" +
        "z-broken.yml\n  [error] nope\n",
    );
  });
});
