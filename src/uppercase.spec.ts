import { describe, expect, it } from "vitest";
import { uppercase } from "./uppercase.ts";

describe("uppercase", () => {
  it("should uppercase a string", () => {
    expect(uppercase("spring")).toBe("SPRING");
  });
});
