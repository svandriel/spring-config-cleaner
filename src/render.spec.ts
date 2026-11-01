import { describe, expect, it } from "vitest";
import type { RedundantEntry } from "./compare.ts";
import { ConfigError } from "./configfile.ts";
import { DiscoveryError } from "./discovery.ts";
import { renderResults } from "./render.ts";
import type { FileResult } from "./report.ts";
import { createStyle, plainStyle } from "./style.ts";

const at = (line: number, column: number, endLine: number, endColumn: number) => ({
  line,
  column,
  endLine,
  endColumn,
});

const baseAt = (file: string, line: number, column: number) => ({
  file,
  position: at(line, column, line, column + 1),
});

const entry = (
  path: string,
  value: unknown,
  position = at(1, 1, 1, 2),
  base = baseAt("application.yml", 1, 1),
): RedundantEntry => ({
  path,
  words: [],
  value,
  documentIndex: 0,
  position,
  base,
});

const check = { mode: "check", style: plainStyle } as const;
const dryRun = { mode: "dry-run", style: plainStyle } as const;
const fix = { mode: "fix", style: plainStyle } as const;

describe("renderResults", () => {
  it("renders the clean line for no files and for clean files", () => {
    expect(renderResults([], check)).toBe("✓ No duplicates found.\n");
    expect(
      renderResults(
        [
          { file: "a.yml", redundant: [] },
          { file: "b.yml", redundant: [] },
        ],
        check,
      ),
    ).toBe("✓ No duplicates found.\n");
  });

  it("renders a finding without a frame when the source is unknown", () => {
    const results: FileResult[] = [
      {
        file: "application-prod.yml",
        redundant: [entry("server.port", 8080, at(4, 3, 4, 14), baseAt("application.yml", 2, 3))],
      },
    ];
    expect(renderResults(results, check)).toBe(
      "application-prod.yml\n" +
        "  4:3  duplicate  server.port = 8080\n" +
        "\n" +
        "✖ 1 duplicate in 1 of 1 profile file\n",
    );
  });

  it("renders a source frame with the base location", () => {
    const source = "# profile\nmy.app.maxThreads: 8\n";
    const results: FileResult[] = [
      {
        file: "application-prod.yml",
        source,
        redundant: [
          entry("my.app.maxThreads", 8, at(2, 1, 2, 21), baseAt("application.yml", 6, 5)),
        ],
      },
    ];
    expect(renderResults(results, check)).toBe(
      "application-prod.yml\n" +
        "  2:1  duplicate  my.app.maxThreads = 8\n" +
        "  2 │ my.app.maxThreads: 8\n" +
        "    │ ^^^^^^^^^^^^^^^^^^^^  already defined in application.yml:6:5\n" +
        "\n" +
        "✖ 1 duplicate in 1 of 1 profile file\n",
    );
  });

  it("expands tabs in the frame so carets line up with the displayed text", () => {
    const source = "a:\t1\n";
    const results: FileResult[] = [
      {
        file: "application-prod.yml",
        source,
        redundant: [entry("a", 1, at(1, 1, 1, 5), baseAt("application.yml", 1, 1))],
      },
    ];
    expect(renderResults(results, check)).toBe(
      "application-prod.yml\n" +
        "  1:1  duplicate  a = 1\n" +
        "  1 │ a:  1\n" +
        "    │ ^^^^^  already defined in application.yml:1:1\n" +
        "\n" +
        "✖ 1 duplicate in 1 of 1 profile file\n",
    );
  });

  it("expands a tab-indented parse error before placing its caret", () => {
    const source = "\tb: 2\n";
    const results: FileResult[] = [
      {
        file: "application-broken.yml",
        source,
        redundant: [],
        error: new ConfigError("application-broken.yml", "tab-indented", at(1, 2, 1, 3), source),
      },
    ];
    expect(renderResults(results, check)).toBe(
      "✖ application-broken.yml:1:2  invalid YAML\n" +
        "  1 │     b: 2\n" +
        "    │     ^^^^  tab-indented\n" +
        "\n" +
        "  Fix the YAML syntax at application-broken.yml:1:2.\n",
    );
  });

  it("escapes control characters so a value cannot break the row layout", () => {
    const rendered = renderResults(
      [{ file: "a.yml", redundant: [entry("a\nb", "line1\nline2")] }],
      check,
    );
    expect(rendered.split("\n")[1]).toBe("  1:1  duplicate  a\\nb = line1\\nline2");
  });

  it("escapes control characters in fix rows", () => {
    const rendered = renderResults(
      [{ file: "a.yml", redundant: [entry("a\tb", "x\u0007y")] }],
      fix,
    );
    expect(rendered.split("\n")[1]).toBe("  − a\\tb = x\\x07y");
  });

  it("clamps a cross-line span to the key's line", () => {
    const source = "abc\ndef\n";
    const results: FileResult[] = [
      {
        file: "a.yml",
        source,
        redundant: [entry("a", 1, at(1, 1, 3, 5), baseAt("application.yml", 1, 1))],
      },
    ];
    expect(renderResults(results, check)).toContain(
      "    │ ^^^  already defined in application.yml:1:1",
    );
  });

  it("widens the gutter for multi-digit line numbers", () => {
    const source = `${Array.from({ length: 9 }, (_, index) => `k${index}: ${index}`).join("\n")}\nk9: 9\n`;
    const results: FileResult[] = [
      {
        file: "a.yml",
        source,
        redundant: [entry("k9", 9, at(10, 1, 10, 6), baseAt("application.yml", 1, 1))],
      },
    ];
    expect(renderResults(results, check)).toContain(
      "  10 │ k9: 9\n     │ ^^^^^  already defined in application.yml:1:1",
    );
  });

  it("marks entries as removable in dry-run mode and labels the run", () => {
    const source = "# profile\nmy.app.maxThreads: 8\n";
    const results: FileResult[] = [
      {
        file: "application-prod.yml",
        source,
        redundant: [
          entry("my.app.maxThreads", 8, at(2, 1, 2, 21), baseAt("application.yml", 6, 5)),
        ],
      },
    ];
    const rendered = renderResults(results, dryRun);
    expect(rendered).toContain("  2:1  duplicate  my.app.maxThreads = 8 (would remove)\n");
    expect(rendered).toContain(
      "✖ 1 duplicate in 1 of 1 profile file (dry run — nothing written)\n",
    );
    expect(rendered).not.toContain("No duplicates found.");
  });

  it("lists removals and a green summary in fix mode", () => {
    const results: FileResult[] = [
      {
        file: "application-prod.yml",
        source: "a: 1\nb: 2\n",
        redundant: [
          entry("server.port", 8080, at(1, 1, 1, 2), baseAt("application.yml", 1, 1)),
          entry("logging.level", "info", at(2, 1, 2, 2), baseAt("application.yml", 2, 1)),
        ],
      },
      { file: "application-test.yml", redundant: [], source: "" },
    ];
    expect(renderResults(results, fix)).toBe(
      "✓ application-prod.yml  removed 2 duplicates\n" +
        "  − server.port = 8080\n" +
        "  − logging.level = info\n" +
        "\n" +
        "✓ Removed 2 duplicates from 1 file.\n",
    );
  });

  it("reports a clean fix run with the success line", () => {
    expect(renderResults([{ file: "a.yml", redundant: [] }], fix)).toBe("✓ No duplicates found.\n");
  });

  it("renders a positioned parse error with a frame and a syntax hint", () => {
    const source = "a: 1\nb:\n  maxThreads: [8,\n";
    const results: FileResult[] = [
      {
        file: "application-prod.yml",
        source,
        redundant: [],
        error: new ConfigError(
          "application-prod.yml",
          "unexpected end of the stream within a flow collection",
          at(3, 3, 3, 4),
          source,
        ),
      },
    ];
    expect(renderResults(results, check)).toBe(
      "✖ application-prod.yml:3:3  invalid YAML\n" +
        "  3 │   maxThreads: [8,\n" +
        "    │   ^^^^^^^^^^^^^^^  unexpected end of the stream within a flow collection\n" +
        "\n" +
        "  Fix the YAML syntax at application-prod.yml:3:3.\n",
    );
  });

  it("renders a positionless config error without a frame", () => {
    const results: FileResult[] = [
      {
        file: "application-multi.yml",
        redundant: [],
        error: new ConfigError("application-multi.yml", "expected a single YAML document, found 2"),
      },
    ];
    expect(renderResults(results, check)).toBe(
      "✖ application-multi.yml\n" +
        "  expected a single YAML document, found 2\n" +
        "\n" +
        "  Fix the YAML in application-multi.yml.\n",
    );
  });

  it("points discovery failures at --help", () => {
    const results: FileResult[] = [
      {
        file: "/srv/app/config",
        redundant: [],
        error: new DiscoveryError(
          "/srv/app/config",
          "no application.yml or application.yaml found",
        ),
      },
    ];
    expect(renderResults(results, check)).toBe(
      "✖ /srv/app/config\n" +
        "  no application.yml or application.yaml found\n" +
        "\n" +
        "  Run spring-config-cleaner --help for usage.\n",
    );
  });

  it("aligns labelled hints and keeps the widest label", () => {
    const results: FileResult[] = [
      { file: "application-prod.yml", redundant: [entry("server.port", 8080)] },
    ];
    const rendered = renderResults(results, {
      ...check,
      hints: [
        { label: "Remove them:", command: "spring-config-cleaner --fix ." },
        {
          label: "Preview first:",
          command: "spring-config-cleaner --fix --dry-run .",
        },
      ],
    });
    expect(rendered).toBe(
      "application-prod.yml\n" +
        "  1:1  duplicate  server.port = 8080\n" +
        "\n" +
        "✖ 1 duplicate in 1 of 1 profile file\n" +
        "\n" +
        "  Remove them:    spring-config-cleaner --fix .\n" +
        "  Preview first:  spring-config-cleaner --fix --dry-run .\n",
    );
  });

  it("summarises duplicates and errors together", () => {
    const results: FileResult[] = [
      { file: "a.yml", redundant: [entry("x", 1)] },
      { file: "b.yml", redundant: [], error: new ConfigError("b.yml", "bad") },
    ];
    expect(renderResults(results, check)).toContain(
      "✖ 1 duplicate in 1 of 2 profile files, 1 error",
    );
  });

  it("does not count findings that an error block hides", () => {
    const results: FileResult[] = [
      {
        file: "a.yml",
        redundant: [entry("x", 1)],
        error: new ConfigError("a.yml", "bad"),
      },
      { file: "b.yml", redundant: [] },
    ];
    const rendered = renderResults(results, check);
    expect(rendered).not.toContain("duplicate in");
    expect(rendered).toContain("bad");
  });

  it("reports removed duplicates and errors without calling them duplicates", () => {
    const results: FileResult[] = [
      { file: "a.yml", redundant: [entry("x", 1)] },
      { file: "b.yml", redundant: [], error: new ConfigError("b.yml", "bad") },
    ];
    expect(renderResults(results, fix)).toContain("✖ Removed 1 duplicate from 1 file, 1 error");
  });

  it("labels a multi-document file as unsupported, not as invalid YAML", () => {
    const source = "a: 1\n---\nb: 2\n";
    const results: FileResult[] = [
      {
        file: "application-multi.yml",
        source,
        redundant: [],
        error: new ConfigError(
          "application-multi.yml",
          "expected a single YAML document, found 2",
          at(2, 1, 2, 2),
          source,
          "multi-document",
        ),
      },
    ];
    expect(renderResults(results, check)).toBe(
      "✖ application-multi.yml:2:1  multiple documents\n" +
        "  2 │ ---\n" +
        "    │ ^^^  expected a single YAML document, found 2\n" +
        "\n" +
        "  Remove the extra YAML document at application-multi.yml:2:1.\n",
    );
  });

  it("colours the whole clean line and success summary green", () => {
    expect(renderResults([], { mode: "check", style: createStyle(true) })).toBe(
      "\u001b[32m✓ No duplicates found.\u001b[39m\n",
    );
    const fixed = renderResults([{ file: "a.yml", redundant: [entry("x", 1)] }], {
      mode: "fix",
      style: createStyle(true),
    });
    expect(fixed).toContain("\u001b[32m✓ Removed 1 duplicate from 1 file.\u001b[39m");
  });

  it("applies the semantic colours to paths and finding rows", () => {
    const results: FileResult[] = [
      { file: "application-prod.yml", redundant: [entry("server.port", 8080)] },
    ];
    const rendered = renderResults(results, {
      mode: "check",
      style: createStyle(true),
    });
    expect(rendered).toContain("\u001b[36mapplication-prod.yml\u001b[39m");
    expect(rendered).toContain("\u001b[33mduplicate\u001b[39m");
    expect(rendered).toContain("\u001b[1mserver.port\u001b[22m");
  });
});
