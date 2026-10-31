/**
 * Public library surface: re-exports every stage's helpers and provides the
 * check/fix orchestration over a config directory. Discovery failures
 * (`DiscoveryError`, filesystem errors) and per-file parse failures
 * (`ConfigError`) are never rethrown — each maps to a single errored
 * `FileResult` so callers always get a renderable `CheckResult`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { compareProfileFile, type RedundantEntry } from "./compare.ts";
import { ConfigError, type ConfigFile } from "./configfile.ts";
import type { DiscoveryResult } from "./discovery.ts";
import { discoverConfigs } from "./discovery.ts";
import { extractProfileName, type KeyStyle } from "./keys.ts";
import type { FileResult } from "./report.ts";
import { rewriteConfigFile, type Structure } from "./rewrite.ts";

export * from "./activation.ts";
export type { ComparisonResult, RedundantEntry } from "./compare.ts";
export { compareProfileFile } from "./compare.ts";
export type { ConfigDocument, ConfigFile } from "./configfile.ts";
export { ConfigError, documentActivation, parseConfigFile } from "./configfile.ts";
export type { DiscoveryResult } from "./discovery.ts";
export { DiscoveryError, discoverConfigs } from "./discovery.ts";
export type { KeyStyle } from "./keys.ts";
export { canonicalKey, extractProfileName, renderSegment, splitWords } from "./keys.ts";
export * from "./paths.ts";
export type { FileResult } from "./report.ts";
export { NO_DUPLICATES_LINE, renderReport } from "./report.ts";
export type { Structure, WriteOptions } from "./rewrite.ts";
export { rewriteConfigFile } from "./rewrite.ts";
export * from "./values.ts";

/** Check/fix outcome across all profile files of a config directory. */
export interface CheckResult {
  /** One result per discovered profile file, in profile-name order. */
  files: FileResult[];
  /** Redundant entries counted across all profile files. */
  duplicates: number;
}

/** Options for `fixConfigs`: key restyle, structural layout, dry-run. */
export interface FixOptions {
  /** Style surviving key segments are re-rendered in. */
  style: KeyStyle;
  /** Structural layout of the rewritten files. */
  structure: Structure;
  /** Compute the rewrite but never write to disk. */
  dryRun?: boolean;
}

/** Outcome of a fix run; shapes identically to a check run's result. */
export type FixResult = CheckResult;

/** Single errored `FileResult` for a check/fix that failed before comparing. */
function errorResult(file: string, error: unknown): CheckResult {
  return {
    files: [
      { file, redundant: [], error: error instanceof Error ? error : new Error(String(error)) },
    ],
    duplicates: 0,
  };
}

/**
 * Failures a config directory can raise. `ConfigError` carries the broken
 * file's path (reported as that file's block); every other failure —
 * `DiscoveryError`, filesystem errors — aborts the whole run and is reported
 * against the directory.
 */
async function analyzeConfigs(
  dir: string,
  apply?: (profile: ConfigFile, redundant: RedundantEntry[]) => Promise<void>,
): Promise<CheckResult> {
  let discovered: DiscoveryResult;
  try {
    discovered = await discoverConfigs(dir);
  } catch (err) {
    return errorResult(err instanceof ConfigError ? err.path : dir, err);
  }
  const { base, profiles } = discovered;

  const files = await Promise.all(
    profiles.map(async (profile) => {
      const name = extractProfileName(profile.path);
      if (name === null) {
        return { file: profile.path, redundant: [] };
      }
      const { redundant } = compareProfileFile(base, profile, name);
      if (apply !== undefined && redundant.length > 0) {
        await apply(profile, redundant);
      }
      return { file: profile.path, redundant };
    }),
  );

  return {
    files,
    duplicates: files.reduce((count, file) => count + file.redundant.length, 0),
  };
}

/**
 * Check `dir` for redundant profile entries: discover the base and profiles,
 * compare each profile against the base, and report per-file results without
 * modifying the disk.
 */
export async function checkConfigs(dir: string): Promise<CheckResult> {
  return analyzeConfigs(dir);
}

/**
 * Fix `dir`: like `checkConfigs`, but every profile file with redundant
 * entries is rewritten (key restyle and structural layout per `options`) and
 * written back unless `dryRun`. Files without duplicates and the base file
 * are never written.
 */
export async function fixConfigs(dir: string, options: FixOptions): Promise<FixResult> {
  return analyzeConfigs(dir, async (profile, redundant) => {
    if (options.dryRun === true) {
      return;
    }
    const source = await readFile(profile.path, "utf8");
    const rewritten = rewriteConfigFile(source, redundant, {
      style: options.style,
      structure: options.structure,
    });
    await writeFile(profile.path, rewritten, "utf8");
  });
}
