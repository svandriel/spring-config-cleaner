const BOOLEAN_PATTERN = /^(true|false)$/i;

type ValueKind = "boolean" | "number" | "null" | "array" | "object" | "raw";

function isNumericString(v: string): boolean {
  if (v.trim() === "") {
    return false;
  }
  return Number.isFinite(Number(v));
}

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function classify(v: unknown): ValueKind {
  if (v === null || v === undefined) {
    return "null";
  }
  if (typeof v === "boolean") {
    return "boolean";
  }
  if (typeof v === "string" && BOOLEAN_PATTERN.test(v)) {
    return "boolean";
  }
  if (typeof v === "number") {
    return "number";
  }
  if (typeof v === "string" && isNumericString(v)) {
    return "number";
  }
  if (Array.isArray(v)) {
    return "array";
  }
  if (typeof v === "object" && isPlainObject(v)) {
    return "object";
  }
  return "raw";
}

function asBoolean(v: unknown): boolean {
  if (typeof v === "boolean") {
    return v;
  }
  return (v as string).toLowerCase() === "true";
}

/**
 * Deep comparison with light Spring binding normalization: booleans unify with
 * "true"/"false" strings case-insensitively, numbers compare numerically
 * (numeric strings via `Number`), null/undefined equal each other, arrays are
 * element-wise and order-sensitive, plain objects compare unordered and
 * recursively, and everything else uses strict raw equality — placeholders are
 * never resolved.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  const kindA = classify(a);
  if (kindA !== classify(b)) {
    return false;
  }
  switch (kindA) {
    case "null":
      return true;
    case "boolean":
      return asBoolean(a) === asBoolean(b);
    case "number":
      return Number(a) === Number(b);
    case "array": {
      const listA = a as unknown[];
      const listB = b as unknown[];
      return listA.length === listB.length && listA.every((x, i) => valuesEqual(x, listB[i]));
    }
    case "object": {
      const objA = a as Record<string, unknown>;
      const objB = b as Record<string, unknown>;
      const keysA = Object.keys(objA);
      const keysB = Object.keys(objB);
      if (keysA.length !== keysB.length) {
        return false;
      }
      return keysA.every((key) => Object.hasOwn(objB, key) && valuesEqual(objA[key], objB[key]));
    }
    default:
      return a === b;
  }
}
