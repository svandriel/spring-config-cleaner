import { describe, expect, it } from "vitest";
import { conditionMatches } from "./activation.ts";

describe("conditionMatches", () => {
  it("matches an absent condition always", () => {
    expect(conditionMatches(undefined, "prod")).toBe(true);
    expect(conditionMatches(null, "prod")).toBe(true);
  });
  it("matches plain names and lists/CSV as OR", () => {
    expect(conditionMatches("prod", "prod")).toBe(true);
    expect(conditionMatches("prod", "dev")).toBe(false);
    expect(conditionMatches(["prod", "dev"], "dev")).toBe(true);
    expect(conditionMatches("prod,dev", "dev")).toBe(true);
  });
  it("evaluates |, &, ! and parentheses", () => {
    expect(conditionMatches("prod | staging", "staging")).toBe(true);
    expect(conditionMatches("prod | staging", "dev")).toBe(false);
    expect(conditionMatches("dev & !test", "dev")).toBe(true);
    expect(conditionMatches("dev & !test", "test")).toBe(false);
    expect(conditionMatches("(a | b) & c", "a")).toBe(false);
  });
  it("never matches on malformed conditions", () => {
    expect(conditionMatches("prod |", "prod")).toBe(false);
  });
});
