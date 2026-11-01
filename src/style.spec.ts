import { describe, expect, it } from "vitest";
import { colorEnabled, createStyle } from "./style.ts";

describe("createStyle", () => {
  it("maps every semantic token to its ANSI style", () => {
    const style = createStyle(true);
    expect(style.path("a.yml")).toBe("\u001b[36ma.yml\u001b[39m");
    expect(style.command("cmd")).toBe("\u001b[36mcmd\u001b[39m");
    expect(style.position("1:2")).toBe("\u001b[2m1:2\u001b[22m");
    expect(style.dim("x")).toBe("\u001b[2mx\u001b[22m");
    expect(style.error("x")).toBe("\u001b[31mx\u001b[39m");
    expect(style.duplicate("x")).toBe("\u001b[33mx\u001b[39m");
    expect(style.success("x")).toBe("\u001b[32mx\u001b[39m");
    expect(style.key("x")).toBe("\u001b[1mx\u001b[22m");
  });
  it("is an identity mapping when disabled", () => {
    const style = createStyle(false);
    expect(style.path("a.yml")).toBe("a.yml");
    expect(style.error("boom")).toBe("boom");
  });
});

describe("colorEnabled", () => {
  const tty = { isTTY: true };
  const pipe = { isTTY: false };

  it("honours FORCE_COLOR even when the destination is a pipe", () => {
    expect(colorEnabled(pipe, { FORCE_COLOR: "1" })).toBe(true);
    expect(colorEnabled(pipe, { FORCE_COLOR: "true" })).toBe(true);
    expect(colorEnabled(pipe, { FORCE_COLOR: "0" })).toBe(false);
  });

  it("honours NO_COLOR on a terminal", () => {
    expect(colorEnabled(tty, { NO_COLOR: "1" })).toBe(false);
  });

  it("keeps colour off for dumb terminals and pipes", () => {
    expect(colorEnabled(tty, { TERM: "dumb" })).toBe(false);
    expect(colorEnabled(pipe, {})).toBe(false);
  });

  it("enables colour for a terminal", () => {
    expect(colorEnabled(tty, {})).toBe(true);
  });
});
