import { describe, expect, it } from "vitest";
import { formatWindowTitle, getWorkspaceTabTitleLabel } from "@/utils/window-title";

describe("window title formatting", () => {
  it("formats a draft workspace title with the space name", () => {
    expect(
      formatWindowTitle({
        spaceName: "Blue",
        tabLabel: "New Agent",
      }),
    ).toBe("Blue - New Agent - Paseo");
  });

  it("includes the project name between the space and tab", () => {
    expect(
      formatWindowTitle({
        spaceName: "Blue",
        projectName: "paseo",
        tabLabel: "New Agent",
      }),
    ).toBe("Blue - paseo - New Agent - Paseo");
  });

  it("formats a title with only the project name", () => {
    expect(formatWindowTitle({ projectName: "paseo" })).toBe("paseo - Paseo");
  });

  it("falls back to the app title when no title parts are available", () => {
    expect(formatWindowTitle({})).toBe("Paseo");
  });

  it("resolves the draft tab label", () => {
    expect(getWorkspaceTabTitleLabel({ kind: "draft", draftId: "draft-1" })).toBe("New Agent");
  });
});
