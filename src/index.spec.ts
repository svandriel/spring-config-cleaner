import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkConfigs, fixConfigs } from "./index.ts";

const BASE = "myApp:\n  baseKey: 1\n";
const PROFILE = "myApp:\n  baseKey: 1\n  extraKey: 2\n";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
  created.length = 0;
});

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "scc-"));
  created.push(dir);
  await Promise.all(
    Object.entries(files).map(([name, source]) => writeFile(join(dir, name), source)),
  );
  return dir;
}

describe("checkConfigs", () => {
  it("counts one duplicate per redundant profile entry and its dotted path", async () => {
    const dir = await fixture({ "application.yml": BASE, "application-prod.yml": PROFILE });

    const result = await checkConfigs(dir);

    expect(result.duplicates).toBe(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.file).toBe(join(dir, "application-prod.yml"));
    expect(result.files[0]?.redundant[0]?.path).toBe("myApp.baseKey");
  });

  it("yields an errored FileResult naming the directory when no base exists", async () => {
    const dir = await fixture({ "application-prod.yml": PROFILE });

    const result = await checkConfigs(dir);

    expect(result.duplicates).toBe(0);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.file).toBe(dir);
    expect(result.files[0]?.error).toBeInstanceOf(Error);
    expect(result.files[0]?.redundant).toEqual([]);
  });

  it("yields an errored FileResult naming the broken profile file", async () => {
    const dir = await fixture({ "application.yml": BASE, "application-prod.yml": "a: [1, 2\n" });

    const result = await checkConfigs(dir);

    expect(result.duplicates).toBe(0);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.file).toBe(join(dir, "application-prod.yml"));
    expect(result.files[0]?.error).toBeInstanceOf(Error);
  });

  it("reports the fixed no-duplicates outcome for a clean directory", async () => {
    const dir = await fixture({ "application.yml": BASE });

    const result = await checkConfigs(dir);

    expect(result.files).toEqual([]);
    expect(result.duplicates).toBe(0);
  });
});

describe("fixConfigs", () => {
  it("leaves the disk byte-identical in dry-run mode", async () => {
    const dir = await fixture({ "application.yml": BASE, "application-prod.yml": PROFILE });

    const result = await fixConfigs(dir, { style: "kebab", structure: "preserve", dryRun: true });

    expect(result.duplicates).toBe(1);
    expect(await readFile(join(dir, "application.yml"), "utf8")).toBe(BASE);
    expect(await readFile(join(dir, "application-prod.yml"), "utf8")).toBe(PROFILE);
  });

  it("rewrites the profile with restyled survivors and never touches the base", async () => {
    const dir = await fixture({ "application.yml": BASE, "application-prod.yml": PROFILE });

    const result = await fixConfigs(dir, { style: "kebab", structure: "preserve" });

    expect(result.duplicates).toBe(1);
    const profile = await readFile(join(dir, "application-prod.yml"), "utf8");
    expect(profile).toContain("my-app");
    expect(profile).toContain("extra-key");
    expect(profile).not.toContain("base-key");
    expect(await readFile(join(dir, "application.yml"), "utf8")).toBe(BASE);
  });

  it("keeps every file untouched when no duplicates exist", async () => {
    const dir = await fixture({ "application.yml": BASE });

    await fixConfigs(dir, { style: "kebab", structure: "preserve" });

    expect(await readFile(join(dir, "application.yml"), "utf8")).toBe(BASE);
  });

  it("maps a discovery failure to one errored FileResult and writes nothing", async () => {
    const dir = await fixture({ "application-prod.yml": PROFILE });

    const result = await fixConfigs(dir, { style: "kebab", structure: "preserve" });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.file).toBe(dir);
    expect(result.files[0]?.error).toBeInstanceOf(Error);
    expect(await readFile(join(dir, "application-prod.yml"), "utf8")).toBe(PROFILE);
  });
});
