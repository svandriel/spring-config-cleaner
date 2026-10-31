/**
 * Key canonicalization and style rendering for Spring configuration keys.
 *
 * Spring's relaxed binding treats `someProp`, `some-prop`, `some_prop` and
 * `SOME-PROP` as the same key. These helpers normalize spellings to a canonical
 * form and convert between the supported writing styles.
 */

/** Writing styles a key segment can be rendered in. `preserve` keeps the source spelling. */
export type KeyStyle = "kebab" | "camel" | "snake" | "preserve";

/** Word tokenization: each `-`/`_`-separated part is split further on camel boundaries. */
const WORD_RE = /([A-Z][a-z0-9]*|[a-z0-9]+)/gu;

/**
 * Canonical form of a key: lowercased with all `-` and `_` removed, `.` kept
 * as a separator. Different relaxed-binding spellings collapse to the same
 * canonical key (`some-prop`, `some_prop`, `someProp` → `someprop`).
 */
export function canonicalKey(key: string): string {
  return key.toLowerCase().replaceAll("-", "").replaceAll("_", "");
}

/**
 * Split a key segment into words on camelCase boundaries, hyphens and
 * underscores. Case is preserved (`max-Threads` → `["max", "Threads"]`).
 */
export function splitWords(segment: string): string[] {
  const words: string[] = [];
  const parts = segment.split(/[-_]+/);
  for (const part of parts) {
    for (const match of part.matchAll(WORD_RE)) {
      words.push(match[1] ?? "");
    }
  }
  return words;
}

/** Capitalize a single word while leaving the rest of it untouched. */
function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Render words as a single key segment in the requested style. `kebab` and
 * `snake` lower-case every word; `camel` keeps the first word and capitalizes
 * words 2..n.
 */
export function renderSegment(words: string[], style: Exclude<KeyStyle, "preserve">): string {
  const first = words[0];
  if (first === undefined) {
    return "";
  }
  switch (style) {
    case "camel": {
      return [first, ...words.slice(1).map(capitalize)].join("");
    }
    case "snake":
      return words.map((word) => word.toLowerCase()).join("_");
    case "kebab":
      return words.map((word) => word.toLowerCase()).join("-");
  }
}

/** Basename pattern for profile-specific config files: `application-<name>.yml|.yaml`. */
const PROFILE_RE = /^application-(.+)\.(?:yml|yaml)$/;

/**
 * Extract the profile name from a config file path whose basename matches
 * `application-<name>.yml` or `application-<name>.yaml`; `null` otherwise.
 */
export function extractProfileName(path: string): string | null {
  const basename = path.split(/[\\/]/).pop();
  if (basename === undefined) {
    return null;
  }
  return PROFILE_RE.exec(basename)?.[1] ?? null;
}
