import { describe, expect, it, test } from "vitest";

import { buildProviderCommand } from "@/utils/provider-command-templates";

describe("buildProviderCommand", () => {
  test("builds Hermes resume commands from native session ids", () => {
    expect(
      buildProviderCommand({
        provider: "hermes",
        id: "resume",
        sessionId: "20260813_111500_abc123",
      }),
    ).toBe("hermes --resume 20260813_111500_abc123");
  });

  test("builds OpenCode resume commands from native session ids", () => {
    expect(
      buildProviderCommand({
        provider: "opencode",
        id: "resume",
        sessionId: "ses_abc123",
      }),
    ).toBe("opencode --session ses_abc123");
  });

  test("builds Copilot resume commands from native session ids", () => {
    expect(
      buildProviderCommand({
        provider: "copilot",
        id: "resume",
        sessionId: "session-3",
      }),
    ).toBe("copilot --resume session-3");
  });

  it("returns null for unknown providers", () => {
    expect(
      buildProviderCommand({
        provider: "unknown",
        id: "resume",
        sessionId: "session-4",
      }),
    ).toBeNull();
  });
});
