/**
 * Human-readable rendering of per-file dedupe outcomes for the check/fix
 * report. Each file result becomes one block: the file path line, then either
 * one indented line per redundant entry (optionally suffixed `(would remove)`
 * in dry-run mode) or, when the file failed to parse, a single `[error]`
 * line. Blocks with at least one redundant entry end with a count summary;
 * clean and error blocks stop after the indented lines. When nothing is
 * reportable the fixed "No duplicates found." line is emitted.
 */
import type { RedundantEntry } from "./compare.ts";

/**
 * Failure a file block can carry — a `ConfigError` (broken parse) or a
 * `DiscoveryError` (discovery aborted before comparison). Rendering only
 * needs `error.message`; the offending path is carried by `file`.
 */
export type FileError = Error;

/** Check/fix outcome for one profile config file. */
export interface FileResult {
  /** Path of the profile file, as reported in the block header. */
  file: string;
  /** Redundant entries found in the file, in report order. */
  redundant: RedundantEntry[];
  /** Source text of the file as read, used to render diagnostic frames. */
  source?: string;
  /** Set when the file could not be parsed or read; `undefined` otherwise. */
  error?: FileError;
}

/** Report text emitted when no file yields anything to report. */
export const NO_DUPLICATES_LINE = "No duplicates found.\n";

/**
 * Render one entry's value: plain objects and arrays as JSON, everything
 * else (including `null` and `undefined`) via `String`.
 */
function formatValue(value: unknown): string {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

/** One indented entry line, suffixed `(would remove)` in dry-run mode. */
function entryLine(redundant: RedundantEntry, dryRun: boolean): string {
  const suffix = dryRun ? " (would remove)" : "";
  return `  ${redundant.path} = ${formatValue(redundant.value)}${suffix}`;
}

/** All report lines of a single file's block, before the final newline join. */
function blockLines(result: FileResult, dryRun: boolean): string[] {
  const { file, redundant, error } = result;
  if (error !== undefined) {
    return [file, `  [error] ${error.message}`];
  }
  const count = redundant.length;
  const summary =
    count > 0 ? [`${count} ${count === 1 ? "duplicate" : "duplicates"} in ${file}`] : [];
  return [file, ...redundant.map((entry) => entryLine(entry, dryRun)), ...summary];
}

/** Whether a result contributes a report block (entries or an error). */
function isReportable(result: FileResult): boolean {
  return result.error !== undefined || result.redundant.length > 0;
}

/**
 * Render the full report for per-file results, preserving input order.
 * Files with neither redundant entries nor an error contribute nothing; when
 * nothing is reportable at all the exact line "No duplicates found." is
 * returned instead. Errors are rendered per file and never abort rendering
 * of the remaining files.
 */
export function renderReport(results: FileResult[], dryRun: boolean): string {
  const reportable = results.some(isReportable);
  if (!reportable) {
    return NO_DUPLICATES_LINE;
  }
  return results.map((result) => `${blockLines(result, dryRun).join("\n")}\n`).join("");
}
