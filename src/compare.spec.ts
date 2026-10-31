import { describe, expect, it } from "vitest";
import { compareProfileFile } from "./compare.ts";
import { parseConfigFile } from "./configfile.ts";

const BASE = ["a: 1", "b: x", "t: 60"].join("\n");

const PROD = ["a: 1", "b: y", "t: 30", "u: 5"].join("\n");

describe("compareProfileFile", () => {
  it("flags identical copies of base values; overrides and new keys stay untouched", () => {
    const result = compareProfileFile(
      parseConfigFile("application.yml", BASE),
      parseConfigFile("application-prod.yml", PROD),
      "prod",
    );
    expect(result.redundant.map((r) => r.path)).toEqual(["a"]);
    // b and t are overrides (same key, different value); u is a new property
    expect(result.overrides).toBe(2);
  });
  it("skips evaluation when the base document's activation condition does not match", () => {
    const base = parseConfigFile(
      "application.yml",
      "spring:\n  config:\n    activate:\n      on-profile: dev\nu: 5\n",
    );
    const profile = parseConfigFile("application-prod.yml", "u: 5\n");
    expect(compareProfileFile(base, profile, "prod")).toEqual({ redundant: [], overrides: 0 });
  });
  it("ignores profile-file documents activated for other profiles", () => {
    const profile = parseConfigFile(
      "application-prod.yml",
      "---\nspring:\n  config:\n    activate:\n      on-profile: dev\nv: 1\n",
    );
    const base = parseConfigFile("application.yml", "v: 1\n");
    expect(compareProfileFile(base, profile, "prod").redundant).toEqual([]);
  });
});
