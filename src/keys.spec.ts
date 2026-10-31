import { describe, expect, it } from "vitest";
import { canonicalKey, extractProfileName, renderSegment, splitWords } from "./keys.ts";

describe("canonicalKey", () => {
  it("collapses relaxed-binding spellings", () => {
    expect(canonicalKey("someProp")).toBe("someprop");
    expect(canonicalKey("some-prop")).toBe("someprop");
    expect(canonicalKey("some_prop")).toBe("someprop");
    expect(canonicalKey("SOME-PROP")).toBe("someprop");
  });
  it("keeps dots as separators", () => {
    expect(canonicalKey("Spring.Main.show-Banner")).toBe("spring.main.showbanner");
  });
});

describe("splitWords", () => {
  it("splits on camel, hyphen, underscore", () => {
    expect(splitWords("max-Threads")).toEqual(["max", "Threads"]);
    expect(splitWords("db_userId")).toEqual(["db", "user", "Id"]);
  });
});

describe("renderSegment", () => {
  it("renders kebab/camel/snake", () => {
    expect(renderSegment(["user", "Id", "name"], "kebab")).toBe("user-id-name");
    expect(renderSegment(["user", "Id", "name"], "camel")).toBe("userIdName");
    expect(renderSegment(["user", "Id", "name"], "snake")).toBe("user_id_name");
  });
});

describe("extractProfileName", () => {
  it("extracts profile names from application-<profile> paths only", () => {
    expect(extractProfileName("src/res/application-prod.yml")).toBe("prod");
    expect(extractProfileName("./application-test.yaml")).toBe("test");
    expect(extractProfileName("some/dir/application.yml")).toBe(null);
    expect(extractProfileName("some/dir/bootstrap.yml")).toBe(null);
  });
});
