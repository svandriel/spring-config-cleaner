/**
 * Public report facade over the diagnostic renderer. `renderReport` is the
 * colour-free convenience API for library callers; the CLI uses
 * `renderResults` directly so it can pass terminal colour and hints.
 */
import type { RedundantEntry } from "./compare.ts";
import { renderResults } from "./render.ts";
import { plainStyle } from "./style.ts";

/**
 * Failure a file block can carry — a `ConfigError` (broken parse) or a
 * `DiscoveryError` (discovery aborted before comparison). Rendering only
 * needs `error.message`; positions and the source are read duck-typed.
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
export const NO_DUPLICATES_LINE = "✔ No duplicates found.\n";

/**
 * Render the full report for per-file results, preserving input order, without
 * colour or invocation-specific hints. Files with neither redundant entries nor
 * an error contribute nothing; when nothing is reportable at all the exact
 * clean line is returned instead.
 */
export function renderReport(results: FileResult[], dryRun: boolean): string {
  return renderResults(results, {
    mode: dryRun ? "dry-run" : "check",
    style: plainStyle,
  });
}
