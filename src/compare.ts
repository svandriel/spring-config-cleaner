/**
 * Redundancy comparison of a profile-specific config file against the base
 * config file.
 *
 * The base file's single document is flattened into an effective map keyed by
 * canonical property path; the profile file's documents are then scanned, each
 * one only when its own gate matches the profile being compared. A profile
 * entry is redundant when its canonical path exists in the base map with an
 * equal value; a differing value counts as an override; a path the base does
 * not have is a new property and is ignored here.
 */
import type { ConfigDocument, ConfigFile } from "./configfile.ts";
import { documentGate } from "./configfile.ts";
import { gateMatches } from "./gates.ts";
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

/** Documents of `file` whose own gate matches `profileName`. */
function matchingDocuments(
  file: ConfigFile,
  profileName: string,
): Array<readonly [number, ConfigDocument]> {
  return file.documents
    .map((document, documentIndex) => [documentIndex, document] as const)
    .filter(([, document]) => gateMatches(documentGate(document.doc), profileName));
}

/**
 * Compare `profile` against the single document of the `base` config file for
 * `profileName`. When the base document's gate does not match `profileName`,
 * the profile file is skipped entirely and an empty result is returned.
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
  if (baseDocument === undefined || !gateMatches(documentGate(baseDocument.doc), profileName)) {
    return { redundant: [], overrides: 0 };
  }

  // Effective map over the base document (later-wins on canonical-path ties).
  const effective = new Map<string, FlatEntry>();
  for (const entry of flattenDocument(baseDocument.doc, 0)) {
    effective.set(canonicalKey(entry.path), entry);
  }

  const redundant: RedundantEntry[] = [];
  let overrides = 0;
  for (const [documentIndex, document] of matchingDocuments(profile, profileName)) {
    const seen = new Set<string>();
    for (const entry of flattenDocument(document.doc, documentIndex)) {
      const canonical = canonicalKey(entry.path);
      if (seen.has(canonical)) {
        continue;
      }
      const baseEntry = effective.get(canonical);
      if (baseEntry === undefined) {
        continue;
      }
      seen.add(canonical);
      if (valuesEqual(entry.value, baseEntry.value)) {
        redundant.push({
          path: entry.path,
          words: entry.words,
          value: entry.value,
          documentIndex,
        });
      } else {
        overrides++;
      }
    }
  }
  return { redundant, overrides };
}
