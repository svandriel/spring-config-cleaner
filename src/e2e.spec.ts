import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const CLI = join(process.cwd(), "dist", "cli.js");
const FIXTURES = join(import.meta.dirname, "e2e", "__fixtures__");
const FILES = ["application.yml", "application-prod.yml", "application-test.yml"];
const STRUCTURES = ["preserve", "nested", "dotted", "compact"] as const;
const STYLES = ["preserve", "kebab", "camel", "snake"] as const;
const STRUCTURE_STYLE_CASES = STRUCTURES.flatMap((structure) =>
  STYLES.map((style) => [structure, style] as const),
);

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
  created.length = 0;
});

async function copyFixture(name?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "scc-e2e-"));
  created.push(dir);
  await cp(name === undefined ? FIXTURES : join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

async function snapshot(dir: string): Promise<Record<string, string>> {
  const entries = await Promise.all(
    FILES.map(async (name) => [name, await readFile(join(dir, name), "utf8")] as const),
  );
  return Object.fromEntries(entries);
}

function runCli(dir: string, args: string[] = []): RunResult {
  try {
    return {
      status: 0,
      stdout: execFileSync("node", [CLI, dir, ...args], { encoding: "utf8" }),
      stderr: "",
    };
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

/** Classic fixture report: two profiles repeat the base `maxThreads` value. */
function classicReport(dir: string): string {
  const base = join(dir, "application.yml");
  const frame = (line: number, source: string, carets: string) =>
    `  ${line} │ ${source}\n` + `    │ ${carets}  ` + `already defined in ${base}:7:5\n`;
  return (
    `${join(dir, "application-prod.yml")}\n` +
    "  3:3  duplicate  my.app.maxThreads = 8\n" +
    frame(3, "  maxThreads: 8", "  ^^^^^^^^^^^^^") +
    "\n" +
    `${join(dir, "application-test.yml")}\n` +
    "  1:1  duplicate  my.app.maxThreads = 8\n" +
    frame(1, "my.app.maxThreads: 8", "^^^^^^^^^^^^^^^^^^^^") +
    "\n" +
    "✖ 2 duplicates in 2 of 2 profile files\n"
  );
}

describe("e2e CLI", () => {
  it("reports duplicates in every affected profile and writes nothing by default", async () => {
    const dir = await copyFixture("classic");
    const before = await snapshot(dir);

    const result = runCli(dir);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(
      `${classicReport(dir)}\n` +
        `  Remove them:    spring-config-cleaner --fix ${dir}\n` +
        `  Preview first:  spring-config-cleaner --fix --dry-run ${dir}\n`,
    );
    expect(result.stdout).not.toContain("\u001b[");
    expect(await snapshot(dir)).toEqual(before);
  });

  it("reports identically with --check and style flags", async () => {
    const dir = await copyFixture("classic");
    const before = await snapshot(dir);

    const result = runCli(dir, ["--check", "--style", "kebab"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(classicReport(dir));
    expect(await snapshot(dir)).toEqual(before);
  });

  it("previews fixes with --fix --dry-run without touching the disk", async () => {
    const dir = await copyFixture("classic");
    const before = await snapshot(dir);

    const result = runCli(dir, ["--fix", "--dry-run"]);

    expect(result.status).toBe(0);
    const preview = classicReport(dir).replaceAll(" = 8\n", " = 8 (would remove)\n");
    expect(result.stdout).toBe(
      `${preview.slice(0, -1)} (dry run — nothing written)\n` +
        "\n" +
        `  Apply:  spring-config-cleaner --fix ${dir}\n`,
    );
    expect(await snapshot(dir)).toEqual(before);
  });

  it.each(STRUCTURE_STYLE_CASES)(
    "matches %s-%s structure and style output files",
    async (structure, style) => {
      const dir = await copyFixture();
      const result = runCli(dir, ["--fix", "--structure", structure, "--style", style]);

      expect(result.status).toBe(0);
      await Promise.all(
        ["application-test.yml", "application-prod.yml"].map(async (file) => {
          await expect(await readFile(join(dir, file), "utf8")).toMatchFileSnapshot(
            join(FIXTURES, "expected", `${structure}-${style}`, file),
          );
        }),
      );
      expect(await readFile(join(dir, "application.yml"), "utf8")).toBe(
        await readFile(join(FIXTURES, "application.yml"), "utf8"),
      );
    },
  );

  it("reports a clean fixture and leaves it untouched", async () => {
    const dir = await copyFixture("clean");
    const before = {
      "application.yml": await readFile(join(dir, "application.yml"), "utf8"),
      "application-dev.yml": await readFile(join(dir, "application-dev.yml"), "utf8"),
    };

    const result = runCli(dir);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("✓ No duplicates found.\n");
    expect(await readFile(join(dir, "application.yml"), "utf8")).toBe(before["application.yml"]);
    expect(await readFile(join(dir, "application-dev.yml"), "utf8")).toBe(
      before["application-dev.yml"],
    );
  });

  it("shows a YAML parse error with its frame and a syntax hint", async () => {
    const dir = await copyFixture("clean");
    const broken = join(dir, "application-broken.yml");
    await writeFile(broken, "a: 1\n b: 2\n");

    const result = runCli(dir);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(
      `✖ ${broken}:1:4  invalid YAML\n` +
        "  1 │ a: 1\n" +
        "    │    ^  Nested mappings are not allowed in compact mappings\n" +
        "\n" +
        `  Fix the YAML syntax at ${broken}:1:4.\n`,
    );
    expect(result.stdout).not.toContain("\u001b[");
  });
});
