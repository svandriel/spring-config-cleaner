import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError } from "./configfile.ts";
import { DiscoveryError, discoverConfigs } from "./discovery.ts";
import { extractProfileName } from "./keys.ts";

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

describe("discoverConfigs", () => {
  it("finds the base and profiles sorted by name, ignoring non-candidates", async () => {
    const dir = await fixture({
      "application.yml": "name: base\n",
      "application-prod.yml": "name: prod\n",
      "application-test.yaml": "name: test\n",
      "bootstrap.yml": "name: bootstrap\n",
      "other.yml": "name: other\n",
    });

    const result = await discoverConfigs(dir);

    expect(result.base.path).toBe(join(dir, "application.yml"));
    expect(result.profiles.map((p) => p.path)).toEqual([
      join(dir, "application-prod.yml"),
      join(dir, "application-test.yaml"),
    ]);
    expect(result.profiles.map((p) => extractProfileName(p.path))).toEqual(["prod", "test"]);
  });

  it("returns an empty profile list when only the base exists", async () => {
    const dir = await fixture({ "application.yaml": "name: base\n" });

    const result = await discoverConfigs(dir);

    expect(result.base.path).toBe(join(dir, "application.yaml"));
    expect(result.profiles).toEqual([]);
  });

  it("rejects with DiscoveryError carrying the directory when no base exists", async () => {
    const dir = await fixture({ "application-prod.yml": "name: prod\n" });

    const promise = discoverConfigs(dir);
    await expect(promise).rejects.toBeInstanceOf(DiscoveryError);
    await expect(promise).rejects.toMatchObject({ name: "DiscoveryError", path: dir });
  });

  it("rejects with DiscoveryError carrying the directory when both base variants exist", async () => {
    const dir = await fixture({
      "application.yml": "name: yml\n",
      "application.yaml": "name: yaml\n",
    });

    const promise = discoverConfigs(dir);
    await expect(promise).rejects.toBeInstanceOf(DiscoveryError);
    await expect(promise).rejects.toMatchObject({ name: "DiscoveryError", path: dir });
  });

  it("rejects when both variants of one profile exist", async () => {
    const dir = await fixture({
      "application.yml": "name: base\n",
      "application-prod.yaml": "name: yaml\n",
      "application-prod.yml": "name: yml\n",
    });

    await expect(discoverConfigs(dir)).rejects.toMatchObject({
      name: "DiscoveryError",
      path: join(dir, "application-prod.yml"),
    });
  });

  it("propagates ConfigError as-is from a broken candidate", async () => {
    const dir = await fixture({
      "application.yml": "name: base\n",
      "application-prod.yml": "a: 1\n---\nb: 2\n",
    });

    const promise = discoverConfigs(dir);
    await expect(promise).rejects.toBeInstanceOf(ConfigError);
    await expect(promise).rejects.toMatchObject({
      name: "ConfigError",
      path: join(dir, "application-prod.yml"),
    });
  });

  it("ignores a directory named like a candidate", async () => {
    const dir = await fixture({ "application.yml": "name: base\n" });
    await mkdir(join(dir, "application-dir.yml"));

    const result = await discoverConfigs(dir);

    expect(result.profiles).toEqual([]);
  });

  it("follows symlinks to profiles", async () => {
    const dir = await fixture({
      "application.yml": "name: base\n",
      "staging.yml": "name: staging\n",
    });
    await symlink(join(dir, "staging.yml"), join(dir, "application-staging.yml"));

    const result = await discoverConfigs(dir);

    expect(result.profiles.map((p) => p.path)).toEqual([join(dir, "application-staging.yml")]);
  });
});
