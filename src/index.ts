/**
 * Public library surface: re-exports every stage's helpers and provides the
 * check/fix orchestration over a config directory. Discovery failures
 * (`DiscoveryError`, filesystem errors) and per-file parse failures
 * (`ConfigError`) are never rethrown — each maps to a single errored
 * `FileResult` so callers always get a renderable `CheckResult`.
 */
import { writeFile } from "node:fs/promises";
import { compareProfileFile, type RedundantEntry } from "./compare.ts";
import { ConfigError, type ConfigFile } from "./configfile.ts";
import { DiscoveryError, type DiscoveryResult, discoverConfigs } from "./discovery.ts";
import { extractProfileName, type KeyStyle } from "./keys.ts";
import type { BaseRewritePreview, FileResult } from "./report.ts";
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
export type { BaseRewritePreview, FileResult } from "./report.ts";
export { NO_DUPLICATES_LINE, renderReport } from "./report.ts";
export type { Structure, WriteOptions } from "./rewrite.ts";
export { rewriteConfigFile } from "./rewrite.ts";
export * from "./values.ts";

/** Check/fix outcome across all profile files of a config directory. */
export interface CheckResult {
  /** One result per discovered profile file, plus a base-format error when applicable. */
  files: FileResult[];
  /** Redundant entries counted across all profile files. */
  duplicates: number;
  /** Present when the base file would change under a requested `--base` check. */
  basePreview?: BaseRewritePreview;
}

/** Optional base-format validation for `checkConfigs`. */
export interface CheckOptions {
  /** Check that the base file already matches the selected format. */
  base?: boolean;
  /** Key style to validate when `base` is enabled; defaults to `preserve`. */
  style?: KeyStyle;
  /** Structure to validate when `base` is enabled; defaults to `preserve`. */
  structure?: Structure;
}

/** Options for `fixConfigs`: key restyle, structural layout, optional base formatting, dry-run. */
export interface FixOptions {
  /** Style surviving key segments are re-rendered in. */
  style: KeyStyle;
  /** Structural layout of the rewritten files. */
  structure: Structure;
  /** Also rewrite the base application file using `style` and `structure`. */
  base?: boolean;
  /** Compute the rewrite but never write to disk. */
  dryRun?: boolean;
}

/** Outcome of a fix run, optionally indicating a base-file change in dry-run mode. */
export interface FixResult extends CheckResult {
  /** Base file that would change when `base` and `dryRun` are both enabled. */
  basePreview?: BaseRewritePreview;
}

/** Source text carried by a thrown value, when it has one. */
function sourceOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const source = (error as { source?: unknown }).source;
  return typeof source === "string" ? source : undefined;
}

/** Single errored `FileResult` for a check/fix that failed before comparing. */
function errorResult(file: string, error: unknown): CheckResult {
  const failure = error instanceof Error ? error : new Error(String(error));
  const source = sourceOf(error);
  return {
    files: [
      {
        file,
        redundant: [],
        error: failure,
        ...(source === undefined ? {} : { source }),
      },
    ],
    duplicates: 0,
  };
}

/** Path a pre-comparison failure belongs to: the failing file or the directory. */
function errorPath(fallback: string, error: unknown): string {
  return error instanceof ConfigError || error instanceof DiscoveryError ? error.path : fallback;
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
  applyBase?: (base: ConfigFile) => Promise<void>,
): Promise<CheckResult> {
  let discovered: DiscoveryResult;
  try {
    discovered = await discoverConfigs(dir);
  } catch (err) {
    return errorResult(errorPath(dir, err), err);
  }
  const { base, profiles } = discovered;

  let baseFailure: FileResult | undefined;
  if (applyBase !== undefined) {
    try {
      await applyBase(base);
    } catch (err) {
      baseFailure = {
        file: errorPath(base.path, err),
        redundant: [],
        source: base.source,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  const files = await Promise.all(
    profiles.map(async (profile): Promise<FileResult> => {
      const name = extractProfileName(profile.path);
      if (name === null) {
        return { file: profile.path, redundant: [], source: profile.source };
      }
      try {
        const { redundant } = compareProfileFile(base, profile, name);
        if (apply !== undefined && redundant.length > 0) {
          await apply(profile, redundant);
        }
        return { file: profile.path, redundant, source: profile.source };
      } catch (err) {
        return {
          file: err instanceof ConfigError ? err.path : profile.path,
          redundant: [],
          source: profile.source,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    }),
  );

  return {
    files: [...(baseFailure === undefined ? [] : [baseFailure]), ...files],
    duplicates: files.reduce((count, file) => count + file.redundant.length, 0),
  };
}

/**
 * Check `dir` for redundant profile entries: discover the base and profiles,
 * compare each profile against the base, and report per-file results without
 * modifying the disk. When `options.base` is enabled, also report if formatting
 * the base file with the selected style and structure would change it.
 */
export async function checkConfigs(dir: string, options: CheckOptions = {}): Promise<CheckResult> {
  let basePreview: BaseRewritePreview | undefined;
  const result = await analyzeConfigs(
    dir,
    undefined,
    options.base === true
      ? async (base) => {
          const style = options.style ?? "preserve";
          const structure = options.structure ?? "preserve";
          const rewritten = rewriteConfigFile(base.source, [], { style, structure });
          if (rewritten !== base.source) {
            basePreview = { file: base.path, style, structure };
          }
        }
      : undefined,
  );
  return basePreview === undefined ? result : { ...result, basePreview };
}

/**
 * Fix `dir`: like `checkConfigs`, but every profile file with redundant
 * entries is rewritten (key restyle and structural layout per `options`) and
 * written back unless `dryRun`. Files without duplicates are never written;
 * the base file is rewritten only when `options.base` is true.
 */
export async function fixConfigs(dir: string, options: FixOptions): Promise<FixResult> {
  let basePreview: BaseRewritePreview | undefined;
  const result = await analyzeConfigs(
    dir,
    async (profile, redundant) => {
      if (options.dryRun === true) {
        return;
      }
      const rewritten = rewriteConfigFile(profile.source, redundant, {
        style: options.style,
        structure: options.structure,
      });
      await writeFile(profile.path, rewritten, "utf8");
    },
    options.base === true
      ? async (base) => {
          const rewritten = rewriteConfigFile(base.source, [], {
            style: options.style,
            structure: options.structure,
          });
          if (options.dryRun === true) {
            if (rewritten !== base.source) {
              basePreview = {
                file: base.path,
                style: options.style,
                structure: options.structure,
              };
            }
          } else {
            await writeFile(base.path, rewritten, "utf8");
          }
        }
      : undefined,
  );
  return basePreview === undefined ? result : { ...result, basePreview };
}
