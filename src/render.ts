/**
 * Rendering of check/fix results as diagnostics: a clickable `path:line:column`,
 * a source frame with a `^^^^` run under the offending span, the base location
 * a duplicate repeats, a summary and actionable hints.
 *
 * Colour and hints are injected: the library's `renderReport` uses
 * `plainStyle` and no hints, while the CLI passes its terminal-aware style and
 * invocation-specific commands.
 */
import type { RedundantEntry } from "./compare.ts";
import { ConfigError } from "./configfile.ts";
import { DiscoveryError } from "./discovery.ts";
import type { FileError, FileResult } from "./report.ts";
import type { Style } from "./style.ts";

/** How the run will treat findings; drives wording and whether frames remain valid. */
export type RenderMode = "check" | "dry-run" | "fix";

/** A hint with an aligned label, e.g. `Remove them:` / `--fix <dir>`. */
export interface HintCommand {
  label: string;
  command: string;
}

/** A free-form trailing hint, already in its final wording. */
export interface HintText {
  text: string;
}

export type Hint = HintCommand | HintText;

export interface RenderOptions {
  mode: RenderMode;
  style: Style;
  hints?: Hint[];
}

const INDENT = "  ";
const BLOCK_SEPARATOR = "\n\n";
const TAB_WIDTH = 4;

/** Plain clean-run text without the trailing newline, shared with the report facade. */
export const CLEAN_LINE = "✓ No duplicates found.";

/** Render one entry's value: plain objects and arrays as JSON, everything else as text. */
function formatValue(value: unknown): string {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

/** Escape control characters that would otherwise split or corrupt a row. */
function sanitize(text: string): string {
  return text.replace(/\p{Cc}/gu, (char) => {
    if (char === "\n") {
      return "\\n";
    }
    if (char === "\r") {
      return "\\r";
    }
    if (char === "\t") {
      return "\\t";
    }
    return `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`;
  });
}

/** Display width of `text` when tabs advance to the next tab stop. */
function displayWidth(text: string): number {
  return [...text].reduce(
    (column, char) => (char === "\t" ? column + TAB_WIDTH - (column % TAB_WIDTH) : column + 1),
    0,
  );
}

/** Display form of a source line, with tabs expanded to the same stops. */
function expandTabs(text: string): string {
  return [...text].reduce(
    (state, char) => {
      const width = char === "\t" ? TAB_WIDTH - (state.column % TAB_WIDTH) : 1;
      return {
        text: state.text + (char === "\t" ? " ".repeat(width) : char),
        column: state.column + width,
      };
    },
    { text: "", column: 0 },
  ).text;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Source split into lines with `\r` line endings and trailing blanks removed. */
function sourceLines(source: string): string[] {
  return source.split("\n").map((line) => line.replace(/\r$/u, "").replace(/[ \t]+$/u, ""));
}

function lineText(lines: string[], line: number): string | undefined {
  return lines[line - 1];
}

function gutterWidth(positions: Array<{ line: number }>): number {
  return Math.max(1, ...positions.map((position) => String(position.line).length));
}

/** Caret run for a finding: the span clamped to its start line, at least one caret. */
function spanCarets(text: string, entry: RedundantEntry): string {
  const start = Math.min(Math.max(entry.position.column - 1, 0), text.length);
  const end =
    entry.position.endLine > entry.position.line
      ? text.length
      : Math.min(Math.max(entry.position.endColumn - 1, entry.position.column), text.length);
  const startColumn = displayWidth(text.slice(0, start));
  const endColumn = displayWidth(text.slice(0, end));
  return `${" ".repeat(startColumn)}${"^".repeat(Math.max(1, endColumn - startColumn))}`;
}

/** Caret run for a parse error: the rest of the broken line from the reported column. */
function errorCarets(text: string, column: number): string {
  const start = Math.min(Math.max(column - 1, 0), text.length);
  const startColumn = displayWidth(text.slice(0, start));
  const endColumn = displayWidth(text);
  return `${" ".repeat(startColumn)}${"^".repeat(Math.max(1, endColumn - startColumn))}`;
}

function gutter(style: Style, width: number, line: number | undefined, text: string): string {
  const number = line === undefined ? " ".repeat(width) : String(line).padStart(width, " ");
  return `${INDENT}${number} ${style.dim("│")} ${text}`;
}

function entryRow(style: Style, entry: RedundantEntry, mode: RenderMode): string {
  const suffix = mode === "dry-run" ? style.dim(" (would remove)") : "";
  const position = style.position(`${entry.position.line}:${entry.position.column}`);
  return `${INDENT}${position}  ${style.duplicate("duplicate")}  ${style.key(sanitize(entry.path))} = ${sanitize(formatValue(entry.value))}${suffix}`;
}

/** The entry row plus, when the source is known, its frame and base reference. */
function entryLines(
  style: Style,
  entry: RedundantEntry,
  mode: RenderMode,
  lines: string[] | undefined,
  width: number,
): string[] {
  const row = entryRow(style, entry, mode);
  const text = lines === undefined ? undefined : lineText(lines, entry.position.line);
  if (text === undefined) {
    return [row];
  }
  const base = entry.base;
  const annotation =
    style.dim("already defined in ") +
    style.path(base.file) +
    style.position(`:${base.position.line}:${base.position.column}`);
  return [
    row,
    gutter(style, width, entry.position.line, expandTabs(text)),
    gutter(style, width, undefined, `${spanCarets(text, entry)}  ${annotation}`),
  ];
}

function findingBlock(result: FileResult, mode: RenderMode, style: Style): string[] | undefined {
  const { redundant } = result;
  if (redundant.length === 0) {
    return undefined;
  }
  const lines = result.source === undefined ? undefined : sourceLines(result.source);
  const width = gutterWidth(redundant.map((entry) => entry.position));
  return [
    style.path(result.file),
    ...redundant.flatMap((entry) => entryLines(style, entry, mode, lines, width)),
  ];
}

function fixBlock(result: FileResult, style: Style): string[] | undefined {
  const { redundant } = result;
  if (redundant.length === 0) {
    return undefined;
  }
  const header =
    `${style.success("✓")} ${style.path(result.file)}  ` +
    `${style.dim("removed")} ${plural(redundant.length, "duplicate", "duplicates")}`;
  const rows = redundant.map(
    (entry) =>
      `${INDENT}${style.duplicate("−")} ${style.key(sanitize(entry.path))} = ${sanitize(formatValue(entry.value))}`,
  );
  return [header, ...rows];
}

/** YAML parse position carried by a config error, if any. */
function configPosition(error: FileError): { line: number; column: number } | undefined {
  const candidate = error as { line?: unknown; column?: unknown };
  return typeof candidate.line === "number" && typeof candidate.column === "number"
    ? { line: candidate.line, column: candidate.column }
    : undefined;
}

function isConfigError(error: FileError): boolean {
  return error instanceof ConfigError || error.name === "ConfigError";
}

/** Distinguishes a syntax failure from an unsupported multi-document file. */
function isMultiDocument(error: FileError): boolean {
  return (error as { kind?: unknown }).kind === "multi-document";
}

function isDiscoveryError(error: FileError): boolean {
  return error instanceof DiscoveryError || error.name === "DiscoveryError";
}

/** Error source text: the error's own copy, else the result's, else unavailable. */
function errorSource(result: FileResult, error: FileError): string | undefined {
  const source = (error as { source?: unknown }).source;
  return typeof source === "string" ? source : result.source;
}

function errorHeader(
  style: Style,
  result: FileResult,
  error: FileError,
  position: { line: number; column: number } | undefined,
): string {
  const marker = style.error("✖");
  if (position === undefined) {
    return `${marker} ${style.path(result.file)}`;
  }
  const label = isMultiDocument(error) ? "multiple documents" : "invalid YAML";
  return (
    `${marker} ${style.path(result.file)}` +
    `${style.position(`:${position.line}:${position.column}`)}  ` +
    `${style.error(label)}`
  );
}

function errorBlock(result: FileResult, style: Style): string[] {
  const error = result.error as FileError;
  const position = configPosition(error);
  const source = errorSource(result, error);
  const lines = source === undefined ? undefined : sourceLines(source);
  const text =
    lines === undefined || position === undefined ? undefined : lineText(lines, position.line);
  const header = errorHeader(style, result, error, position);
  if (text === undefined || lines === undefined || position === undefined) {
    return [header, `${INDENT}${style.error(error.message)}`];
  }
  const width = gutterWidth([position]);
  return [
    header,
    gutter(style, width, position.line, expandTabs(text)),
    gutter(
      style,
      width,
      undefined,
      `${errorCarets(text, position.column)}  ${style.error(error.message)}`,
    ),
  ];
}

/** The mode-independent hint attached to an error block, if one is actionable. */
function errorHint(result: FileResult, style: Style): string | undefined {
  const error = result.error;
  if (error === undefined) {
    return undefined;
  }
  if (isConfigError(error)) {
    const position = configPosition(error);
    if (isMultiDocument(error)) {
      return position === undefined
        ? `${INDENT}Keep a single YAML document in ${style.path(result.file)}.`
        : `${INDENT}Remove the extra YAML document at ${style.path(result.file)}${style.position(`:${position.line}:${position.column}`)}.`;
    }
    return position === undefined
      ? `${INDENT}Fix the YAML in ${style.path(result.file)}.`
      : `${INDENT}Fix the YAML syntax at ${style.path(result.file)}${style.position(`:${position.line}:${position.column}`)}.`;
  }
  if (isDiscoveryError(error)) {
    return `${INDENT}Run ${style.command("spring-config-cleaner --help")} for usage.`;
  }
  return undefined;
}

function summaryLine(results: FileResult[], mode: RenderMode, style: Style): string | undefined {
  // An errored file renders only its error block, so its entries are not findings.
  const healthy = results.filter((result) => result.error === undefined);
  const duplicates = healthy.reduce((count, result) => count + result.redundant.length, 0);
  const errors = results.length - healthy.length;
  if (duplicates === 0) {
    return undefined;
  }
  const filesWithDuplicates = healthy.filter((result) => result.redundant.length > 0).length;
  const errorSuffix = errors === 0 ? "" : `, ${style.error(plural(errors, "error", "errors"))}`;
  if (mode === "fix") {
    const removed =
      `Removed ${plural(duplicates, "duplicate", "duplicates")} from ` +
      plural(filesWithDuplicates, "file", "files");
    return errors === 0
      ? style.success(`✓ ${removed}.`)
      : `${style.error("✖")} ${style.success(removed)}${errorSuffix}`;
  }
  const files = results.length;
  const duplicateSummary = style.duplicate(
    `${plural(duplicates, "duplicate", "duplicates")} in ` +
      `${filesWithDuplicates} of ${plural(files, "profile file", "profile files")}`,
  );
  const suffix = mode === "dry-run" ? style.dim(" (dry run — nothing written)") : "";
  return `${style.error("✖")} ${duplicateSummary}${suffix}${errorSuffix}`;
}

function hintLines(hints: Hint[], style: Style): string[] {
  const labelledWidth = Math.max(
    0,
    ...hints.flatMap((hint) => ("label" in hint ? [hint.label.length] : [])),
  );
  return hints.map((hint) =>
    "label" in hint
      ? `${INDENT}${style.dim(hint.label.padEnd(labelledWidth))}  ${style.command(hint.command)}`
      : `${INDENT}${hint.text}`,
  );
}

export function renderResults(results: FileResult[], options: RenderOptions): string {
  const { mode, style } = options;
  const blocks = results.flatMap((result) => {
    if (result.error !== undefined) {
      return [errorBlock(result, style)];
    }
    const block = mode === "fix" ? fixBlock(result, style) : findingBlock(result, mode, style);
    return block === undefined ? [] : [block];
  });
  const summary = summaryLine(results, mode, style);
  const hints = [
    ...results.flatMap((result) => {
      const hint = errorHint(result, style);
      return hint === undefined ? [] : [hint];
    }),
    ...hintLines(options.hints ?? [], style),
  ];
  if (blocks.length === 0 && summary === undefined) {
    return `${style.success(CLEAN_LINE)}\n`;
  }
  const sections = [...blocks.map((block) => block.join("\n"))];
  if (summary !== undefined) {
    sections.push(summary);
  }
  if (hints.length > 0) {
    sections.push(hints.join("\n"));
  }
  return `${sections.join(BLOCK_SEPARATOR)}\n`;
}
