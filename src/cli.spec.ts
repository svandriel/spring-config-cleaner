import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.ts";

const BASE = "myApp:\n  baseKey: 1\n";
const PROFILE = "myApp:\n  baseKey: 1\n  extraKey: 2\n";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
  created.length = 0;
  vi.restoreAllMocks();
});

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "scc-"));
  created.push(dir);
  await Promise.all(
    Object.entries(files).map(([name, source]) => writeFile(join(dir, name), source)),
  );
  return dir;
}

const cleanFixture = () => fixture({ "application.yml": BASE });
const duplicateFixture = () =>
  fixture({ "application.yml": BASE, "application-prod.yml": PROFILE });

function silenceOutput(): void {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("runCli", () => {
  it("exits 0 for a clean directory", async () => {
    silenceOutput();
    expect(await runCli([await cleanFixture()])).toBe(0);
  });

  it("exits 1 and prints the report when duplicates exist", async () => {
    silenceOutput();
    const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(await runCli([await duplicateFixture()])).toBe(1);
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]?.[0])).toContain("baseKey");
  });

  it("rejects --check and --fix together", async () => {
    silenceOutput();
    const dir = await duplicateFixture();
    expect(await runCli([dir, "--check", "--fix"])).not.toBe(0);
  });

  it("rejects an unknown --style choice", async () => {
    silenceOutput();
    const dir = await duplicateFixture();
    expect(await runCli([dir, "--style", "bogus"])).not.toBe(0);
    expect(await readFile(join(dir, "application-prod.yml"), "utf8")).toBe(PROFILE);
  });

  it("fails with a message when --dry-run is used without --fix", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = await duplicateFixture();
    expect(await runCli([dir, "--dry-run"])).toBe(1);
    expect(err.mock.calls.some((call) => String(call[0]).includes("--fix"))).toBe(true);
  });

  it("fixes duplicates on disk and exits 0", async () => {
    silenceOutput();
    const dir = await duplicateFixture();
    expect(await runCli([dir, "--fix"])).toBe(0);
    const profile = await readFile(join(dir, "application-prod.yml"), "utf8");
    expect(profile).toContain("extra-key");
    expect(profile).not.toContain("base-key");
    expect(await readFile(join(dir, "application.yml"), "utf8")).toBe(BASE);
  });

  it("--dry-run with --fix leaves the disk identical", async () => {
    silenceOutput();
    const dir = await duplicateFixture();
    expect(await runCli([dir, "--fix", "--dry-run"])).toBe(0);
    expect(await readFile(join(dir, "application-prod.yml"), "utf8")).toBe(PROFILE);
  });

  it("fails on files whose contents already report duplicates but fail to parse", async () => {
    silenceOutput();
    const dir = await fixture({ "application.yml": BASE, "application-prod.yml": "a: [1, 2\n" });
    expect(await runCli([dir, "--fix"])).toBe(1);
  });

  it("prints help and exits 0", async () => {
    silenceOutput();
    expect(await runCli(["--help"])).toBe(0);
  });
});
