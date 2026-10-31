/**
 * Matching of Spring profile activation conditions.
 *
 * A `spring.config.activate.on-profile` activation condition may be absent, a
 * plain profile name, a CSV list, an array, or a Spring profile expression
 * combining names with `|` (OR), `&` (AND) and `!` (NOT) plus parentheses.
 * Expressions are evaluated against the exact (trimmed, case-sensitive)
 * profile name of the config file they activate.
 *
 * Matching is deliberately strict: an absent activation condition always
 * matches, but a *malformed* condition never matches — a broken condition must
 * not cause an otherwise-different document to be considered equal.
 */

/** Everything the condition evaluator can conclude for a sub-expression. */
type Status = "match" | "mismatch" | "malformed";

/** Operators that separate top-level alternatives: both `|` and CSV. */
const OR_OPS: readonly string[] = ["|", ","];

/** Characters that are never valid inside a plain profile-name token. */
const OPERATOR_CHARS = new Set(["|", "&", "!", "(", ")", ","]);

/**
 * Split `expr` on single-character `ops` that sit outside any parentheses.
 * Parens must stay balanced; returns `null` for unbalanced input.
 */
function splitTopLevel(expr: string, ops: readonly string[]): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr.charAt(i);
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
    } else if (depth === 0 && ops.includes(ch)) {
      parts.push(expr.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0) {
    return null;
  }
  parts.push(expr.slice(start));
  return parts;
}

/** OR: matches if some operand matches; malformed if any operand is malformed. */
function combineOr(results: Status[]): Status {
  if (results.some((result) => result === "malformed")) {
    return "malformed";
  }
  return results.some((result) => result === "match") ? "match" : "mismatch";
}

/** AND: matches if every operand matches; malformed if any operand is malformed. */
function combineAnd(results: Status[]): Status {
  if (results.some((result) => result === "malformed")) {
    return "malformed";
  }
  return results.every((result) => result === "match") ? "match" : "mismatch";
}

/**
 * Lowest precedence: split on `|`/`,` (OR), then evaluate each operand as an
 * AND-expression.
 */
function parseOr(expr: string, profile: string): Status {
  const orParts = splitTopLevel(expr, OR_OPS);
  if (orParts === null) {
    return "malformed";
  }
  return combineOr(orParts.map((part) => parseAnd(part, profile)));
}

/** Next precedence: split on `&` (AND), then evaluate each operand as a term. */
function parseAnd(expr: string, profile: string): Status {
  const andParts = splitTopLevel(expr, ["&"]);
  if (andParts === null) {
    return "malformed";
  }
  return combineAnd(andParts.map((part) => parseTerm(part, profile)));
}

/** A term is either a negation (`!` of a sub-expression) or a plain atom. */
function parseTerm(expr: string, profile: string): Status {
  const trimmed = expr.trim();
  if (trimmed.startsWith("!")) {
    const negated = trimmed.slice(1);
    if (negated.trim() === "") {
      return "malformed";
    }
    const inner = parseOr(negated, profile);
    if (inner === "malformed") {
      return "malformed";
    }
    return inner === "match" ? "mismatch" : "match";
  }
  return parseAtom(trimmed, profile);
}

/**
 * An atom is a parenthesized sub-expression (nothing may trail the closing
 * paren) or a plain profile-name token compared exactly against `profile`.
 */
function parseAtom(expr: string, profile: string): Status {
  if (expr.startsWith("(")) {
    let depth = 0;
    for (let i = 0; i < expr.length; i++) {
      if (expr.charAt(i) === "(") {
        depth++;
      } else if (expr.charAt(i) === ")") {
        depth--;
        if (depth === 0) {
          const rest = expr.slice(i + 1);
          return rest.trim() === "" ? parseOr(expr.slice(1, i), profile) : "malformed";
        }
      }
    }
    return "malformed";
  }
  if (expr === "") {
    return "malformed";
  }
  for (const ch of expr) {
    if (OPERATOR_CHARS.has(ch)) {
      return "malformed";
    }
  }
  return expr === profile ? "match" : "mismatch";
}

/**
 * Does the given on-profile activation condition match `profile`?
 *
 * `undefined`/`null` conditions always match. String, string-array and
 * comma-separated conditions are parsed as profile expressions; anything that
 * fails to parse (unbalanced parens, dangling operators, stray operator
 * characters inside a name, non-string array entries, empty operands)
 * evaluates to `false` so a malformed condition can never produce a wrongful
 * match.
 *
 * Named `conditionMatches` rather than `activationMatches` because
 * "activation" names the event while "condition" names the thing tested, so
 * `conditionMatches(documentActivation(doc), profile)` reads naturally.
 */
export function conditionMatches(condition: unknown, profile: string): boolean {
  if (condition === undefined || condition === null) {
    return true;
  }
  if (typeof condition === "string") {
    return parseOr(condition, profile) === "match";
  }
  if (Array.isArray(condition)) {
    const results = condition.map((entry) =>
      typeof entry === "string" ? parseOr(entry, profile) : ("malformed" as const),
    );
    return combineOr(results) === "match";
  }
  return false;
}
