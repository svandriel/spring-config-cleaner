import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { flattenDocument } from "./paths.ts";

const CLI = join(process.cwd(), "dist", "cli.js");
const FIXTURES = join(import.meta.dirname, "e2e", "__fixtures__");
const FILES = ["application.yml", "application-prod.yml", "application-test.yml"];

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

async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "scc-e2e-"));
  created.push(dir);
  await cp(join(FIXTURES, name), dir, { recursive: true });
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
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

function pathsOf(source: string): string[] {
  return flattenDocument(parseDocument(source), 0, source).map((entry) => entry.path);
}

describe("e2e CLI", () => {
  it("reports duplicates in every affected profile and writes nothing by default", async () => {
    const dir = await copyFixture("classic");
    const before = await snapshot(dir);

    const result = runCli(dir);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("my.app.maxThreads = 8");
    expect(result.stdout).toContain(`1 duplicate in ${join(dir, "application-prod.yml")}`);
    expect(result.stdout).toContain(`1 duplicate in ${join(dir, "application-test.yml")}`);
    expect(await snapshot(dir)).toEqual(before);
  });

  it("reports identically with --check and style flags", async () => {
    const dir = await copyFixture("classic");
    const before = await snapshot(dir);

    const result = runCli(dir, ["--check", "--style", "kebab"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("my.app.maxThreads = 8");
    expect(await snapshot(dir)).toEqual(before);
  });

  it("previews fixes with --fix --dry-run without touching the disk", async () => {
    const dir = await copyFixture("classic");
    const before = await snapshot(dir);

    const result = runCli(dir, ["--fix", "--dry-run"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("(would remove)");
    expect(await snapshot(dir)).toEqual(before);
  });

  it("rewrites affected profiles and leaves the base file byte-identical", async () => {
    const dir = await copyFixture("classic");
    const base = await readFile(join(dir, "application.yml"), "utf8");

    const result = runCli(dir, ["--fix", "--style", "kebab", "--structure", "preserve"]);

    expect(result.status).toBe(0);
    const prod = await readFile(join(dir, "application-prod.yml"), "utf8");
    expect(pathsOf(prod)).toEqual(["my.app.max-connections", "spring.application.name"]);
    expect(prod).toContain("# overridden intentionally");
    expect(prod).toContain("demo-prod");
    // Comment preservation re-homes the removed entry's comment onto the next key.
    expect(prod).toContain("# duplicate");
    expect(prod).not.toContain("my.app.maxThreads");

    const testProfile = await readFile(join(dir, "application-test.yml"), "utf8");
    expect(pathsOf(testProfile)).toEqual(["my.app.test-only"]);

    expect(await readFile(join(dir, "application.yml"), "utf8")).toBe(base);
  });

  it("reports a clean fixture and leaves it untouched", async () => {
    const dir = await copyFixture("clean");
    const before = {
      "application.yml": await readFile(join(dir, "application.yml"), "utf8"),
      "application-dev.yml": await readFile(join(dir, "application-dev.yml"), "utf8"),
    };

    const result = runCli(dir);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("No duplicates found.\n");
    expect(await readFile(join(dir, "application.yml"), "utf8")).toBe(before["application.yml"]);
    expect(await readFile(join(dir, "application-dev.yml"), "utf8")).toBe(
      before["application-dev.yml"],
    );
  });
});
