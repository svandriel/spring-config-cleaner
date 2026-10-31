import { styleText } from "node:util";

/**
 * Semantic colour roles used by the report. Every renderer call goes through
 * one of these, so a token keeps the same colour in every mode. `enabled:
 * false` makes every role an identity function, which is what piped output and
 * the library's plain renderer use.
 */
export interface Style {
  /** File and directory paths. */
  path(text: string): string;
  /** `:line:column` suffixes. */
  position(text: string): string;
  /** Gutters, labels and secondary counts. */
  dim(text: string): string;
  /** Failure markers and severity words. */
  error(text: string): string;
  /** Duplicate markers, severity words and removals. */
  duplicate(text: string): string;
  /** Success markers and summaries. */
  success(text: string): string;
  /** Property paths in finding rows. */
  key(text: string): string;
  /** Suggested commands. */
  command(text: string): string;
}

export function createStyle(enabled: boolean): Style {
  const paint =
    (format: Parameters<typeof styleText>[0]) =>
    (text: string): string =>
      enabled ? styleText(format, text, { validateStream: false }) : text;
  return {
    path: paint("cyan"),
    position: paint("dim"),
    dim: paint("dim"),
    error: paint("red"),
    duplicate: paint("yellow"),
    success: paint("green"),
    key: paint("bold"),
    command: paint("cyan"),
  };
}

/** Colour-free style for piped output and `renderReport`. */
export const plainStyle: Style = createStyle(false);
