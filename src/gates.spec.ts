import { describe, expect, it } from "vitest";
import { gateMatches } from "./gates.ts";

describe("gateMatches", () => {
  it("matches an absent gate always", () => {
    expect(gateMatches(undefined, "prod")).toBe(true);
    expect(gateMatches(null, "prod")).toBe(true);
  });
  it("matches plain names and lists/CSV as OR", () => {
    expect(gateMatches("prod", "prod")).toBe(true);
    expect(gateMatches("prod", "dev")).toBe(false);
    expect(gateMatches(["prod", "dev"], "dev")).toBe(true);
    expect(gateMatches("prod,dev", "dev")).toBe(true);
  });
  it("evaluates |, &, ! and parentheses", () => {
    expect(gateMatches("prod | staging", "staging")).toBe(true);
    expect(gateMatches("prod | staging", "dev")).toBe(false);
    expect(gateMatches("dev & !test", "dev")).toBe(true);
    expect(gateMatches("dev & !test", "test")).toBe(false);
    expect(gateMatches("(a | b) & c", "a")).toBe(false);
  });
  it("never matches on malformed gates", () => {
    expect(gateMatches("prod |", "prod")).toBe(false);
  });
});
