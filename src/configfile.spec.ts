import { describe, expect, it } from "vitest";
import { ConfigError, documentActivation, parseConfigFile } from "./configfile.ts";

describe("parseConfigFile", () => {
  it("parses a single document and extracts its activation condition", () => {
    const file = parseConfigFile(
      "application.yml",
      "spring:\n  config:\n    activate:\n      on-profile: prod\nmy:\n  prop: 1\n",
    );
    expect(file.documents).toHaveLength(1);
    expect(documentActivation(file.documents[0]!.doc)).toBe("prod");
  });
  it("extracts no activation condition for a profile-less document", () => {
    const file = parseConfigFile("application.yml", "my:\n  prop: 1\n");
    expect(documentActivation(file.documents[0]!.doc)).toBeUndefined();
  });
  it("halts on multi-document files", () => {
    try {
      parseConfigFile("application.yml", "a: 1\n---\nb: 2\n");
      expect.unreachable("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).path).toBe("application.yml");
    }
  });
  it("reads legacy spring.profiles as activation condition", () => {
    const file = parseConfigFile(
      "application.yml",
      "spring:\n  profiles:\n  - a\n  - b\nvalue: 1\n",
    );
    expect(documentActivation(file.documents[0]!.doc)).toEqual(["a", "b"]);
  });
  it("throws ConfigError with the file path on malformed YAML", () => {
    try {
      parseConfigFile("application-broken.yml", "a: [");
      expect.unreachable("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).path).toBe("application-broken.yml");
    }
  });
  it("carries the parse position and keeps the path out of the message", () => {
    try {
      parseConfigFile("application-broken.yml", "a: [1,\n");
      expect.unreachable("should throw");
    } catch (error) {
      const broke = error as ConfigError;
      expect(broke.message).toContain("Flow sequence");
      expect(broke.message).not.toContain("application-broken.yml");
      expect(broke.message).not.toContain("at line");
      expect(broke.line).toBe(2);
      expect(broke.column).toBe(1);
      expect(broke.source).toBe("a: [1,\n");
    }
  });
  it("points multi-document errors at the second document", () => {
    try {
      parseConfigFile("application.yml", "a: 1\n---\nb: 2\n");
      expect.unreachable("should throw");
    } catch (error) {
      expect((error as ConfigError).line).toBe(2);
      expect((error as ConfigError).column).toBe(1);
    }
  });
  it("keeps the source text on the parsed file", () => {
    expect(parseConfigFile("application.yml", "a: 1\n").source).toBe("a: 1\n");
  });
});
