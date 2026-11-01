/**
 * Flattening of parsed YAML documents into dotted property paths.
 *
 * Nested mappings and explicit dotted keys (`spring.application.name: app`)
 * both collapse to the same dotted path so that different spellings of the
 * same Spring property can be compared (relaxed-binding style) later on.
 */

import { type Document, isAlias, isMap, isNode, isScalar, isSeq, type YAMLMap } from "yaml";
import { splitWords } from "./keys.ts";
import { lineIndex, type SourcePosition } from "./position.ts";

/** A single leaf value found while flattening a document. */
export interface FlatEntry {
  /** Dotted property path, e.g. `server.tomcat.max-Threads`. */
  path: string;
  /** One `splitWords` result per dotted path segment. */
  words: string[][];
  /** JavaScript value of the leaf (collections fully converted). */
  value: unknown;
  /** Index of the source document within the parsed set. */
  documentIndex: number;
  /** Span from the start of the key through the end of its value. */
  position: SourcePosition;
}

/**
 * Append a leaf entry for the accumulated `segments`. Collection leaves are
 * converted to plain JS values; scalars keep their raw value.
 */
function addLeaf(
  value: unknown,
  segments: string[],
  doc: Document,
  documentIndex: number,
  position: SourcePosition,
  out: FlatEntry[],
): void {
  const leaf = isSeq(value)
    ? value.toJS(doc)
    : isScalar(value)
      ? value.value
      : value === null || value === undefined
        ? null
        : (value as { toJS: (doc: Document) => unknown }).toJS(doc);
  out.push({
    path: segments.join("."),
    words: segments.map(splitWords),
    value: leaf,
    documentIndex,
    position,
  });
}

/**
 * Recurse over the key/value pairs of `map`, extending the accumulated
 * `segments` with every (possibly dotted) key. Empty mappings are skipped
 * entirely and never produce entries.
 */
function walkMap(
  map: YAMLMap,
  segments: string[],
  doc: Document,
  documentIndex: number,
  index: ReturnType<typeof lineIndex>,
  out: FlatEntry[],
): void {
  for (const pair of map.items) {
    const keyNode = pair.key;
    if (keyNode === null) {
      continue;
    }
    const key = isScalar(keyNode) ? String(keyNode.value) : String(keyNode);
    const nextSegments = [...segments, ...key.split(".")];

    let value = pair.value;
    const start = isNode(keyNode) ? (keyNode.range?.[0] ?? 0) : 0;
    const keyEnd = isNode(keyNode) ? (keyNode.range?.[1] ?? start) : start;
    const spanEnd = isNode(value) ? (value.range?.[1] ?? keyEnd) : keyEnd;
    if (isAlias(value)) {
      value = value.resolve(doc);
    }
    if (isMap(value)) {
      if (value.items.length === 0) {
        continue;
      }
      walkMap(value, nextSegments, doc, documentIndex, index, out);
    } else {
      addLeaf(value, nextSegments, doc, documentIndex, index.position(start, spanEnd), out);
    }
  }
}

/**
 * Flatten a parsed document into leaf entries in document order. Nested maps
 * and dotted keys collapse to the same dotted `path`; a value that is an empty
 * mapping is skipped, while sequences, scalars and nulls are leaves carrying
 * their JS value (aliases resolved via the `yaml` package's node resolution).
 * `source` is the text the document was parsed from, used for positions.
 */
export function flattenDocument(doc: Document, documentIndex: number, source: string): FlatEntry[] {
  const entries: FlatEntry[] = [];
  const contents = doc.contents;
  if (isMap(contents) && contents.items.length > 0) {
    walkMap(contents, [], doc, documentIndex, lineIndex(source), entries);
  }
  return entries;
}
