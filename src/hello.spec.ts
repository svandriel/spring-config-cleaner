import { describe, expect, it } from "vitest";
import { hello } from "./hello.ts";

describe("hello", () => {
  it("should return a greeting message", () => {
    const name = "World";
    const expectedGreeting = `Hello, ${name}!`;
    expect(hello(name)).toBe(expectedGreeting);
  });
});
