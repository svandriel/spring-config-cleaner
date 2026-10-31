import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.ts";

const BASE = "myApp:\n  baseKey: 1\n";
const PROFILE = "myApp:\n  baseKey: 1\n  extraKey: 2\n";

const created: string[] = [];

// Mock package.json import
vi.mock("../package.json", () => ({
  default: { version: "1.2.3" },
}));

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

/** Duplicate fixture in a directory whose name needs shell quoting. */
async function spacedFixture(): Promise<string> {
  const root = await fixture({});
  const dir = join(root, "my config");
  await mkdir(dir);
  await writeFile(join(dir, "application.yml"), BASE);
  await writeFile(join(dir, "application-prod.yml"), PROFILE);
  return dir;
}

function silenceOutput(): void {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

/** All text written to a mocked stream, in order. */
function written(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((call) => String(call[0])).join("");
}

describe("runCli", () => {
  it("exits 0 for a clean directory", async () => {
    silenceOutput();
    expect(await runCli([await cleanFixture()])).toBe(0);
  });

  it("prints only the clean line (no hints) for a clean directory", async () => {
    silenceOutput();
    const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(await runCli([await cleanFixture()])).toBe(0);
    expect(written(log)).toBe("✓ No duplicates found.\n");
  });

  it("exits 1 and prints the report when duplicates exist", async () => {
    silenceOutput();
    const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(await runCli([await duplicateFixture()])).toBe(1);
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]?.[0])).toContain("baseKey");
  });

  it("adds actionable check-mode hints for duplicates", async () => {
    silenceOutput();
    const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const dir = await duplicateFixture();
    expect(await runCli([dir])).toBe(1);
    const out = written(log);
    expect(out).toContain(`Remove them:    spring-config-cleaner --fix ${dir}`);
    expect(out).toContain(`Preview first:  spring-config-cleaner --fix --dry-run ${dir}`);
  });

  it("quotes a directory with spaces in hint commands", async () => {
    silenceOutput();
    const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const dir = await spacedFixture();
    expect(await runCli([dir])).toBe(1);
    expect(written(log)).toContain(`spring-config-cleaner --fix '${dir}'`);
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

  it("adds the --help hint to commander usage errors on stderr", async () => {
    silenceOutput();
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await runCli(["--nope"])).not.toBe(0);
    expect(written(err)).toContain("Run spring-config-cleaner --help for usage.");
  });

  it("fails with a styled message and hint when --dry-run is used without --fix", async () => {
    silenceOutput();
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const dir = await duplicateFixture();
    expect(await runCli([dir, "--dry-run"])).toBe(1);
    const text = written(err);
    expect(text).toContain("--dry-run requires --fix");
    expect(text).toContain("--help");
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

  it("hints at verification after a fix", async () => {
    silenceOutput();
    const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const dir = await duplicateFixture();
    expect(await runCli([dir, "--fix"])).toBe(0);
    expect(written(log)).toContain(`Verify:  spring-config-cleaner --check ${dir}`);
  });

  it("--dry-run with --fix leaves the disk identical and hints at applying", async () => {
    silenceOutput();
    const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const dir = await duplicateFixture();
    expect(await runCli([dir, "--fix", "--dry-run", "--style", "snake"])).toBe(0);
    expect(await readFile(join(dir, "application-prod.yml"), "utf8")).toBe(PROFILE);
    expect(written(log)).toContain(`Apply:  spring-config-cleaner --fix --style snake ${dir}`);
  });

  it("fails on files whose contents already report duplicates but fail to parse", async () => {
    silenceOutput();
    const dir = await fixture({
      "application.yml": BASE,
      "application-prod.yml": "a: [1, 2\n",
    });
    expect(await runCli([dir, "--fix"])).toBe(1);
  });

  it("prints help and exits 0", async () => {
    silenceOutput();
    expect(await runCli(["--help"])).toBe(0);
  });

  it("prints the version number when --version is passed", async () => {
    silenceOutput();
    const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(await runCli(["--version"])).toBe(0);
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]?.[0])).toContain("1.2.3");
  });
});
