/**
 * Flat-directory discovery of Spring config files.
 *
 * A config directory holds at most `application.yml`/`application.yaml` (the
 * base) plus `application-<profile>.{yml,yaml}` side files; anything else
 * (`bootstrap.yml`, unrelated YAML, subdirectories) is ignored. Discovery
 * fails with `DiscoveryError` when the base is missing or ambiguous, or when
 * both extension variants of the same profile exist; a malformed candidate
 * raises `ConfigError` from parsing, unwrapped.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { type ConfigFile, parseConfigFile } from "./configfile.ts";
import { extractProfileName } from "./keys.ts";

/** Failure of config discovery itself. `path` is the offending directory or file. */
export class DiscoveryError extends Error {
  path: string;

  constructor(path: string, message: string) {
    super(message);
    this.path = path;
    this.name = "DiscoveryError";
  }
}

/** The parsed base config plus its profile-specific files, sorted by profile name. */
export interface DiscoveryResult {
  base: ConfigFile;
  profiles: ConfigFile[];
}

const BASE_NAMES = new Set(["application.yml", "application.yaml"]);

async function load(path: string): Promise<ConfigFile> {
  return parseConfigFile(path, await readFile(path, "utf8"));
}

/**
 * Discover configs in `dir`: the single base `application.{yml,yaml}` and the
 * `application-<profile>` files, the latter sorted lexicographically by
 * profile name. Candidate paths carry the directory prefix so error reports
 * point at real files.
 */
export async function discoverConfigs(dir: string): Promise<DiscoveryResult> {
  const entries = await readdir(dir);
  const names = await Promise.all(
    entries.map(async (name) => ((await stat(join(dir, name))).isFile() ? name : null)),
  );

  const candidates = names
    .filter((name): name is string => name !== null)
    .filter((name) => BASE_NAMES.has(name) || extractProfileName(name) !== null)
    .sort();

  const baseNames = candidates.filter((name) => BASE_NAMES.has(name));
  const baseName = baseNames[0];
  if (baseName === undefined) {
    throw new DiscoveryError(dir, "no application.yml or application.yaml found");
  }
  if (baseNames.length > 1) {
    throw new DiscoveryError(dir, "both application.yml and application.yaml exist");
  }

  // `candidates` is sorted, so a profile's variants meet in `application-<p>.yaml`
  // then `.yml` order; the reported clash path is the second of the two.
  const profileFiles = candidates.reduce<Map<string, string>>((acc, name) => {
    const profile = extractProfileName(name);
    if (profile === null) {
      return acc;
    }
    const existing = acc.get(profile);
    if (existing !== undefined) {
      throw new DiscoveryError(join(dir, name), `both variants of profile "${profile}" exist`);
    }
    acc.set(profile, name);
    return acc;
  }, new Map());

  const sorted = [...profileFiles.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const [base, profiles] = await Promise.all([
    load(join(dir, baseName)),
    Promise.all(sorted.map(([, name]) => load(join(dir, name)))),
  ]);

  return { base, profiles };
}
