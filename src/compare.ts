/**
 * Redundancy comparison of a profile-specific config file against the base
 * config file.
 *
 * The base file's single document is flattened into an effective map keyed by
 * canonical property path; the profile file's documents are then scanned, each
 * one only when its own activation condition matches the profile being
 * compared. A profile
 * entry is redundant when its canonical path exists in the base map with an
 * equal value; a differing value counts as an override; a path the base does
 * not have is a new property and is ignored here.
 */
import { conditionMatches } from "./activation.ts";
import type { ConfigDocument, ConfigFile } from "./configfile.ts";
import { documentActivation } from "./configfile.ts";
import { canonicalKey } from "./keys.ts";
import type { FlatEntry } from "./paths.ts";
import { flattenDocument } from "./paths.ts";
import { valuesEqual } from "./values.ts";

/**
 * A redundant profile-file entry: the profile side's path, style-preserved
 * words, leaf value and the index of the profile document it was found in.
 */
export interface RedundantEntry {
  /** Dotted property path as written in the profile file. */
  path: string;
  /** One `splitWords` result per dotted path segment. */
  words: string[][];
  /** JavaScript value of the leaf on the profile side. */
  value: unknown;
  /** Index of the source document within the profile file. */
  documentIndex: number;
}

/** The outcome of comparing a profile file against the base document. */
export interface ComparisonResult {
  /** Redundant entries, per profile document in flatten (document) order. */
  redundant: RedundantEntry[];
  /** Number of overrides: same canonical path, different value. */
  overrides: number;
}

/** Documents of `file` whose own activation condition matches `profileName`. */
function matchingDocuments(
  file: ConfigFile,
  profileName: string,
): Array<readonly [number, ConfigDocument]> {
  return file.documents
    .map((document, documentIndex) => [documentIndex, document] as const)
    .filter(([, document]) => conditionMatches(documentActivation(document.doc), profileName));
}

/** Document-level comparison outcome, combined across the profile's documents. */
interface DocumentComparison {
  /** Redundant entries of one profile document, in flatten order. */
  redundant: RedundantEntry[];
  /** Overrides found in one profile document. */
  overrides: number;
}

/** Per-document scan state: already-resolved canonical paths plus the results. */
interface ScanAccumulator {
  /** Canonical paths resolved so far in this profile document. */
  seen: Set<string>;
  /** Redundant entries accumulated so far. */
  redundant: RedundantEntry[];
  /** Overrides accumulated so far. */
  overrides: number;
}

/**
 * Resolve one flattened profile entry against the effective map; first
 * occurrence per canonical path wins. Canonical paths absent from the base map
 * are ignored and never added to `seen`, so every occurrence re-evaluates.
 */
function scanStep(
  effective: Map<string, FlatEntry>,
  acc: ScanAccumulator,
  entry: FlatEntry,
): ScanAccumulator {
  const canonical = canonicalKey(entry.path);
  if (acc.seen.has(canonical)) {
    return acc;
  }
  const baseEntry = effective.get(canonical);
  if (baseEntry === undefined) {
    return acc;
  }
  acc.seen.add(canonical);
  if (valuesEqual(entry.value, baseEntry.value)) {
    acc.redundant.push({
      path: entry.path,
      words: entry.words,
      value: entry.value,
      documentIndex: entry.documentIndex,
    });
  } else {
    acc.overrides++;
  }
  return acc;
}

/** Compare one profile document against the effective map, first wins per canonical path. */
function compareDocument(
  document: ConfigDocument,
  documentIndex: number,
  effective: Map<string, FlatEntry>,
): DocumentComparison {
  const { redundant, overrides } = flattenDocument(document.doc, documentIndex).reduce(
    (acc, entry) => scanStep(effective, acc, entry),
    { seen: new Set<string>(), redundant: [] as RedundantEntry[], overrides: 0 },
  );
  return { redundant, overrides };
}

/**
 * Compare `profile` against the single document of the `base` config file for
 * `profileName`. When the base document's activation condition does not match
 * `profileName`, the profile file is skipped entirely and an empty result is
 * returned.
 *
 * Within a profile document, first occurrence of a canonical path wins: an
 * equal value contributes one redundant entry, a differing value contributes
 * one to `overrides`; later occurrences of the same canonical path in the same
 * document are counted once and not double-reported.
 */
export function compareProfileFile(
  base: ConfigFile,
  profile: ConfigFile,
  profileName: string,
): ComparisonResult {
  const baseDocument = base.documents[0];
  if (
    baseDocument === undefined ||
    !conditionMatches(documentActivation(baseDocument.doc), profileName)
  ) {
    return { redundant: [], overrides: 0 };
  }

  // Effective map over the base document; the Map constructor's
  // later-pair-wins behavior gives the required later-wins tie rule.
  const effective = new Map(
    flattenDocument(baseDocument.doc, 0).map((entry) => [canonicalKey(entry.path), entry] as const),
  );

  const comparisons = matchingDocuments(profile, profileName).map(([documentIndex, document]) =>
    compareDocument(document, documentIndex, effective),
  );
  return {
    redundant: comparisons.flatMap((comparison) => comparison.redundant),
    overrides: comparisons.reduce((count, comparison) => count + comparison.overrides, 0),
  };
}
