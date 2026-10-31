import { describe, expect, it } from "vitest";
import { ConfigError, documentGate, parseConfigFile } from "./configfile.ts";

describe("parseConfigFile", () => {
  it("parses a single document and extracts its gate", () => {
    const file = parseConfigFile(
      "application.yml",
      "spring:\n  config:\n    activate:\n      on-profile: prod\nmy:\n  prop: 1\n",
    );
    expect(file.documents).toHaveLength(1);
    expect(documentGate(file.documents[0]!.doc)).toBe("prod");
  });
  it("extracts no gate for a profile-less document", () => {
    const file = parseConfigFile("application.yml", "my:\n  prop: 1\n");
    expect(documentGate(file.documents[0]!.doc)).toBeUndefined();
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
  it("reads legacy spring.profiles as gate", () => {
    const file = parseConfigFile(
      "application.yml",
      "spring:\n  profiles:\n  - a\n  - b\nvalue: 1\n",
    );
    expect(documentGate(file.documents[0]!.doc)).toEqual(["a", "b"]);
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
});
