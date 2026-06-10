import { describe, expect, it } from "vitest";
import {
  abbreviateOwnerInDisplayName,
  projectDisplayNameFromProjectId,
  projectIconPlaceholderLabelFromDisplayName,
} from "./project-display-name";

describe("projectDisplayNameFromProjectId", () => {
  it("abbreviates the owner to its initial for GitHub remote ids", () => {
    expect(projectDisplayNameFromProjectId("remote:github.com/getpaseo/paseo")).toBe("g/paseo");
  });

  it("shows the trailing directory name for local projects", () => {
    expect(projectDisplayNameFromProjectId("/Users/me/dev/paseo")).toBe("paseo");
  });
});

describe("abbreviateOwnerInDisplayName", () => {
  it("keeps only the owner initial as a remote marker", () => {
    expect(abbreviateOwnerInDisplayName("getpaseo/paseo")).toBe("g/paseo");
  });

  it("leaves owner-less local names untouched", () => {
    expect(abbreviateOwnerInDisplayName("paseo")).toBe("paseo");
  });

  it("is idempotent", () => {
    expect(abbreviateOwnerInDisplayName("g/paseo")).toBe("g/paseo");
  });
});

describe("projectIconPlaceholderLabelFromDisplayName", () => {
  it("uses repo name instead of owner for GitHub-style display names", () => {
    expect(projectIconPlaceholderLabelFromDisplayName("getpaseo/paseo")).toBe("paseo");
  });

  it("returns the original display name when it has no path separator", () => {
    expect(projectIconPlaceholderLabelFromDisplayName("paseo")).toBe("paseo");
  });
});
