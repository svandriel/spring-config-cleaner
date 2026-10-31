/**
 * Parsing of single-document Spring config YAML files.
 *
 * A config file must consist of exactly one YAML document; multi-document
 * files (separated by `---`) are unsupported per spec and halt processing of
 * that file. On failure a `ConfigError` carrying the file path is thrown.
 *
 * Parsing does not interpret the file's profile beyond extracting its
 * activation condition: `spring.config.activate.on-profile`, with the legacy
 * `spring.profiles` key (a string or an array) as fallback. The condition is
 * the raw YAML value; actual condition matching lives in `activation.ts`.
 */
import type { Document, DocumentOptions, ParseOptions, SchemaOptions } from "yaml";
import { isCollection, isScalar, parseAllDocuments } from "yaml";

/** Failure while parsing a specific config file. `path` is the file path. */
export class ConfigError extends Error {
  path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.path = path;
    this.name = "ConfigError";
  }
}

/** One parsed YAML document of a config file, plus its activation condition. */
export interface ConfigDocument {
  doc: Document;
  /** Raw activation condition; matching lives in `activation.ts`. */
  activation: unknown;
}

/** A parsed config file: its path and the single document it holds. */
export interface ConfigFile {
  path: string;
  documents: ConfigDocument[];
}

function isActivationCandidate(value: unknown): boolean {
  return typeof value === "string" || Array.isArray(value);
}

/** The JS value of a YAML node, or `value` unchanged when already plain. */
function asJS(doc: Document, value: unknown): unknown {
  if (isScalar(value) || isCollection(value)) {
    return value.toJS(doc);
  }
  return value;
}

/**
 * Extract the raw activation condition of `doc`:
 * `spring.config.activate.on-profile` when present (any shape); otherwise the
 * legacy `spring.profiles` value when it is a string or array; otherwise
 * `undefined`.
 */
export function documentActivation(doc: Document): unknown {
  const activation = asJS(doc, doc.getIn(["spring", "config", "activate", "on-profile"]));
  if (activation !== undefined) {
    return activation;
  }
  const legacy = asJS(doc, doc.getIn(["spring", "profiles"]));
  return isActivationCandidate(legacy) ? legacy : undefined;
}

/**
 * Parse `source` — a YAML file at `path` — as a single document.
 *
 * Throws `ConfigError` (with `path`) on malformed YAML, when the file holds
 * more than one document, or when the document fails to parse.
 */
export function parseConfigFile(path: string, source: string): ConfigFile {
  const docs = parseAllDocuments(source, {
    ignoreChaining: true,
  } as ParseOptions & DocumentOptions & SchemaOptions);

  if (docs.length !== 1) {
    throw new ConfigError(path, `expected a single YAML document, found ${docs.length}`);
  }

  const doc = docs[0];
  if (doc === undefined) {
    throw new ConfigError(path, "expected a single YAML document, found none");
  }
  const parseError = doc.errors[0];
  if (parseError !== undefined) {
    throw new ConfigError(path, parseError.message);
  }

  const activation = documentActivation(doc);
  return {
    path,
    documents: [{ doc, activation }],
  };
}
