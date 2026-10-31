/**
 * Comment-preserving rewrite of a (single-document) config YAML file.
 *
 * Redundant leaves found by the comparison stage are removed from the parsed
 * Document directly (CST-level mutation), so every remaining comment, blank
 * line and key spelling survives round-tripping. Pruning removes only
 * mappings this rewrite emptied (source-empty mappings survive) and keeps
 * comment-carrying ones as empty mappings; surviving keys may be restyled
 * via `renderSegment`. `structure: "dotted"` re-emits every surviving leaf as
 * an explicit dotted key (nested maps collapse) and `"nested"` collapses
 * dotted keys into nested maps; both rebuild the tree from flatten-order
 * leaves, reusing original value nodes (inline comments, anchors and tags
 * survive) and carrying dropped ancestors' comments onto the first leaf below
 * them.
 */
import { isMap, isScalar, Pair, parseDocument, Scalar, YAMLMap } from "yaml";
import type { RedundantEntry } from "./compare.ts";
import { canonicalKey, type KeyStyle, renderSegment, splitWords } from "./keys.ts";

/** Layout a rewritten document can be forced into. */
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
 * A comment block owned by a node the structure rebuild drops (an ancestor of
 * the re-homed leaves). Its lines attach to the FIRST surviving leaf below it
 * (flatten order), so the text survives once and is never duplicated.
 */
interface DroppedComments {
  lines: string[];
  /** Set once a leaf has adopted the lines. */
  taken: boolean;
}

/** A surviving leaf re-homed by a structure rebuild. */
interface LeafRecord {
  /** Restyled path segments (`.ts` free, from the post-restyle tree). */
  segments: string[];
  /** Original yaml value node, re-homed as-is (keeps anchors and inline comments). */
  value: unknown;
  /** Comment lines merged in front of the re-homed key, document order. */
  lines: string[];
}

/** Intermediate tree node for the `nested` rebuild. */
interface TreeNode {
  leaf?: LeafRecord;
  children: Map<string, TreeNode>;
}

/**
 * The untaken ancestor lines of `chain` (" word" lines, document order), after
 * which every not-yet-taken ancestor is marked consumed.
 */
function chainLines(chain: readonly DroppedComments[]): string[] {
  const lines = chain.flatMap((group) => (group.taken ? [] : group.lines));
  chain.forEach((group) => {
    group.taken = true;
  });
  return lines;
}

/**
 * Collect flatten-order leaves of `map` (removals, pruning and restyling
 * already applied) into `leaves`. Dot-transparent matching mirrors the
 * comparison stage: a dotted key contributes all of its segments. Comments of
 * dropped ancestors ride along their subtree and attach to the first leaf
 * reached. Comment-carrying empty mappings cannot be re-homed; their lines
 * land in `orphans` (hoisted to the file head).
 */
function collectLeaves(
  map: YAMLMap,
  prefixSegments: string[],
  chain: readonly DroppedComments[],
  leaves: Map<string, LeafRecord>,
  orphans: string[],
): void {
  map.items.forEach((pair) => {
    const key = keyOf(pair);
    if (key === undefined) {
      orphans.push(...commentLines([pair.key, pair.value]));
      return;
    }
    const segments = [...prefixSegments, ...key.split(".")];
    const value = pair.value;
    if (isMap(value)) {
      if (value.items.length === 0) {
        orphans.push(...commentLines([pair.key, value]));
        return;
      }
      collectLeaves(
        value,
        segments,
        [...chain, { lines: commentLines([pair.key, value]), taken: false }],
        leaves,
        orphans,
      );
      return;
    }
    const canonical = canonicalKey(segments.join("."));
    // The pool keeps key comments and pre-value comments; an inline trailing
    // comment lives on the reused value node and stays where it was.
    const lines = [
      ...chainLines(chain),
      ...commentLines([pair.key]),
      ...(asCarrier(value)?.commentBefore?.split("\n") ?? []),
    ];
    const losing = leaves.get(canonical);
    leaves.set(canonical, {
      segments,
      value,
      // Later-wins tie rule for a canonical path spelled twice (the comparison
      // stage uses the same rule); the superseded leaf's lines merge first so
      // no comment text is lost.
      lines: losing === undefined ? lines : [...losing.lines, ...lines],
    });
  });
}

/**
 * Insert `entry` into the `nested` rebuild tree. A longer path at the same
 * prefix (`a.b: 1` next to `a.b.c: 2`) makes the subtree win; the shallow
 * leaf's comments are downgraded into `orphans`.
 */
function insertLeaf(tree: TreeNode, entry: LeafRecord, orphans: string[]): void {
  const leafKey = entry.segments[entry.segments.length - 1];
  if (leafKey === undefined) {
    orphans.push(...entry.lines);
    return;
  }
  const parent = entry.segments.slice(0, -1).reduce<TreeNode>((node, segment) => {
    const next: TreeNode = node.children.get(segment) ?? { children: new Map() };
    node.children.set(segment, next);
    return next;
  }, tree);
  const node: TreeNode = parent.children.get(leafKey) ?? { children: new Map() };
  if (node.children.size > 0) {
    // The deeper subtree wins; the shallow leaf is downgraded and its
    // comments are hoisted to `orphans`.
    orphans.push(...entry.lines);
    return;
  }
  node.leaf = entry;
  parent.children.set(leafKey, node);
}

/** Build the nested rebuild tree from flatten-order leaves. */
function buildTree(leaves: LeafRecord[], orphans: string[]): TreeNode {
  const tree: TreeNode = { children: new Map() };
  leaves.forEach((leaf) => {
    insertLeaf(tree, leaf, orphans);
  });
  return tree;
}

/** Attach pooled `lines` in front of `node`'s own (empty) comment block. */
function setLeadingComments(node: CommentCarrier, lines: string[]): void {
  const merged = mergeComments(lines, undefined);
  if (merged !== undefined) {
    node.commentBefore = merged;
  }
}

/** Root map of the `dotted` rebuild: one flat dotted key per surviving leaf. */
function buildDotted(leaves: LeafRecord[]): YAMLMap {
  const root = new YAMLMap();
  leaves.forEach((leaf) => {
    const keyNode = new Scalar(leaf.segments.join("."));
    setLeadingComments(keyNode, leaf.lines);
    root.items.push(new Pair(keyNode, leaf.value));
  });
  return root;
}

/** Root map of the `nested` rebuild: intermediate maps per interior segment. */
function buildNested(tree: TreeNode): YAMLMap {
  const map = new YAMLMap();
  tree.children.forEach((child, segment) => {
    const keyNode = new Scalar(segment);
    if (child.leaf === undefined) {
      map.items.push(new Pair(keyNode, buildNested(child)));
      return;
    }
    setLeadingComments(keyNode, child.leaf.lines);
    map.items.push(new Pair(keyNode, child.leaf.value));
  });
  return map;
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
  // Structure seam: `preserve` reuses the pruned tree as-is; `dotted`/`nested`
  // rebuild it from flatten-order leaves (collect runs after prune/restyle so
  // restyled segments carry into the re-homed keys and removals already
  // happened). Value nodes are reused, so inline comments, anchors and tags
  // survive; dropped ancestors' and orphaned comments are pooled onto the
  // first leaf below them / the rebuilt file head.
  pruneMap(root, emptyAtParse);
  if (options.style !== "preserve") {
    restyleMap(root, options.style);
  }
  if (options.structure === "preserve") {
    return doc.toString({ lineWidth: 100 });
  }
  const leaves = new Map<string, LeafRecord>();
  const orphans: string[] = [];
  collectLeaves(root, [], [{ lines: commentLines([root]), taken: false }], leaves, orphans);
  if (leaves.size === 0) {
    // Nothing survives: keep the pruned layout and hoist any orphaned comments.
    prependComments(root, orphans);
    return doc.toString({ lineWidth: 100 });
  }
  const rebuilt =
    options.structure === "dotted"
      ? buildDotted([...leaves.values()])
      : buildNested(buildTree([...leaves.values()], orphans));
  setLeadingComments(rebuilt, orphans);
  // Hand-built map nodes are fresh and well-formed but not Parsed-typed (no
  // parsed ranges); assignment needs one trust-us cast after a structural fit.
  doc.contents = rebuilt as unknown as typeof doc.contents;
  return doc.toString({ lineWidth: 100 });
}
