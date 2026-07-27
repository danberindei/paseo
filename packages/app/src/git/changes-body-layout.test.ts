import { describe, expect, it } from "vitest";
import { resolveChangesBodyLayout } from "./changes-body-layout";

describe("resolveChangesBodyLayout", () => {
  it("renders a diff tab directly instead of in the commits split", () => {
    expect(resolveChangesBodyLayout("diff")).toBe("direct");
  });

  it("renders tree and combined presentations in the commits split", () => {
    expect(resolveChangesBodyLayout("tree")).toBe("split");
    expect(resolveChangesBodyLayout("combined")).toBe("split");
  });
});
