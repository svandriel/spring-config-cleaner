/**
 * Comment-preserving rewrite of a (single-document) config YAML file.
 *
 * Redundant leaves found by the comparison stage are removed from the parsed
 * Document directly (CST-level mutation), so every remaining comment, blank
 * line and key spelling survives round-tripping. Pruning removes only
 * mappings this rewrite emptied (source-empty mappings survive) and keeps
 * comment-carrying ones as empty mappings; surviving keys may be restyled
 * via `renderSegment`. Structure is preserved: nested mappings stay
 * nested and dotted keys stay dotted.
 */
import { isMap, isScalar, type Pair, parseDocument, type YAMLMap } from "yaml";
import type { RedundantEntry } from "./compare.ts";
import { canonicalKey, type KeyStyle, renderSegment, splitWords } from "./keys.ts";

/** Layout a rewritten document can be forced into. Only `preserve` is active for now. */
export type Structure = "preserve" | "nested" | "dotted";

/** Options for `rewriteConfigFile`: key restyle and structural layout. */
export interface WriteOptions {
  /** Style surviving key segments are re-rendered in; `preserve` keeps source spelling. */
  style: KeyStyle;
  /** Structural layout of the output; `preserve` keeps the source tree shape. */
  structure: Structure;
}

/** Minimal shape of yaml nodes that can carry surrounding comments. */
interface CommentCarrier {
  commentBefore?: string | null;
  comment?: string | null;
}

/** `value` as a comment-carrying yaml node, or `undefined` for plain data. */
function asCarrier(value: unknown): CommentCarrier | undefined {
  return value !== null && typeof value === "object" ? (value as CommentCarrier) : undefined;
}

/** The comment `nodes` hold, as separate lines ready for re-attachment. */
function commentLines(nodes: unknown[]): string[] {
  return nodes.flatMap((node) => {
    const carrier = asCarrier(node);
    return [
      ...(carrier?.commentBefore?.split("\n") ?? []),
      ...(carrier?.comment?.split("\n") ?? []),
    ];
  });
}

/**
 * Merge salvaged comment `lines` in front of `existing` (" word" per line,
 * no leading `#`), returning `undefined` when there is nothing to add.
 */
function mergeComments(lines: string[], existing: string | null | undefined): string | undefined {
  if (lines.length === 0) {
    return undefined;
  }
  return [...lines, ...(existing?.split("\n") ?? [])].join("\n");
}

/** Attach salvage `lines` before `node` (its own comment line). No-op when `lines` is empty. */
function prependComments(node: unknown, lines: string[]): void {
  const carrier = asCarrier(node);
  const merged = carrier === undefined ? undefined : mergeComments(lines, carrier.commentBefore);
  if (carrier !== undefined && merged !== undefined) {
    carrier.commentBefore = merged;
  }
}

/** Attach salvage `lines` after `node` (a trailing comment). No-op when `lines` is empty. */
function appendComments(node: unknown, lines: string[]): void {
  const carrier = asCarrier(node);
  const merged = carrier === undefined ? undefined : mergeComments(lines, carrier.comment);
  if (carrier !== undefined && merged !== undefined) {
    carrier.comment = merged;
  }
}

/** The spelling of `pair.key` (parsed keys are scalar strings for our configs). */
function keyOf(pair: Pair): string | undefined {
  return isScalar(pair.key)
    ? String(pair.key.value)
    : pair.key === null
      ? undefined
      : String(pair.key);
}

/**
 * The first pair of `map` whose canonical key segments consume all of
 * `segments` — the leaf (or an identically-spelled ancestor) to remove.
 */
function findLeafPair(map: YAMLMap, segments: string[]): Pair | undefined {
  const target = canonicalKey(segments.join("."));
  return map.items.find((pair) => {
    const key = keyOf(pair);
    return key !== undefined && canonicalKey(key) === target;
  });
}

/**
 * The first pair of `map` whose canonical key segments are a proper prefix of
 * `segments` and whose value is a mapping to descend into.
 */
function findBranchPair(map: YAMLMap, segments: string[]): Pair | undefined {
  const target = canonicalKey(segments.join("."));
  return map.items.find((pair) => {
    const key = keyOf(pair);
    if (key === undefined || !isMap(pair.value)) {
      return false;
    }
    const prefix = canonicalKey(key);
    return prefix.length < target.length && target.startsWith(`${prefix}.`);
  });
}

/**
 * Remove the leaf reached by walking `map` along `path`. Dotted keys are
 * transparent: every key along the way may cover several path segments at
 * once, so prefix consumption picks the branch and the remainder recurses.
 * Matching is canonical (relaxed-binding) while the removal itself uses the
 * map's original key spelling. Missing paths are silently skipped; returns
 * whether a pair was actually removed.
 */
function removeLeaf(map: YAMLMap, path: string): boolean {
  const segments = path.split(".");
  const leaf = findLeafPair(map, segments);
  if (leaf !== undefined) {
    const index = map.items.indexOf(leaf);
    const salvaged = commentLines([leaf.key, leaf.value]);
    const next = map.items[index + 1];
    const prev = index > 0 ? map.items[index - 1] : undefined;
    const key = keyOf(leaf);
    if (key === undefined || map.delete(key) === false) {
      return false;
    }
    if (next !== undefined && isScalar(next.key)) {
      // A surviving follower adopts the removed pair's comments on its own
      // commentBefore line (same indent position the source comment had).
      prependComments(next.key, salvaged);
    } else if (prev !== undefined) {
      // Deleted trailing pair: its comments trail the preceding sibling's
      // value (`alpha: 1 # guard`), which survives in serialized output.
      appendComments(prev.value, salvaged);
    } else {
      // No sibling left: the map inherits the salvage as commentBefore, which
      // also marks it comment-carrying so pruning keeps it as empty mapping.
      prependComments(map, salvaged);
    }
    return true;
  }
  const branch = findBranchPair(map, segments);
  if (branch === undefined || !isMap(branch.value)) {
    return false;
  }
  const branchKey = keyOf(branch);
  if (branchKey === undefined) {
    return false;
  }
  const consumed = canonicalKey(branchKey).split(".").length;
  return removeLeaf(branch.value, segments.slice(consumed).join("."));
}

/** Whether `node` (a yaml node) carries an attached comment of any kind. */
function carriesComment(node: unknown): boolean {
  const carrier = asCarrier(node);
  return typeof carrier?.commentBefore === "string" || typeof carrier?.comment === "string";
}

/** Collect the mappings that are empty before this rewrite's removals. */
function emptyMappingsBeforeRemovals(map: YAMLMap, empty = new Set<YAMLMap>()): Set<YAMLMap> {
  map.items.forEach((pair) => {
    if (isMap(pair.value)) {
      if (pair.value.items.length === 0) {
        empty.add(pair.value);
      }
      emptyMappingsBeforeRemovals(pair.value, empty);
    }
  });
  return empty;
}

/**
 * Bottom-up prune: drop pairs whose mapped value is an empty mapping that THIS
 * rewrite emptied (mappings already empty in the source — the `profiles: {}`
 * idiom — and mappings that carry comments survive). An emptied parent with a
 * comment attached stays as an empty mapping.
 */
function pruneMap(map: YAMLMap, emptyAtParse: ReadonlySet<YAMLMap>): void {
  [...map.items].forEach((pair) => {
    const value = pair.value;
    if (!isMap(value)) {
      return;
    }
    pruneMap(value, emptyAtParse);
    if (
      value.items.length === 0 &&
      !emptyAtParse.has(value) &&
      !carriesComment(value) &&
      !carriesComment(pair.key) &&
      !carriesComment(pair.value)
    ) {
      const key = keyOf(pair);
      if (key !== undefined) {
        map.delete(key);
      }
    }
  });
}

/**
 * Restyle every surviving key of `map` (recursively) by re-rendering each
 * dotted key segment through `renderSegment(splitWords(segment), style)`. Keys
 * are renamed in place on the pair's key scalar, preserving the pair's
 * comments, anchors and values; spellings that don't change are left alone.
 */
function restyleMap(map: YAMLMap, style: Exclude<KeyStyle, "preserve">): void {
  map.items.forEach((pair) => {
    if (isMap(pair.value)) {
      restyleMap(pair.value, style);
    }
    const key = keyOf(pair);
    if (key === undefined || !isScalar(pair.key)) {
      return;
    }
    const restyled = key
      .split(".")
      .map((segment) => renderSegment(splitWords(segment), style))
      .join(".");
    if (restyled !== "" && restyled !== key) {
      pair.key.value = restyled;
    }
  });
}

/**
 * Rewrite `source` with every entry of `remove` deleted, comments preserved.
 * Entries are deduped per document by canonical path; repeated identical
 * entries (and paths another removal already pruned) are idempotent no-ops.
 * The remaining tree is pruned bottom-up, surviving keys are restyled per
 * `options`, and the document is serialized intact.
 */
export function rewriteConfigFile(
  source: string,
  remove: RedundantEntry[],
  options: WriteOptions,
): string {
  const doc = parseDocument(source);
  if (doc.errors.length > 0 || isMap(doc.contents) === false || doc.contents.items.length === 0) {
    throw new Error("rewriteConfigFile: empty or invalid single-document config");
  }
  const root = doc.contents;
  const emptyAtParse = emptyMappingsBeforeRemovals(root);
  const seen = new Set<string>();
  remove
    // Entries of other documents cannot occur (parse halts multi-document files
    // upstream); repeated identical entries are deduped by canonical path.
    .filter((entry) => entry.documentIndex === 0)
    .forEach((entry) => {
      const canonical = canonicalKey(entry.path);
      if (seen.has(canonical)) {
        return;
      }
      seen.add(canonical);
      removeLeaf(root, entry.path);
    });
  // `structure` is honored from the next task on; until then every layout is
  // rewritten as `preserve` (nested mappings stay nested, dotted keys stay
  // dotted), which removeLeaf/pruneMap/restyleMap below never restructure.
  pruneMap(root, emptyAtParse);
  if (options.style !== "preserve") {
    restyleMap(root, options.style);
  }
  return doc.toString({ lineWidth: 100 });
}
